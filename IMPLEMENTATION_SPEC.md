# IMPLEMENTATION_SPEC.md

## Purpose

This file is the technical source of truth for the Cleartrip AI Trip Workspace. It defines the database, inventory APIs, domain state, bounded agent workflow, proposal model, adaptive UI contracts, tests, deployment, and P0 implementation order.

Read `PROJECT_CONTEXT.md` first.

---

# 1. Architectural rules

```text
User goal
   ↓
Travel-planner model
   ↓ typed intent / hypothesis / next action
Tool executor
   ↓ validated queries
Inventory service
   ↓
Read-only seeded Postgres
   ↓ grounded observations
Travel-planner model
   ↓ candidate choices / refinement / explanation
Domain engine
   ↓ assembly, arithmetic, validation, proposals
Canonical TripState
   ↓
Deterministic UI renderer
```

The system has six responsibility boundaries:

1. **Agent** — interprets goals, forms a planning hypothesis, chooses permitted searches, recommends among valid candidates, scopes modifications, and explains grounded decisions.
2. **Tool executor** — validates tool names, parameters, IDs, round budgets, and permissions.
3. **Inventory service** — queries the database, constructs dated offers, applies hard filters, and produces fact bundles.
4. **Domain engine** — owns dates, route assembly, prices, budget, feasibility, locks, proposal construction, and validation.
5. **Trip domain** — owns the canonical versioned trip and typed operations.
6. **UI** — renders canonical or derived state with deterministic components.

Do not merge these boundaries. In particular:

- the model never queries SQL or receives database credentials;
- UI code never imports seed data or database modules;
- the model never constructs or mutates `TripState`;
- the database is the source of truth for inventory only;
- client session state is the source of truth for the current P0 trip and proposals;
- public REST handlers and agent tools share the inventory service; the server does not call its own HTTP routes.

---

# 2. Technology and deployment

Use:

- Next.js App Router;
- React;
- TypeScript with strict mode;
- Zod for every external/model boundary;
- Neon Postgres;
- Drizzle schema and migrations;
- Neon serverless driver;
- OpenAI Responses API with structured outputs;
- CSS variables plus CSS Modules or global CSS;
- Vitest for unit/contract tests;
- Playwright for critical UI flows;
- Vercel.

Do not add shadcn, Redux, a workflow framework, a vector database, or a second agent.

Environment:

```bash
DATABASE_URL=
DATABASE_ADMIN_URL=
INVENTORY_SOURCE=snapshot
OPENAI_API_KEY=
OPENAI_MODEL=
INVENTORY_VERSION=travel-seed-v2
```

Rules:

- `DATABASE_ADMIN_URL` is used only by migrations and seeding.
- `DATABASE_URL` uses an application role with `SELECT` permission only. Serverless deployments use that role's pooled Neon connection string (`-pooler` hostname); migration and seed commands continue to use the direct admin URL.
- `INVENTORY_SOURCE` defaults to `snapshot` for a deployment-safe, versioned, read-only inventory bundled from the canonical seed. Use `hybrid` to prefer Neon with a circuit-breaker fallback, or `neon` when explicitly verifying the database adapter.
- database and OpenAI credentials remain server-side.
- `OPENAI_MODEL` is configurable.
- inventory routes run in the Node.js runtime.
- local, preview, test, and production environments use the same migrations and seed version.

Deployment sequence:

1. provision Neon through Vercel;
2. run migrations from zero;
3. run the idempotent seed command;
4. validate seed coverage and integrity;
5. configure the read-only runtime connection;
6. build and run contract/e2e smoke tests;
7. deploy.

---

# 3. Shared primitives and semantics

```ts
export type ID = string;
export type LocationID = ID;
export type MarketID = LocationID;
export type SelectionID = ID;
export type CatalogItemID = ID;
export type OfferID = ID;

export type ISODate = string;      // YYYY-MM-DD
export type ISODateTime = string;  // ISO-8601 with offset
export type LocalTime = string;    // HH:mm
export type CurrencyCode = "INR";

export interface Money {
  amount: number; // integer major currency units for P0
  currency: CurrencyCode;
}

export type PriceUnit =
  | "per_traveller"
  | "per_room_per_night"
  | "per_participant"
  | "per_vehicle";

export interface UnitPrice extends Money {
  unit: PriceUnit;
}
```

All P0 prices are integer INR amounts. Every API price declares its unit. Never pass an untyped number called only `price`.

Date semantics:

- `TripRequest.startDate` and `endDate` are inclusive trip calendar dates.
- `durationDays = calendarDifference(endDate, startDate) + 1`; never store it.
- stay `checkIn` is inclusive and `checkOut` is exclusive.
- trip nights equal the calendar difference between trip start and end.
- recurring schedules store local time plus location timezone.
- search responses return concrete ISO datetimes with offsets.
- relative dates resolve deterministically in `Asia/Kolkata` for P0.

---

# 4. Travellers and constraints

```ts
export type TravellerType = "adult" | "child" | "senior";
export type MobilityLevel = "standard" | "limited";
export type MobilityLoad = "low" | "medium" | "high";
export type TripPace = "relaxed" | "balanced" | "packed";

export interface Traveller {
  id: ID;
  name?: string;
  type: TravellerType;
  age?: number;
  mobility?: MobilityLevel;
}

export type ConstraintPriority = "hard" | "strong" | "flexible";

interface ConstraintBase {
  id: ID;
  priority: ConstraintPriority;
  travellerIds?: ID[];
}

export type Constraint =
  | (ConstraintBase & {
      category: "budget";
      value: { targetTotal?: Money; maxTotal?: Money };
    })
  | (ConstraintBase & {
      category: "travel";
      value: {
        earliestDeparture?: LocalTime;
        latestArrival?: LocalTime;
        allowedModes?: TravelMode[];
        maxStops?: number;
      };
    })
  | (ConstraintBase & {
      category: "stay";
      value: {
        maxNightlyPrice?: Money;
        requiredAmenities?: string[];
        seniorFriendly?: boolean;
        requiredRooms?: number;
      };
    })
  | (ConstraintBase & {
      category: "activity";
      value: {
        maxMobility?: MobilityLoad;
        childFriendly?: boolean;
        seniorFriendly?: boolean;
      };
    })
  | (ConstraintBase & {
      category: "schedule";
      value: { maxActiveMinutesPerDay?: number };
    });

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
export type ConstraintDraft = WithoutId<Constraint>;
```

Rules:

- constraints are a discriminated union;
- budget exists only as a budget constraint;
- there is at most one constraint for `category + normalized travellerIds`;
- `upsert_constraint` merges typed fields into that semantic key;
- `remove_constraint` removes a known constraint ID;
- hard constraints block candidates or commit;
- strong/flexible constraints become objective facts and model preference context;
- traveller-specific UI is out of P0, but relevant selections retain `travellerIds`.

P0 validation must cover budget, departure time, travel modes/stops, stay amenities/senior suitability, activity mobility, schedule conflicts, and locked-item preservation. Do not build a generic rules engine.

---

# 5. Trip request and destination intent

```ts
export type DestinationIntent =
  | { kind: "specified"; locationId: LocationID }
  | { kind: "open" };

export interface TripRequest {
  origin?: LocationID;
  destination?: DestinationIntent;
  startDate?: ISODate;
  endDate?: ISODate;
  travellers: Traveller[];
  preferences: {
    pace?: TripPace;
    interests?: string[];
  };
  constraints: Constraint[];
}

export interface PlannableTripRequest
  extends Omit<TripRequest, "origin" | "destination" | "startDate" | "endDate" | "travellers"> {
  origin: LocationID;
  destination: DestinationIntent;
  startDate: ISODate;
  endDate: ISODate;
  travellers: [Traveller, ...Traveller[]];
}
```

A specified `locationId` may identify a city, region, state, or country. The agent proposes concrete stops; code verifies their relationship to the supplied scope.

An explicit `{ kind: "open" }` satisfies the destination requirement. Absence of `destination` does not.

Required validation:

```ts
export type MissingRequirement = "origin" | "destination_intent" | "dates" | "travellers";

export interface RequirementCheck {
  missingRequired: MissingRequirement[];
  optionalTopics: Array<"budget" | "pace" | "mobility" | "interests">;
}
```

Planning starts exactly when `missingRequired` is empty. `canPlan` is derived, not stored.

---

# 6. Inventory database

The database is pre-seeded, deterministic, synthetic, and read-only at application runtime.

## 6.1 Inventory metadata

`inventory_meta` contains exactly one active row:

- `version`;
- `seededAt`;
- `supportedFrom`;
- `supportedUntil`;
- `currency`;
- `dataProvenance = synthetic`.

Every search response includes `inventoryVersion`. P0 inventory supports **2026-08-28 through 2027-03-31**, inclusive. Requests outside that range return `outside_inventory_window`; the system never projects availability beyond the seeded contract.

`seededAt` is a fixed release timestamp from the seed manifest, not the runtime execution time, so repeated seeding produces identical metadata.

## 6.2 Locations and markets

```ts
export type LocationType =
  | "country"
  | "state"
  | "region"
  | "city"
  | "airport"
  | "neighborhood";

export interface LocationRecord {
  id: LocationID;
  type: LocationType;
  name: string;
  countryCode: string;
  parentId?: LocationID;
  timezone: string;
  latitude?: number;
  longitude?: number;
  aliases: string[];
  tags: string[];
  airportCode?: string;
  imageAssetKey?: string;
  active: boolean;
}
```

`destination_markets` declares the 20 supported market roots. Market membership follows normalized parent relationships; do not duplicate child lists in application code.

Origin, destination, and stop are trip roles, not location types.

## 6.3 Transport

Tables:

- `transport_services` — operator, mode, validity, operating weekdays, base unit price;
- `transport_segments` — ordered from/to locations, local departure/arrival, duration, operator number.

```ts
export type TravelMode = "flight" | "train" | "bus" | "ferry";

export interface TransportServiceRecord {
  id: CatalogItemID;
  mode: TravelMode;
  operator: string;
  operatingWeekdays: number[];
  validFrom: ISODate;
  validUntil: ISODate;
  price: UnitPrice; // per_traveller
  active: boolean;
}
```

The service constructs a dated `TransportOffer` from service, segments, requested date, and traveller count. The same service/date/inventory version produces the same `OfferID`.

## 6.4 Properties and room offers

`properties` stores stable hotel facts. `room_offers` stores occupancy, meal plan, refundability, validity, and per-room-per-night price.

```ts
export interface PropertyRecord {
  id: CatalogItemID;
  name: string;
  locationId: LocationID;
  rating: number;
  reviewCount: number;
  amenities: string[];
  accessibility: string[];
  tags: string[];
  imageAssetKey: string;
  active: boolean;
}

export interface RoomOfferRecord {
  id: CatalogItemID;
  propertyId: CatalogItemID;
  roomLabel: string;
  maxOccupancy: number;
  inventoryCount: number;
  mealPlan: "none" | "breakfast";
  refundable: boolean;
  validFrom: ISODate;
  validUntil: ISODate;
  price: UnitPrice; // per_room_per_night
  active: boolean;
}
```

## 6.5 Activities

`activities` stores stable facts. `activity_sessions` stores recurring date/time availability, capacity, duration, and price.

```ts
export interface ActivityRecord {
  id: CatalogItemID;
  name: string;
  locationId: LocationID;
  tags: string[];
  mobility: MobilityLoad;
  childFriendly: boolean;
  seniorFriendly: boolean;
  imageAssetKey: string;
  active: boolean;
}
```

## 6.6 Transfers

`transfers` stores normalized from/to locations, mode, typical duration, operating window, capacity, and per-vehicle price.

Transfers cover airport/terminal to destination zone, inter-stop relocation, and the location relationships needed for itinerary feasibility. There is no destination-keyed matrix and no maps API.

## 6.7 Runtime immutability

The application role receives `SELECT` only. There are no runtime inventory mutation endpoints. Migrations and seeds use a separate admin connection. A contract test must prove that the runtime role cannot insert, update, or delete.

---

# 7. Seed manifest and coverage

P0 route-complete origin hub:

- Delhi.

Normalized origin hubs retained for autocomplete and later route expansion:

- Bengaluru;
- Mumbai;
- Hyderabad;
- Chennai;
- Kolkata.

P0 must return `unsupported_route` when a normalized origin/market pair has no seeded transport; it must not imply comprehensive coverage. The full six-origin × twenty-market outbound/return matrix is deferred to P1/P2.

P0 Indian destination markets:

1. Goa;
2. Udaipur;
3. Manali;
4. Srinagar;
5. Rishikesh;
6. Kochi;
7. Munnar;
8. Puducherry;
9. Darjeeling;
10. Puri.

P0 international destination markets:

1. Thailand;
2. Bali;
3. Singapore;
4. Dubai;
5. Tokyo;
6. Paris;
7. Rome;
8. London;
9. New York;
10. Sydney.

Thailand may contain Bangkok, Phuket, and Krabi. Bali may contain Denpasar/airport, Ubud, and a beach zone. Goa may contain multiple zones. These are ordinary location relationships, not special planner branches.

Every market must satisfy the base coverage contract:

- reachable through at least one complete outbound/return transport combination from a supported origin during the inventory window;
- at least four active properties and six room offers;
- at least five activities with recurring sessions;
- transfer coverage between arrival point, stay zones, and activity zones;
- at least one valid three-to-five-night plan for the seed validation scenario;
- meaningful trade-offs in price, timing, location, comfort, or activity fit.

Markets with connected child locations may support multi-stop planning. This is derived from transport/transfer and stay coverage, not stored as a hard-coded boolean in planner code.

The seed must be idempotent and versioned. Fixed IDs must be human-readable enough for debugging but treated as opaque outside seed/tests.

---

# 8. Inventory service and REST API

The inventory service is the only database consumer. Both REST handlers and agent tools call it.

Public server endpoints:

```text
GET  /api/locations/search?q=
POST /api/inventory/destinations/discover
POST /api/inventory/transport/search
POST /api/inventory/stays/search
POST /api/inventory/activities/search
POST /api/inventory/transfers/search
```

`POST` search endpoints are read-only; they use structured request bodies and never mutate inventory.

```ts
export interface SearchResponse<T> {
  queryId: ID; // stable hash of normalized query + inventory version
  inventoryVersion: string;
  results: T[];
  resultCount: number;
  appliedFilters: AppliedFilter[];
  coverage: CoverageResult;
  generatedAt: ISODateTime;
}

export interface AppliedFilter {
  type: "availability" | "hard_constraint" | "location" | "date" | "capacity";
  label: string;
  constraintId?: ID;
}

export interface LocationSearchResult {
  id: LocationID;
  name: string;
  type: LocationType;
  countryCode: string;
  parentLabel?: string;
  airportCode?: string;
}

export interface DestinationDiscoveryRequest {
  origin: LocationID;
  startDate: ISODate;
  endDate: ISODate;
  travellers: Traveller[];
  interests: string[];
  constraints: Constraint[];
}

export interface TransportSearchRequest {
  from: LocationID;
  to: LocationID;
  date: ISODate;
  travellers: Traveller[];
  constraints: Constraint[];
}

export interface StaySearchRequest {
  locationId: LocationID;
  checkIn: ISODate;
  checkOut: ISODate;
  travellers: Traveller[];
  constraints: Constraint[];
}

export interface ActivitySearchRequest {
  locationId: LocationID;
  startDate: ISODate;
  endDate: ISODate;
  travellers: Traveller[];
  interests: string[];
  constraints: Constraint[];
}

export interface TransferSearchRequest {
  from: LocationID;
  to: LocationID;
  travellers: Traveller[];
}

export type CoverageResult =
  | { status: "available" }
  | { status: "unsupported_location"; locationId?: LocationID }
  | { status: "unsupported_route" }
  | { status: "outside_inventory_window" }
  | { status: "no_availability" }
  | { status: "eliminated_by_constraints"; constraintIds: ID[] };
```

Search requests include only normalized IDs, dates, relevant traveller data, interests, and typed constraints. Unknown IDs fail validation.

Location autocomplete returns `SearchResponse<LocationSearchResult>`. The other endpoints accept the corresponding request above and return destination facts or dated offer contracts from section 9. Room count is either enforced by `requiredRooms` or derived per offer as specified in section 12.

Search endpoints return dated offers, never raw database records. Database-only fields and inactive inventory must not leak.

Inventory calls should be parallelized when independent. Do not introduce HTTP microservices; these are Next.js route handlers over one shared service.

---

# 9. Dated offer contracts

```ts
export interface TransportSegment {
  from: LocationID;
  to: LocationID;
  departureAt: ISODateTime;
  arrivalAt: ISODateTime;
  operator: string;
  number?: string;
}

export interface PropertyFacts {
  name: string;
  rating: number;
  reviewCount: number;
  amenities: string[];
  accessibility: string[];
  tags: string[];
  imageAssetKey: string;
}

export interface RoomFacts {
  roomLabel: string;
  maxOccupancy: number;
  mealPlan: "none" | "breakfast";
  refundable: boolean;
}

export interface ActivityFacts {
  name: string;
  tags: string[];
  mobility: MobilityLoad;
  childFriendly: boolean;
  seniorFriendly: boolean;
  imageAssetKey: string;
}

export interface TransportOffer {
  id: OfferID;
  serviceId: CatalogItemID;
  mode: TravelMode;
  from: LocationID;
  to: LocationID;
  departureAt: ISODateTime;
  arrivalAt: ISODateTime;
  durationMinutes: number;
  stops: number;
  operator: string;
  segments: TransportSegment[];
  price: UnitPrice;
}

export interface StayOffer {
  id: OfferID;
  roomOfferId: CatalogItemID;
  propertyId: CatalogItemID;
  locationId: LocationID;
  checkIn: ISODate;
  checkOut: ISODate;
  rooms: number;
  propertyFacts: PropertyFacts;
  roomFacts: RoomFacts;
  price: UnitPrice;
}

export interface ActivityOffer {
  id: OfferID;
  activityId: CatalogItemID;
  sessionId: CatalogItemID;
  locationId: LocationID;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  capacity: number;
  activityFacts: ActivityFacts;
  price: UnitPrice;
}

export interface TransferOffer {
  id: OfferID;
  transferId: CatalogItemID;
  from: LocationID;
  to: LocationID;
  mode: "car" | "van" | "shared";
  durationMinutes: number;
  capacity: number;
  price: UnitPrice;
}
```

Offer IDs encode or deterministically reference the catalog record, dates, and inventory version. `resolveOffer(id)` must reconstruct and validate an offer from the database rather than trusting client-supplied facts.

Cheapest, fastest, shortest-transfer, and recommended badges are derived for the current candidate set and are never stored in inventory.

---

# 10. Candidate filtering and reduction

Code performs:

1. catalog/availability checks;
2. hard-constraint filtering;
3. objective fact calculation;
4. elimination of strictly dominated duplicates where safe;
5. stable limiting of the candidate set.

Do not use one opaque universal recommendation score.

Objective facts may include:

- total and unit price;
- duration and stops;
- departure/arrival convenience;
- rating and review count;
- amenity matches;
- accessibility facts;
- transfer duration;
- interest matches;
- activity mobility and schedule fit;
- refundable/meal-plan facts.

When more candidates exist than the model/UI can consume, code applies a documented stable reduction such as retaining price, duration, rating, and preference-frontier representatives. The model recommends among the resulting hard-valid candidates using soft preferences.

If model selection is invalid or unavailable, code may use a lexicographic fallback based on the user's explicit preference order. It must label the copy as a fallback and must not invent rationale.

---

# 11. Route and canonical TripState

```ts
export interface RouteStop {
  locationId: LocationID;
  checkIn: ISODate;
  checkOut: ISODate; // exclusive
}

export interface TripRoute {
  marketId: MarketID;
  stops: [RouteStop, ...RouteStop[]];
}

interface SelectionBase {
  id: SelectionID;
  travellerIds: ID[];
  locked: boolean;
}

export interface TravelSelection extends SelectionBase {
  kind: "travel";
  offerKind: "transport" | "transfer";
  offerId: OfferID;
}

export interface StaySelection extends SelectionBase {
  kind: "stay";
  offerId: OfferID;
  checkIn: ISODate;
  checkOut: ISODate;
  rooms: number;
}

export interface ActivitySelection extends SelectionBase {
  kind: "activity";
  offerId: OfferID;
  date: ISODate;
}

export interface TripState {
  id: ID;
  inventoryVersion: string;
  request: PlannableTripRequest;
  route: TripRoute;
  selectedTravel: TravelSelection[];
  selectedStays: StaySelection[];
  selectedActivities: ActivitySelection[];
  version: number;
}
```

Selection IDs are globally unique within the trip. Modifications target selection IDs; replacements reference offer IDs.

`TripState` does not store itinerary, budget, badges, explanations, validation, proposal previews, chat messages, or copied inventory facts.

---

# 12. Derived state

```ts
export interface TripBudget {
  target?: Money;
  maximum?: Money;
  total: Money;
  breakdown: {
    travel: Money;
    stays: Money;
    activities: Money;
  };
  deltaFromTarget?: Money;
  amountOverMaximum?: Money;
}
```

Calculations:

- transport = per-traveller price × selected travellers;
- transfer = per-vehicle price × required vehicles;
- stay = per-room-per-night price × nights × rooms;
- activity = per-participant price × participants.

If a hard `requiredRooms` value exists, stay search uses it. Otherwise code calculates the minimum viable room count separately for each room offer from traveller count and `maxOccupancy`; the resulting room count is explicit in the dated offer and comparison facts.

`deltaFromTarget = total - target`: positive is over target and negative is under. `amountOverMaximum` exists only when the total exceeds the maximum.

The model never performs arithmetic.

The itinerary is a projection:

```ts
export interface ItineraryEvent {
  id: ID;
  type: "travel" | "stay" | "activity" | "free_time";
  selectionId?: SelectionID;
  startAt?: ISODateTime;
  endAt?: ISODateTime;
  title: string;
  travellerIds: ID[];
}

export interface ItineraryDay {
  date: ISODate;
  dayNumber: number;
  locationId: LocationID;
  events: ItineraryEvent[];
}
```

Direct itinerary edits translate into typed trip operations. They never mutate an independent itinerary store.

Initial PLAN quality requires pace-appropriate activity coverage on full interior trip days when dated activity inventory is available: relaxed plans cover at least `ceil(interiorDays / 3)` distinct days, balanced plans `ceil(interiorDays / 2)`, and packed plans every interior day, capped at four activity days in P0. This is an initial-plan quality gate, not a permanent hard constraint: later approved proposals may intentionally create more open time. Every day without a selected activity receives an explicit derived `free_time` event so an open day is never rendered as an accidental blank.

```ts
export interface TripProjection {
  hydratedSelections: Array<{
    selectionId: SelectionID;
    kind: "travel" | "stay" | "activity";
    offer: TransportOffer | TransferOffer | StayOffer | ActivityOffer;
  }>;
  budget: TripBudget;
  itinerary: ItineraryDay[];
  validation: TripValidation;
  badgesByCandidateId: Record<ID, string[]>;
}
```

The server may return this derived `TripProjection` for rendering. The client may cache it, but it is replaced wholesale after a committed trip change and is never independently mutated.

---

# 13. Validation

```ts
export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationIssue {
  id: ID;
  code:
    | "INVENTORY_VERSION_MISMATCH"
    | "OFFER_NOT_FOUND"
    | "ROUTE_GAP"
    | "DATE_CONFLICT"
    | "BUDGET_EXCEEDED"
    | "EARLY_TRAVEL_CONFLICT"
    | "TRAVEL_MODE_CONFLICT"
    | "MOBILITY_CONFLICT"
    | "STAY_CONFLICT"
    | "TRANSFER_CONFLICT"
    | "SCHEDULE_CONFLICT"
    | "LOCK_CONFLICT";
  severity: ValidationSeverity;
  message: string;
  selectionIds?: SelectionID[];
  constraintIds?: ID[];
}

export interface TripValidation {
  valid: boolean;
  issues: ValidationIssue[];
}
```

`valid` is true exactly when there are no errors.

- exceeding `maxTotal` is an error;
- exceeding `targetTotal` is a warning;
- hard conflicts are errors;
- strong/flexible misses are warnings or facts;
- locked-item preservation is validated against the base trip and proposal operations;
- every selected offer must resolve against `TripState.inventoryVersion`;
- stop nights must cover the trip without overlap or gaps;
- outbound, inter-stop, and return travel must align with route dates;
- activities and transfers may not create supported schedule conflicts.

P0 uses coarse scheduling and stored transfer durations. Do not build a general routing or optimization engine.

---

# 14. Clarification contracts

Required clarifications are deterministic and outside the adaptive component registry.

```ts
export interface ClarificationChoice {
  id: string;
  label: string;
}

export interface RequiredClarification {
  kind: "required";
  requirement: MissingRequirement;
  question: string;
  choices?: ClarificationChoice[];
  allowCustomInput: boolean;
}

export interface OptionalClarification {
  kind: "optional";
  topic: "budget" | "pace" | "mobility" | "interests";
  question: string;
  choices?: ClarificationChoice[];
  allowCustomInput: boolean;
  allowSkip: true;
}

export interface SelectionClarification {
  kind: "selection";
  entityType: "travel" | "stay" | "activity";
  question: string;
  choices: ClarificationChoice[]; // IDs are SelectionIDs
  allowCustomInput: false;
}
```

Show at most four choices. Choice IDs resolve through typed handlers; raw strings never write canonical state.

---

# 15. Agent intent and request patch

One travel-planner model supports natural-language intake, `PLAN`, `MODIFY`, and `EXPLAIN`.

```ts
export type AgentIntent =
  | { type: "plan_trip" }
  | {
      type: "modify_trip";
      targetKinds: Array<"travel" | "stay" | "activity" | "budget">;
      targetSelectionIds: SelectionID[];
      preserveSelectionIds: SelectionID[];
      goal: string;
    }
  | {
      type: "explain";
      question: string;
      selectionId?: SelectionID;
    };
```

Draft intake uses a patch, never a full replacement request:

```ts
export interface RequestPatch {
  origin?: LocationID;
  destination?: DestinationIntent;
  startDate?: ISODate;
  endDate?: ISODate;
  pace?: TripPace;
  interests?: string[];
  upsertConstraints?: ConstraintDraft[];
  removeConstraintIds?: ID[];
  travellerHints?: Array<{
    name?: string;
    type?: TravellerType;
    mobility?: MobilityLevel;
  }>;
}
```

Code resolves locations, dates, semantic constraint keys, traveller IDs, and all patches. After a trip exists, changes use proposals rather than direct request patches.

The intake model returns semantic location queries, an open/specified destination signal, explicitly stated calendar dates, traveller groups, preferences, and typed constraint drafts. It never returns normalized location IDs. Code resolves origin queries against active locations, maps a destination child to its declared market through the location graph, validates dates against the seeded window, assigns stable draft traveller and constraint IDs, applies the patch to the canonical draft, and computes missing requirements deterministically. The user reviews the populated Trip Brief before discovery or PLAN begins; intake never commits a trip.

---

# 16. Agent tools and observations

The model receives a small semantic tool vocabulary:

```ts
export type PlannerToolCall =
  | DiscoverDestinationsCall
  | SearchTransportCall
  | SearchStaysCall
  | SearchActivitiesCall
  | SearchTransfersCall;

export interface ToolPlan {
  operationalSummary: string; // short user-safe description, not chain-of-thought
  calls: PlannerToolCall[];
}

export type PlannerToolName =
  | "discover_destinations"
  | "search_transport"
  | "search_stays"
  | "search_activities"
  | "search_transfers";

interface ToolCallBase {
  id: ID;
  purpose: string;
}

export interface DiscoverDestinationsCall extends ToolCallBase {
  tool: "discover_destinations";
  candidateMarketIds?: MarketID[];
}

export interface SearchTransportCall extends ToolCallBase {
  tool: "search_transport";
  from: LocationID;
  to: LocationID;
  tripDayNumber: number;
}

export interface SearchStaysCall extends ToolCallBase {
  tool: "search_stays";
  locationId: LocationID;
  checkInDayNumber: number;
  nights: number;
}

export interface SearchActivitiesCall extends ToolCallBase {
  tool: "search_activities";
  locationId: LocationID;
  tripDayNumbers: number[];
  themes: string[];
}

export interface SearchTransfersCall extends ToolCallBase {
  tool: "search_transfers";
  from: LocationID;
  to: LocationID;
}
```

Tool names and parameters are strict. The model chooses semantic targets and trip-relative timing; the executor derives exact dates, traveller/room counts, and relevant canonical constraints from `TripRequest` or the base trip. The model cannot omit or rewrite a hard constraint through a tool call. Themes must resolve to the supported inventory taxonomy or the user's captured interests. The executor rejects unknown locations, invalid day ranges, irrelevant duplicate calls, and tool-budget overruns.

The model sees observations, not raw rows:

```ts
export interface GroundedFact {
  id: ID;
  subjectType: "market" | "transport" | "stay" | "activity" | "transfer" | "trip";
  subjectId: ID;
  dimension: string;
  label: string;
  value: string | number | boolean;
}

export interface CandidateFactBundle {
  candidateId: ID;
  facts: GroundedFact[];
}

export interface ObservationBundle {
  queryId: ID;
  toolName: PlannerToolName;
  coverage: CoverageResult;
  candidates: CandidateFactBundle[];
  rejectedSummary: Array<{
    reason: string;
    count: number;
    constraintIds?: ID[];
  }>;
}

export interface AllowedFollowUpAction {
  id: ID;
  label: string;
  type: "adjust_constraint" | "change_scope" | "retry" | "keep_current";
}

export interface FactBundle {
  facts: GroundedFact[];
  allowedComparisonDimensions: string[];
  allowedFollowUpActions: AllowedFollowUpAction[];
}
```

Rejected summaries expose useful aggregate feedback, not hidden inventory or chain-of-thought.

---

# 17. Planning hypothesis and next action

```ts
export interface PlanningHypothesis {
  goalSummary: string;
  destinationMode: "specified" | "broad_scope" | "open_ended";
  candidateMarketIds: MarketID[];
  proposedStopIds: LocationID[];
  nightAllocation: number[];
  preferenceOrder: Array<
    "price" | "timing" | "duration" | "comfort" | "location" | "activity_fit" | "pace"
  >;
  preserveSelectionIds: SelectionID[];
  toolPlan: ToolPlan;
}

export type AgentNextAction =
  | { type: "search_more"; toolPlan: ToolPlan }
  | { type: "clarify"; topic: OptionalClarification["topic"] }
  | {
      type: "present_destination_options";
      candidateMarketIds: MarketID[];
      recommendedMarketId: MarketID;
      supportingFactIds: ID[];
    }
  | {
      type: "propose_plan";
      marketId: MarketID;
      stopIds: LocationID[];
      nightAllocation: number[];
      choices: CandidateChoice[];
    }
  | {
      type: "cannot_satisfy";
      conflictFactIds: ID[];
      suggestedRelaxationIds: ID[];
    };

export interface CandidateChoice {
  decisionId: ID;
  candidateId: ID;
  supportingFactIds: ID[];
  comparisonDimensions: string[];
  summary?: string;
}
```

Validation rules:

- all IDs must exist in the supplied scope/observations;
- an open-ended discovery hypothesis may leave `proposedStopIds` and `nightAllocation` empty;
- a specified-destination hypothesis has exactly one route market;
- every stop must be the route market or its descendant in the normalized location graph;
- `propose_plan.stopIds` must be non-empty and its `nightAllocation` must sum to trip nights;
- ordered route stops deterministically imply outbound transport to the first stop, one date-aligned stay per stop, a transfer for every adjacent stop boundary, and return transport from the final stop;
- selected inventory candidates must come from searches scoped to that declared route; final validation still reports missing or conflicting route legs as structured repair feedback;
- choices may reference only hard-valid candidates;
- comparative claims require supporting fact IDs;
- `search_more` must materially differ from a prior call;
- `clarify` is invalid after the workflow has already used its one optional clarification;
- model output never includes prices, timings, or copied candidate objects.

---

# 18. Bounded PLAN workflow

```text
parse message into RequestPatch + AgentIntent
    ↓
code validates and normalizes the draft
    ↓
deterministic required clarification if needed
    ↓
model may prioritize one optional clarification; user may skip
    ↓
model emits PlanningHypothesis + first ToolPlan
    ↓
executor validates and runs search round 1
    ↓
model emits AgentNextAction
    ↓
optional materially different search round 2
    ↓
model selects market/stops/candidates from observations
    ↓
code calculates dates, resolves offers, assembles TripState
    ↓
code validates the complete trip
    ↓
optional targeted repair round after structured validation feedback
    ↓
code commits only a valid TripState
```

Budgets:

- at most two ordinary evidence rounds;
- at most one additional targeted repair round after validation;
- at most 12 individual search calls across all batches;
- at most one optional clarification;
- no recursion or open-ended continuation;
- a second invalid assembled result ends in a conflict/no-result outcome.

Independent calls within a round run in parallel. The model does not manually coordinate database or HTTP mechanics.

Specified-destination requests may skip discovery. Explanation requests run no inventory search unless a referenced offer can no longer be resolved. Modification searches only affected categories and dependencies.

---

# 19. Destination discovery

`discoverDestinations` uses normalized market tags plus actual transport, stay, activity, and coverage summaries for the request.

Code first removes markets that are unsupported, unreachable, outside the inventory window, or provably above a hard maximum using a conservative price floor. It returns a bounded set with objective facts.

The model may recommend among those candidates using pace, interests, travel effort, and budget preference. It must not make weather, visa, safety, or cultural claims absent from the fact bundle.

An open-ended request should not cause all detailed inventory for all 20 markets to enter the prompt. Discovery returns at most six candidates; detailed searches run only for the selected shortlist.

For P0, open-ended discovery ends with `present_destination_options`. The user selects one of two to four markets; code applies a validated destination `RequestPatch`, and a new specified-destination PLAN invocation performs detailed inventory searches. The discovery invocation and detailed-plan invocation have separate bounded tool budgets and no hidden server workflow state.

---

# 20. Modification, operations, and locks

A modification never mutates committed state immediately.

```ts
export type TripOperation =
  | { type: "replace_travel"; selectionId: SelectionID; nextOfferId: OfferID }
  | { type: "replace_stay"; selectionId: SelectionID; nextOfferId: OfferID }
  | { type: "replace_activity"; selectionId: SelectionID; nextOfferId: OfferID }
  | { type: "add_activity"; nextOfferId: OfferID; travellerIds: ID[] }
  | { type: "remove_activity"; selectionId: SelectionID }
  | { type: "update_activity_participants"; selectionId: SelectionID; travellerIds: ID[] }
  | { type: "set_selection_lock"; selectionId: SelectionID; locked: boolean }
  | { type: "upsert_constraint"; constraint: Constraint }
  | { type: "remove_constraint"; constraintId: ID };
```

P0 UI requires add/replace/remove activity, replace travel/stay, constraint changes, and lock changes. Every itinerary day exposes activity addition. Code resolves that day to its canonical route location, searches dated inventory, filters schedule-invalid candidates, and creates one proposal per valid option. Participant updates remain domain-extensible without participant-specific UI.

Rules:

- code constructs operations from validated intent and search results;
- unrelated selections are preserved by default;
- locked selections cannot be replaced or removed;
- unlocking requires an explicit `set_selection_lock` operation in the same user-approved proposal before replacement;
- direct lock/unlock clicks produce a typed single-operation proposal without requiring model interpretation;
- natural-language constraint changes resolve to exactly one typed `upsert_constraint` or `remove_constraint` intent;
- code assigns the canonical global constraint ID for an upsert and accepts removal only for an existing constraint ID;
- constraint operations always receive a derived preview and explicit approval; they never mutate the committed request directly;
- a proposed hard constraint that invalidates the assembled trip returns `ConstraintConflict`, with a code-validated softer target when one remains valid and a keep-current action in every case;
- approving a constraint proposal synchronizes the editable Trip Brief from the newly committed canonical `TripRequest`;
- ambiguous targets produce `SelectionClarification`.

Modification workflow:

```text
interpret goal and target
→ resolve affected/preserved IDs
→ choose necessary searches
→ retrieve and hard-filter alternatives
→ calculate cross-category effects
→ construct proposal(s)
→ derive preview
→ user approves
→ apply against expected version
```

---

# 21. Proposals and versioning

```ts
export interface TripProposal {
  id: ID;
  baseTripVersion: number;
  operations: TripOperation[];
}

export interface ProposalPreview {
  proposalId: ID;
  nextTrip: TripState;
  changedSelectionIds: SelectionID[];
  preservedSelectionIds: SelectionID[];
  changedCategories: Array<"travel" | "stays" | "activities" | "constraints" | "locks">;
  budgetDelta: Money;
  validation: TripValidation;
}
```

`TripProposal` stores only canonical operations. It does not store a copied final trip, explanation, budget delta, or validation result. `ProposalPreview` is derived.

`applyProposal` must:

- require `baseTripVersion === trip.version`;
- resolve every replacement offer against the trip inventory version;
- validate operation order and locked-item authorization;
- reject a preview containing an error;
- apply only listed operations;
- increment the trip version exactly once.

P0 proposals remain in client in-memory session state keyed by ID. The inventory database does not store trips or proposals. Adding persistence would require auth/session ownership and is outside P0.

---

# 22. Grounded explanation

Explanation never mutates state.

Code supplies a bounded fact bundle containing:

- selected entity facts;
- relevant alternatives;
- constraints/preferences relevant to the question;
- price, timing, transfer, suitability, and schedule differences;
- allowed comparison dimensions and follow-up actions.

The committed trip does not retain historical planning observations. EXPLAIN therefore resolves current selected offers and the derived projection without running new inventory searches. Historical alternatives are compared only if their facts are explicitly present in the supplied bundle; otherwise the response explains the current selection and its trip consequences without claiming it was best or cheapest.

The model returns one to three concise sentence objects, each with supporting fact IDs. Code rejects unknown facts, unsupported numbers, target explanations that cite no target fact, and comparative language that lacks comparable same-entity facts from multiple subjects. Unsupported, invalid, or unavailable model output is replaced by deterministic copy from the same bundle.

Never request or expose hidden chain-of-thought.

---

# 23. Adaptive interaction contracts

Code selects exactly one of three adaptive families:

```ts
export type InteractionBlock =
  | OptionComparisonBlock
  | ChangeProposalBlock
  | ConstraintConflictBlock;

export interface SemanticEmphasis {
  recommendedId?: ID;
  comparisonDimensions?: string[];
  summary?: string;
  supportingFactIds?: ID[];
  suggestedFollowUpActionIds?: ID[];
}
```

### OptionComparison

```ts
export interface OptionComparisonBlock {
  type: "option_comparison";
  entityType: "destination" | "travel" | "stay" | "activity";
  choices: Array<{ optionId: ID; proposalId?: ID }>;
  emphasis?: SemanticEmphasis;
}
```

Use for two to four valid alternatives. Destination comparisons during initial planning do not require proposals. Choosing a destination creates a code-owned `RequestPatch` with a specified destination and resumes PLAN; it does not mutate a committed trip. Alternatives that change an existing trip require one proposal per choice.

### ChangeProposal

```ts
export interface ChangeProposalBlock {
  type: "change_proposal";
  proposalId: ID;
  emphasis?: SemanticEmphasis;
}
```

The component derives its diff, budget delta, preservation summary, and validation from `ProposalPreview`.

### ConstraintConflict

```ts
export interface ConstraintConflictBlock {
  type: "constraint_conflict";
  attemptedConstraint?: Constraint;
  constraintIds: ID[];
  alternatives: Array<{ id: ID; proposalId?: ID; actionId?: ID }>;
  emphasis?: SemanticEmphasis;
}
```

Use one to three grounded compromise paths. Existing-trip alternatives use proposals. Initial-planning recovery may use typed clarification/action IDs because no committed trip exists.

Validation rules:

- code chooses the component family;
- all IDs, dimensions, facts, and actions come from the domain contract;
- the model does not copy prices, ratings, or inventory into block props;
- invalid emphasis falls back to deterministic semantic copy;
- React owns JSX, layout, styling, accessibility, and event handling.

---

# 24. Application and API state

Inventory endpoints are declared in section 8. The P0 agent endpoints are:

```text
POST /api/agent/discover
POST /api/agent/intake
POST /api/agent/plan
POST /api/agent/modify
POST /api/agent/explain
GET /api/health/inventory
```

`GET /api/health/inventory` performs one minimal `inventory_meta` read and is never cached. The client calls it once when the workspace loads so a suspended Neon compute begins waking before the user searches or plans. The header shows the real readiness result and exposes manual retry when unavailable.

The runtime read-only database client retries transient network failures and HTTP `408`, `425`, `429`, `500`, `502`, `503`, and `504` responses at most three times with short bounded backoff. It never retries query-validation, authentication, permission, or other permanent `4xx` failures. The retry transport is installed only by the runtime database factory; admin migration and seed writes do not inherit replay behavior.

```ts
export interface AgentApiRequest {
  message: string;
  context:
    | { kind: "draft"; request: TripRequest }
    | { kind: "trip"; trip: TripState };
}

export type AgentResult =
  | { type: "request_updated"; request: TripRequest; message: string }
  | { type: "clarification"; config: RequiredClarification | OptionalClarification | SelectionClarification; message: string }
  | { type: "destination_options"; block: OptionComparisonBlock; factBundle: FactBundle; message: string }
  | { type: "trip_ready"; trip: TripState; projection: TripProjection; message: string; actionSummary: string[] }
  | { type: "alternatives"; proposals: TripProposal[]; block: OptionComparisonBlock; factBundle: FactBundle; message: string }
  | { type: "proposal"; proposal: TripProposal; block: ChangeProposalBlock; factBundle: FactBundle; message: string }
  | { type: "conflict"; proposals: TripProposal[]; block: ConstraintConflictBlock; factBundle: FactBundle; message: string }
  | { type: "explanation"; message: string; supportingFactIds: ID[]; factBundle: FactBundle }
  | { type: "error"; error: AppError; message: string };
```

The endpoint returns typed progress events followed by one final `AgentResult`. A streaming NDJSON response is preferred. If streaming threatens P0 stability, render one honest in-progress state and a post-completion action summary; do not use fake timed stages.

The client reducer owns only:

- draft request;
- optional committed trip;
- current derived projection cache;
- proposal map;
- latest domain outcome;
- conversation display;
- transient async status.

Empty/collecting/ready/proposal/conflict views are derived. Do not store a duplicate phase machine.

---

# 25. UI and design-system contract

Stable UI:

- desktop two-panel layout;
- Trip Brief;
- chat shell and composer;
- itinerary timeline;
- Travel, Stays, and Activities tabs;
- budget summary;
- search/planning status;
- travel, stay, activity, and transfer cards;
- loading, no-result, unsupported, unavailable, warning, locked, and error states.

Adaptive UI is restricted to the three interaction families in section 23.

Start with seven primitives:

1. `Button`;
2. `IconButton`;
3. `Input`;
4. `Chip`;
5. `Badge`;
6. `Card`;
7. `Tabs`.

Add `Dialog`, `Tooltip`, `Skeleton`, or `Divider` only when required.

Persistent travel components:

1. `TripBrief`;
2. `TravelCard`;
3. `StayCard`;
4. `ActivityCard`;
5. `ItineraryDay`;
6. `BudgetSummary`.

Use CSS variables for semantic color, spacing, radius, typography, shadow, and motion. Do not allow the model to select tokens or variants.

Card states use one shared grammar:

```ts
export type EntityCardState =
  | "default"
  | "recommended"
  | "selected"
  | "locked"
  | "unavailable"
  | "conflict";
```

---

# 26. Errors and reliability

```ts
export interface AppError {
  code:
    | "UNSUPPORTED_COVERAGE"
    | "OUTSIDE_INVENTORY_WINDOW"
    | "NO_AVAILABILITY"
    | "NO_HARD_VALID_RESULT"
    | "DATABASE_FAILURE"
    | "INVALID_MODEL_OUTPUT"
    | "TOOL_BUDGET_EXCEEDED"
    | "STALE_PROPOSAL"
    | "INVALID_PROPOSAL";
  message: string;
  retryable: boolean;
  constraintIds?: ID[];
}
```

Rules:

- preserve the current draft/trip on all failures;
- never convert a database failure into invented inventory;
- distinguish unsupported location, route, date window, availability, and constraint elimination;
- invalid model IDs or facts are rejected;
- use deterministic selection/copy fallback only where the domain has sufficient facts;
- otherwise return a typed error with retry;
- no model retry exists except the single structured validation-repair opportunity;
- a stale or invalid proposal never mutates the trip.

---

# 27. Tests and acceptance checks

## Database and seed

- migrate from an empty database;
- seed twice with the same result;
- verify `inventoryVersion`;
- enforce foreign keys and unique IDs;
- reject invalid price units, date windows, timezones, or orphan locations;
- verify all 20 markets against the base coverage contract;
- prove the runtime role cannot write;
- ensure no destination names exist in planner/domain conditionals.

Integration and contract tests use a dedicated Neon branch seeded with the same version as production. They must never use the production branch or credentials.

## Inventory contracts

- location aliases resolve to one normalized ID;
- excluding runtime metadata such as `generatedAt`, the same query and seed version return the same ordered facts/offers;
- changed origin, date, occupancy, or constraints materially affect results where seed data supports it;
- every returned offer resolves through `resolveOffer`;
- API responses never expose database-only fields;
- unsupported, unavailable, outside-window, and hard-filtered results remain distinct;
- pricing units and timezone offsets are explicit.

## Agent behavior

- specified destination skips discovery when unnecessary;
- open-ended request uses grounded discovery;
- different goals produce different relevant tool plans;
- explanation triggers no unnecessary search;
- first evidence may produce one materially different second search;
- total tool budget is enforced;
- unknown tool/candidate/fact IDs are rejected;
- the model cannot select a hard-invalid candidate;
- every comparison cites supplied facts;
- a second invalid assembled strategy stops rather than looping.

## Trip and proposals

- itinerary and budget recompute from selections;
- initial plans meet pace-based distinct activity-day coverage, while approved later changes may intentionally preserve open time;
- days without selected activities contain an explicit derived `free_time` event;
- five inclusive trip days produce four accommodation nights;
- multi-stop stays cover every night without overlap;
- multi-stop plans use the same location-graph, tool, assembly, and validation code for every market; destination names never select a route implementation;
- a selected candidate outside the declared route is rejected before assembly;
- every adjacent stop boundary has exactly one validated transfer selection;
- hard early-departure and mobility constraints filter correctly;
- target budget creates a warning; maximum budget creates an error;
- scoped stay change preserves travel and unrelated activities;
- locked replacement without explicit unlock is rejected;
- direct lock click produces a typed operation;
- adding an activity from any itinerary day creates a proposal and preserves the base trip until approval;
- stale proposal is rejected;
- proposal UI equals its derived preview;
- apply increments version exactly once.

## Demonstration flows

1. open-ended beach discovery from a supported origin;
2. specified Udaipur planning;
3. inventory-supported Thailand multi-stop planning;
4. scoped second-stay replacement preserving flights and first stay;
5. impossible budget with locked selections and grounded compromises;
6. a separate seeded market completing the same base flow without code changes.
7. add a second schedule-valid activity to either an occupied or open itinerary day through comparison and proposal approval.

## UI and failure states

- loading reflects real work or one honest pending state;
- database/API failure preserves current state and offers retry;
- a suspended database is warmed on page load, transient runtime reads use a bounded retry budget, and the UI reports actual inventory readiness;
- no-result copy identifies the correct cause;
- invalid semantic emphasis never renders arbitrary content;
- all selection/lock/proposal actions are keyboard accessible;
- synthetic inventory disclosure is visible.

---

# 28. Folder structure

```text
src/
  app/
    api/
      agent/route.ts
      locations/search/route.ts
      inventory/
        destinations/discover/route.ts
        transport/search/route.ts
        stays/search/route.ts
        activities/search/route.ts
        transfers/search/route.ts
    page.tsx

  agent/
    contracts.ts
    planner.ts
    tools.ts

  db/
    schema.ts
    client.ts
    seed/

  inventory/
    contracts.ts
    repository.ts
    service.ts

  domain/
    model.ts
    constraints.ts
    planning.ts
    derived.ts
    validation.ts
    proposals.ts

  ui/
    components.tsx
    interactions.tsx
    tokens.css

  state.ts

tests/
  unit/
  integration/
  contracts/
  agent-evals/
  e2e/

drizzle/
```

Keep the physical structure small. Split a file only when size or ownership justifies it. Do not create destination folders, provider microservices, generic repositories per table, or abstractions that exist only for hypothetical future suppliers.

---

# 29. Implementation order

Build vertical slices in this order:

1. shared types, date/money semantics, and normalized locations;
2. Drizzle schema, migration, read-only role, and minimal seed;
3. inventory repository/service and offer resolution;
4. search API contracts and failure taxonomy;
5. required request and constraint validation;
6. deterministic route, budget, itinerary, and final validation;
7. typed agent intent, hypothesis, tools, and observation contracts;
8. specified-destination PLAN flow using one representative market;
9. persistent workspace and honest loading/error states;
10. open-ended discovery and evidence refinement;
11. multi-stop route flow using ordinary location relationships;
12. scoped modification, proposals, versioning, and locks;
13. grounded explanation and adaptive components;
14. expand and validate the seed manifest to all 20 markets;
15. run the complete acceptance/eval suite;
16. deploy and smoke-test on Vercel.

Do not author all destination data before one end-to-end database-backed vertical slice works. Do not leave the twenty-market coverage test until after deployment.

---

# 30. P1, P2, and forbidden scope

P1:

- comprehensive outbound and return transport coverage from all six normalized origin hubs to every P0 market;
- inline “Why this?”;
- undo last applied proposal;
- richer comparison details and animations;
- improved progress streaming and empty-state polish.

P2:

- participant-specific activities;
- alternate activities for subsets;
- lightweight schematic map visualization from stored coordinates. Revisit only during end-to-end testing: derive markers and route arcs from `TripProjection`, and bind scanning/loading motion to actual pending request state. Exact road geometry requires later stored route shapes or an external routing provider and remains outside P0;
- richer motion.

Forbidden during P0:

- live/private travel APIs or scraping;
- booking, payment, auth, loyalty, or user profiles;
- runtime inventory writes or admin UI;
- trip/proposal database persistence;
- weather, visas, currency conversion, or maps APIs;
- dynamic yield pricing or detailed room allocation;
- RAG, MCP, vector search, or multiple agents;
- arbitrary generated JSX;
- unbounded tool loops;
- full per-traveller itineraries or collaboration;
- destination-specific planning functions;
- additional destination markets;
- a generic workflow engine or enterprise microservice architecture.

---

# 31. Known recommendations and blockers

## Recommendation — treat inventory quality as a product surface

Twenty markets create a data-authoring burden. Meet the base coverage contract first, then improve distinctiveness. Automated coverage checks are mandatory; manual confidence is insufficient.

## Recommendation — keep the inventory boundary honest

The client receives all inventory through server APIs, but server-side agent tools call the shared inventory service directly. Server-to-self HTTP would add latency without increasing realism.

## Recommendation — preserve deterministic demo behavior

Fix the inventory version and supported date window for the submission. Do not introduce random availability or prices. Model prose may vary; selected facts, IDs, calculations, and validation must remain reproducible.

## Recommendation — show agency through behavior, not animation

The strongest proof is selective tool use, evidence-driven refinement, scoped modification, and honest stopping. Decorative progress or a large number of tool calls does not make the product more agentic.

## Blocker — model credentials

The primary agentic path requires a valid server-side OpenAI key and supported structured outputs. The application must expose a clear invalid/unavailable-model state. Deterministic copy fallback does not replace the core agentic demonstration.

## Blocker — incomplete market coverage

A market cannot be declared supported until its coverage test passes. If time is constrained, reduce declared coverage only through an explicit product-scope decision; do not silently return fabricated plans.

---

# 32. Final architecture checklist

Before implementation or after any architectural change, verify:

1. Is any inventory, trip, budget, itinerary, badge, or proposal value canonically owned twice?
2. Can the model invent a fact, bypass a hard constraint, mutate state, or change a lock?
3. Can every selected offer be reconstructed from its ID and inventory version?
4. Are database, REST, agent-tool, domain, and UI identifiers consistent?
5. Are price units and date boundaries explicit everywhere?
6. Can a stated P0 flow be completed by the declared schema and functions?
7. Can the workflow enter an impossible transition or exceed its search/revision budget?
8. Does modification preserve unrelated and locked selections?
9. Is an agent decision operational, or is it ignored by a fixed pipeline?
10. Are explanations and adaptive emphasis grounded in supplied facts?
11. Can a new seed market work without planner/domain/UI code changes?
12. Are unsupported coverage, no availability, hard-filter failure, model failure, and database failure distinct?
13. Is any abstraction present only to mimic production scale rather than serve P0?
14. Do all twenty market coverage tests and the six demonstration flows pass?

If any answer is unclear, resolve the specification before adding application code.
