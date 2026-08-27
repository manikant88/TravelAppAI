import { z } from "zod";
import { addCalendarDays, calendarDayDifference, isValidISODate } from "@/domain/dates";
import { addMoney, multiplyMoney, subtractMoney } from "@/domain/money";
import { plannableTripRequestSchema, requirePlannableRequest } from "@/domain/request";
import type {
  ActivitySelection,
  Constraint,
  ID,
  ISODate,
  ISODateTime,
  Money,
  SelectionID,
  StaySelection,
  TravelSelection,
  TripState,
} from "@/domain/model";
import type {
  ActivityOffer,
  StayOffer,
  TransferOffer,
  TransportOffer,
} from "@/inventory/contracts";

export type ResolvedOffer = TransportOffer | TransferOffer | StayOffer | ActivityOffer;

export interface HydratedSelection {
  selectionId: SelectionID;
  kind: "travel" | "stay" | "activity";
  offer: ResolvedOffer;
}

export interface TripBudget {
  target?: Money;
  maximum?: Money;
  total: Money;
  breakdown: { travel: Money; stays: Money; activities: Money };
  deltaFromTarget?: Money;
  amountOverMaximum?: Money;
}

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
  locationId: string;
  events: ItineraryEvent[];
}

export type ValidationSeverity = "info" | "warning" | "error";
export type ValidationCode =
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

export interface ValidationIssue {
  id: ID;
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  selectionIds?: SelectionID[];
  constraintIds?: ID[];
}

export interface TripValidation {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface TripProjection {
  hydratedSelections: HydratedSelection[];
  budget: TripBudget;
  itinerary: ItineraryDay[];
  validation: TripValidation;
  badgesByCandidateId: Record<ID, string[]>;
}

export interface LocationNode {
  id: string;
  parentId?: string;
}

export interface TripProjectionContext {
  resolveOffer(offerId: string): Promise<ResolvedOffer>;
  locationGraph: LocationNode[];
}

const selectionBase = {
  id: z.string().min(1),
  travellerIds: z.array(z.string().min(1)).min(1),
  locked: z.boolean(),
};
const travelSelectionSchema = z
  .object({
    ...selectionBase,
    kind: z.literal("travel"),
    offerKind: z.enum(["transport", "transfer"]),
    offerId: z.string().min(1),
  })
  .strict();
const staySelectionSchema = z
  .object({
    ...selectionBase,
    kind: z.literal("stay"),
    offerId: z.string().min(1),
    checkIn: z.string().refine(isValidISODate),
    checkOut: z.string().refine(isValidISODate),
    rooms: z.number().int().positive(),
  })
  .strict();
const activitySelectionSchema = z
  .object({
    ...selectionBase,
    kind: z.literal("activity"),
    offerId: z.string().min(1),
    date: z.string().refine(isValidISODate),
  })
  .strict();

export const tripStateSchema = z
  .object({
    id: z.string().min(1),
    inventoryVersion: z.string().min(1),
    request: plannableTripRequestSchema,
    route: z
      .object({
        marketId: z.string().min(1),
        stops: z
          .array(
            z
              .object({
                locationId: z.string().min(1),
                checkIn: z.string().refine(isValidISODate),
                checkOut: z.string().refine(isValidISODate),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    selectedTravel: z.array(travelSelectionSchema),
    selectedStays: z.array(staySelectionSchema),
    selectedActivities: z.array(activitySelectionSchema),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((trip, context) => {
    const selections = [...trip.selectedTravel, ...trip.selectedStays, ...trip.selectedActivities];
    const selectionIds = selections.map((selection) => selection.id);
    if (new Set(selectionIds).size !== selectionIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Selection IDs must be globally unique", path: ["selectedTravel"] });
    }
    const travellerIds = new Set(trip.request.travellers.map((traveller) => traveller.id));
    selections.forEach((selection) => {
      selection.travellerIds.forEach((travellerId) => {
        if (!travellerIds.has(travellerId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown selection traveller ID: ${travellerId}`,
            path: ["selectedTravel"],
          });
        }
      });
    });
  });

function isTransportOffer(offer: ResolvedOffer): offer is TransportOffer {
  return "serviceId" in offer;
}
function isTransferOffer(offer: ResolvedOffer): offer is TransferOffer {
  return "transferId" in offer;
}
function isStayOffer(offer: ResolvedOffer): offer is StayOffer {
  return "roomOfferId" in offer;
}
function isActivityOffer(offer: ResolvedOffer): offer is ActivityOffer {
  return "sessionId" in offer;
}

function allSelections(trip: TripState) {
  return [...trip.selectedTravel, ...trip.selectedStays, ...trip.selectedActivities];
}

function selectionById(trip: TripState): Map<string, TravelSelection | StaySelection | ActivitySelection> {
  return new Map(allSelections(trip).map((selection) => [selection.id, selection]));
}

function issue(
  code: ValidationCode,
  severity: ValidationSeverity,
  key: string,
  message: string,
  selectionIds?: string[],
  constraintIds?: string[],
): ValidationIssue {
  return {
    id: `issue:${code.toLocaleLowerCase("en")}:${key}`,
    code,
    severity,
    message,
    selectionIds,
    constraintIds,
  };
}

function offerMatchesSelection(
  selection: TravelSelection | StaySelection | ActivitySelection,
  offer: ResolvedOffer,
): boolean {
  if (selection.kind === "travel") {
    return selection.offerKind === "transport" ? isTransportOffer(offer) : isTransferOffer(offer);
  }
  if (selection.kind === "stay") return isStayOffer(offer);
  return isActivityOffer(offer);
}

async function hydrateTrip(
  trip: TripState,
  resolver: TripProjectionContext["resolveOffer"],
): Promise<{ hydrated: HydratedSelection[]; issues: ValidationIssue[] }> {
  const resolved = await Promise.all(
    allSelections(trip).map(async (selection) => {
      try {
        const offer = await resolver(selection.offerId);
        if (!offerMatchesSelection(selection, offer)) {
          return {
            issue: issue(
              "OFFER_NOT_FOUND",
              "error",
              selection.id,
              `Resolved offer type does not match selection ${selection.id}`,
              [selection.id],
            ),
          };
        }
        return {
          hydrated: { selectionId: selection.id, kind: selection.kind, offer } as HydratedSelection,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Offer resolution failed";
        const versionMismatch = message.toLocaleLowerCase("en").includes("version");
        return {
          issue: issue(
            versionMismatch ? "INVENTORY_VERSION_MISMATCH" : "OFFER_NOT_FOUND",
            "error",
            selection.id,
            versionMismatch
              ? `Selection ${selection.id} references a stale inventory version`
              : `Selection ${selection.id} could not be resolved`,
            [selection.id],
          ),
        };
      }
    }),
  );
  return {
    hydrated: resolved.flatMap((result) => (result.hydrated ? [result.hydrated] : [])),
    issues: resolved.flatMap((result) => (result.issue ? [result.issue] : [])),
  };
}

function withinLocationScope(candidate: string, scope: string, graph: LocationNode[]): boolean {
  if (candidate === scope) return true;
  const nodes = new Map(graph.map((node) => [node.id, node]));
  let current = nodes.get(candidate);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.id === scope) return true;
    visited.add(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return false;
}

function relatedLocations(left: string, right: string, graph: LocationNode[]): boolean {
  return withinLocationScope(left, right, graph) || withinLocationScope(right, left, graph);
}

function applicable(constraint: Constraint, selectionTravellerIds: string[]): boolean {
  return (
    !constraint.travellerIds?.length ||
    constraint.travellerIds.some((travellerId) => selectionTravellerIds.includes(travellerId))
  );
}

function constraintSeverity(constraint: Constraint): ValidationSeverity {
  return constraint.priority === "hard" ? "error" : "warning";
}

export function calculateTripBudget(trip: TripState, hydrated: HydratedSelection[]): TripBudget {
  const selections = selectionById(trip);
  const travel: Money[] = [];
  const stays: Money[] = [];
  const activities: Money[] = [];

  hydrated.forEach(({ selectionId, offer }) => {
    const selection = selections.get(selectionId);
    if (!selection) return;
    if (selection.kind === "travel" && isTransportOffer(offer)) {
      travel.push(multiplyMoney(offer.price, selection.travellerIds.length));
    } else if (selection.kind === "travel" && isTransferOffer(offer)) {
      travel.push(multiplyMoney(offer.price, Math.ceil(selection.travellerIds.length / offer.capacity)));
    } else if (selection.kind === "stay" && isStayOffer(offer)) {
      const nights = calendarDayDifference(selection.checkIn, selection.checkOut);
      stays.push(multiplyMoney(offer.price, nights * selection.rooms));
    } else if (selection.kind === "activity" && isActivityOffer(offer)) {
      activities.push(multiplyMoney(offer.price, selection.travellerIds.length));
    }
  });

  const budgetConstraint = trip.request.constraints.find(
    (constraint) => constraint.category === "budget" && !constraint.travellerIds?.length,
  );
  const breakdown = {
    travel: addMoney(travel),
    stays: addMoney(stays),
    activities: addMoney(activities),
  };
  const total = addMoney(Object.values(breakdown));
  const target = budgetConstraint?.category === "budget" ? budgetConstraint.value.targetTotal : undefined;
  const maximum = budgetConstraint?.category === "budget" ? budgetConstraint.value.maxTotal : undefined;
  return {
    target,
    maximum,
    total,
    breakdown,
    deltaFromTarget: target ? subtractMoney(total, target) : undefined,
    amountOverMaximum:
      maximum && total.amount > maximum.amount ? subtractMoney(total, maximum) : undefined,
  };
}

function routeDateForTransfer(offer: TransferOffer, trip: TripState, graph: LocationNode[]): ISODate | undefined {
  for (let index = 0; index < trip.route.stops.length - 1; index += 1) {
    const from = trip.route.stops[index];
    const to = trip.route.stops[index + 1];
    if (
      relatedLocations(offer.from, from.locationId, graph) &&
      relatedLocations(offer.to, to.locationId, graph)
    ) {
      return to.checkIn;
    }
  }
  const firstStop = trip.route.stops[0];
  const lastStop = trip.route.stops.at(-1)!;
  if (
    relatedLocations(offer.from, trip.route.marketId, graph) &&
    relatedLocations(offer.to, firstStop.locationId, graph)
  ) {
    return trip.request.startDate;
  }
  if (
    relatedLocations(offer.from, lastStop.locationId, graph) &&
    relatedLocations(offer.to, trip.route.marketId, graph)
  ) {
    return trip.request.endDate;
  }
  return undefined;
}

function dayLocation(date: ISODate, trip: TripState): string {
  const stop = trip.route.stops.find((candidate) => candidate.checkIn <= date && date < candidate.checkOut);
  return stop?.locationId ?? trip.route.stops.at(-1)?.locationId ?? trip.route.marketId;
}

export function buildItinerary(
  trip: TripState,
  hydrated: HydratedSelection[],
  graph: LocationNode[],
): ItineraryDay[] {
  const dayCount = calendarDayDifference(trip.request.startDate, trip.request.endDate) + 1;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = addCalendarDays(trip.request.startDate, index);
    return { date, dayNumber: index + 1, locationId: dayLocation(date, trip), events: [] } as ItineraryDay;
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  const selections = selectionById(trip);

  hydrated.forEach(({ selectionId, offer }) => {
    const selection = selections.get(selectionId);
    if (!selection) return;
    let date: ISODate | undefined;
    let event: ItineraryEvent;
    if (selection.kind === "travel" && isTransportOffer(offer)) {
      date = offer.departureAt.slice(0, 10);
      event = {
        id: `event:${selection.id}`,
        type: "travel",
        selectionId: selection.id,
        startAt: offer.departureAt,
        endAt: offer.arrivalAt,
        title: `${offer.operator} ${offer.mode}`,
        travellerIds: selection.travellerIds,
      };
    } else if (selection.kind === "travel" && isTransferOffer(offer)) {
      date = routeDateForTransfer(offer, trip, graph);
      event = {
        id: `event:${selection.id}`,
        type: "travel",
        selectionId: selection.id,
        title: `${offer.mode} transfer`,
        travellerIds: selection.travellerIds,
      };
    } else if (selection.kind === "stay" && isStayOffer(offer)) {
      date = selection.checkIn;
      event = {
        id: `event:${selection.id}`,
        type: "stay",
        selectionId: selection.id,
        title: `Stay at ${offer.propertyFacts.name}`,
        travellerIds: selection.travellerIds,
      };
    } else if (selection.kind === "activity" && isActivityOffer(offer)) {
      date = offer.startsAt.slice(0, 10);
      event = {
        id: `event:${selection.id}`,
        type: "activity",
        selectionId: selection.id,
        startAt: offer.startsAt,
        endAt: offer.endsAt,
        title: offer.activityFacts.name,
        travellerIds: selection.travellerIds,
      };
    } else {
      return;
    }
    if (date) byDate.get(date)?.events.push(event);
  });

  days.forEach((day) =>
    day.events.sort(
      (left, right) =>
        (left.startAt ?? "9999").localeCompare(right.startAt ?? "9999", "en") ||
        left.id.localeCompare(right.id, "en"),
    ),
  );
  return days;
}

function validateRoute(trip: TripState, graph: LocationNode[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    trip.request.destination.kind === "specified" &&
    !withinLocationScope(trip.route.marketId, trip.request.destination.locationId, graph)
  ) {
    issues.push(issue("ROUTE_GAP", "error", "destination-scope", `Route market ${trip.route.marketId} is outside requested destination ${trip.request.destination.locationId}`));
  }
  trip.route.stops.forEach((stop, index) => {
    if (!withinLocationScope(stop.locationId, trip.route.marketId, graph)) {
      issues.push(issue("ROUTE_GAP", "error", `market-${index}`, `Stop ${stop.locationId} is outside market ${trip.route.marketId}`));
    }
    const expectedCheckIn = index === 0 ? trip.request.startDate : trip.route.stops[index - 1].checkOut;
    if (stop.checkIn !== expectedCheckIn || stop.checkOut <= stop.checkIn) {
      issues.push(issue("ROUTE_GAP", "error", `stop-${index}`, `Route stop ${stop.locationId} does not begin at the required boundary`));
    }
  });
  if (trip.route.stops.at(-1)?.checkOut !== trip.request.endDate) {
    issues.push(issue("ROUTE_GAP", "error", "final-night", "Route stops do not cover every trip night"));
  }
  return issues;
}

function validateStayCoverage(
  trip: TripState,
  hydrated: HydratedSelection[],
  graph: LocationNode[],
): ValidationIssue[] {
  const selections = selectionById(trip);
  const stays = hydrated.flatMap((item) => {
    const selection = selections.get(item.selectionId);
    return selection?.kind === "stay" && isStayOffer(item.offer)
      ? [{ selection, offer: item.offer }]
      : [];
  });
  const issues: ValidationIssue[] = [];
  trip.route.stops.forEach((stop, index) => {
    const matches = stays.filter(
      ({ selection, offer }) =>
        selection.checkIn === stop.checkIn &&
        selection.checkOut === stop.checkOut &&
        offer.checkIn === selection.checkIn &&
        offer.checkOut === selection.checkOut &&
        offer.rooms === selection.rooms &&
        relatedLocations(offer.locationId, stop.locationId, graph),
    );
    if (matches.length !== 1) {
      issues.push(
        issue(
          "STAY_CONFLICT",
          "error",
          `stop-${index}`,
          `Route stop ${stop.locationId} requires exactly one matching stay`,
          matches.map(({ selection }) => selection.id),
        ),
      );
    }
  });
  stays.forEach(({ selection, offer }) => {
    const belongsToStop = trip.route.stops.some(
      (stop) =>
        selection.checkIn === stop.checkIn &&
        selection.checkOut === stop.checkOut &&
        withinLocationScope(offer.locationId, stop.locationId, graph),
    );
    if (!belongsToStop) {
      issues.push(issue("STAY_CONFLICT", "error", `extra-${selection.id}`, `Stay ${selection.id} does not correspond to a route stop`, [selection.id]));
    }
  });
  return issues;
}

function validateTravelRoute(
  trip: TripState,
  hydrated: HydratedSelection[],
  graph: LocationNode[],
): ValidationIssue[] {
  const selections = selectionById(trip);
  const travel = hydrated.flatMap((item) => {
    const selection = selections.get(item.selectionId);
    return selection?.kind === "travel" ? [{ selection, offer: item.offer }] : [];
  });
  const transports = travel.filter(
    (item): item is { selection: TravelSelection; offer: TransportOffer } => isTransportOffer(item.offer),
  );
  const transfers = travel.filter(
    (item): item is { selection: TravelSelection; offer: TransferOffer } => isTransferOffer(item.offer),
  );
  const firstStop = trip.route.stops[0];
  const lastStop = trip.route.stops.at(-1)!;
  const outbound = transports.filter(
    ({ offer }) =>
      relatedLocations(offer.from, trip.request.origin, graph) &&
      relatedLocations(offer.to, trip.route.marketId, graph) &&
      offer.arrivalAt.slice(0, 10) === trip.request.startDate,
  );
  const returning = transports.filter(
    ({ offer }) =>
      relatedLocations(offer.from, trip.route.marketId, graph) &&
      relatedLocations(offer.to, trip.request.origin, graph) &&
      offer.departureAt.slice(0, 10) === trip.request.endDate,
  );
  const issues: ValidationIssue[] = [];
  const usedSelectionIds = new Set<string>();
  outbound.forEach(({ selection }) => usedSelectionIds.add(selection.id));
  returning.forEach(({ selection }) => usedSelectionIds.add(selection.id));
  if (outbound.length !== 1) issues.push(issue("ROUTE_GAP", "error", "outbound", "Trip requires one date-aligned outbound transport", outbound.map(({ selection }) => selection.id)));
  if (returning.length !== 1) issues.push(issue("ROUTE_GAP", "error", "return", "Trip requires one date-aligned return transport", returning.map(({ selection }) => selection.id)));

  if (outbound.length === 1 && !relatedLocations(outbound[0].offer.to, firstStop.locationId, graph)) {
    const arrivalTransfers = transfers.filter(
      ({ offer }) =>
        relatedLocations(offer.from, outbound[0].offer.to, graph) &&
        relatedLocations(offer.to, firstStop.locationId, graph),
    );
    arrivalTransfers.forEach(({ selection }) => usedSelectionIds.add(selection.id));
    if (arrivalTransfers.length !== 1) {
      issues.push(issue("TRANSFER_CONFLICT", "error", "arrival", `Arrival point ${outbound[0].offer.to} requires one transfer to ${firstStop.locationId}`, arrivalTransfers.map(({ selection }) => selection.id)));
    }
  }
  if (returning.length === 1 && !relatedLocations(lastStop.locationId, returning[0].offer.from, graph)) {
    const departureTransfers = transfers.filter(
      ({ offer }) =>
        relatedLocations(offer.from, lastStop.locationId, graph) &&
        relatedLocations(offer.to, returning[0].offer.from, graph),
    );
    departureTransfers.forEach(({ selection }) => usedSelectionIds.add(selection.id));
    if (departureTransfers.length !== 1) {
      issues.push(issue("TRANSFER_CONFLICT", "error", "departure", `Route end ${lastStop.locationId} requires one transfer to ${returning[0].offer.from}`, departureTransfers.map(({ selection }) => selection.id)));
    }
  }

  for (let index = 0; index < trip.route.stops.length - 1; index += 1) {
    const from = trip.route.stops[index];
    const to = trip.route.stops[index + 1];
    const matches = transfers.filter(
      ({ offer }) => relatedLocations(offer.from, from.locationId, graph) && relatedLocations(offer.to, to.locationId, graph),
    );
    matches.forEach(({ selection }) => usedSelectionIds.add(selection.id));
    if (matches.length !== 1) {
      issues.push(issue("TRANSFER_CONFLICT", "error", `boundary-${index}`, `Route boundary ${from.locationId} to ${to.locationId} requires one transfer`, matches.map(({ selection }) => selection.id)));
    }
  }
  travel.forEach(({ selection }) => {
    if (!usedSelectionIds.has(selection.id)) {
      issues.push(
        issue(
          isTransferOffer(travel.find((item) => item.selection.id === selection.id)!.offer)
            ? "TRANSFER_CONFLICT"
            : "DATE_CONFLICT",
          "error",
          `unmapped-${selection.id}`,
          `Travel ${selection.id} does not map to a required route leg`,
          [selection.id],
        ),
      );
    }
  });
  return issues;
}

const mobilityRank = { low: 0, medium: 1, high: 2 } as const;

function validateConstraints(
  trip: TripState,
  hydrated: HydratedSelection[],
): ValidationIssue[] {
  const selections = selectionById(trip);
  const issues: ValidationIssue[] = [];
  for (const item of hydrated) {
    const selection = selections.get(item.selectionId);
    if (!selection) continue;
    for (const constraint of trip.request.constraints) {
      if (!applicable(constraint, selection.travellerIds)) continue;
      const severity = constraintSeverity(constraint);
      if (constraint.category === "travel" && isTransportOffer(item.offer)) {
        const departure = item.offer.departureAt.slice(11, 16);
        const arrival = item.offer.arrivalAt.slice(11, 16);
        if (constraint.value.earliestDeparture && departure < constraint.value.earliestDeparture) {
          issues.push(issue("EARLY_TRAVEL_CONFLICT", severity, `${selection.id}-${constraint.id}`, `Travel ${selection.id} departs before ${constraint.value.earliestDeparture}`, [selection.id], [constraint.id]));
        }
        if (
          (constraint.value.latestArrival && arrival > constraint.value.latestArrival) ||
          (constraint.value.maxStops !== undefined && item.offer.stops > constraint.value.maxStops)
        ) {
          issues.push(issue("DATE_CONFLICT", severity, `${selection.id}-${constraint.id}`, `Travel ${selection.id} violates timing or stop limits`, [selection.id], [constraint.id]));
        }
        if (constraint.value.allowedModes && !constraint.value.allowedModes.includes(item.offer.mode)) {
          issues.push(issue("TRAVEL_MODE_CONFLICT", severity, `${selection.id}-${constraint.id}`, `Travel mode ${item.offer.mode} is not allowed`, [selection.id], [constraint.id]));
        }
      }
      if (constraint.category === "stay" && isStayOffer(item.offer)) {
        const amenities = new Set(item.offer.propertyFacts.amenities.map((value) => value.toLocaleLowerCase("en")));
        const missingAmenity = constraint.value.requiredAmenities?.some((value) => !amenities.has(value.toLocaleLowerCase("en")));
        const seniorMismatch = constraint.value.seniorFriendly === true && !item.offer.propertyFacts.tags.includes("senior_friendly");
        const priceMismatch = constraint.value.maxNightlyPrice && item.offer.price.amount > constraint.value.maxNightlyPrice.amount;
        const roomsMismatch = constraint.value.requiredRooms !== undefined && (selection.kind !== "stay" || selection.rooms < constraint.value.requiredRooms);
        if (missingAmenity || seniorMismatch || priceMismatch || roomsMismatch) {
          issues.push(issue("STAY_CONFLICT", severity, `${selection.id}-${constraint.id}`, `Stay ${selection.id} does not satisfy constraint ${constraint.id}`, [selection.id], [constraint.id]));
        }
      }
      if (constraint.category === "activity" && isActivityOffer(item.offer)) {
        const facts = item.offer.activityFacts;
        const mismatch =
          (constraint.value.maxMobility && mobilityRank[facts.mobility] > mobilityRank[constraint.value.maxMobility]) ||
          (constraint.value.childFriendly !== undefined && facts.childFriendly !== constraint.value.childFriendly) ||
          (constraint.value.seniorFriendly !== undefined && facts.seniorFriendly !== constraint.value.seniorFriendly);
        if (mismatch) {
          issues.push(issue("MOBILITY_CONFLICT", severity, `${selection.id}-${constraint.id}`, `Activity ${selection.id} does not satisfy mobility or suitability constraints`, [selection.id], [constraint.id]));
        }
      }
    }
  }
  return issues;
}

function validateSelectionDates(
  trip: TripState,
  hydrated: HydratedSelection[],
  graph: LocationNode[],
): ValidationIssue[] {
  const selections = selectionById(trip);
  return hydrated.flatMap(({ selectionId, offer }) => {
    const selection = selections.get(selectionId);
    if (selection?.kind === "activity" && isActivityOffer(offer)) {
      const offerDate = offer.startsAt.slice(0, 10);
      const routeLocation = dayLocation(selection.date, trip);
      if (
        selection.date !== offerDate ||
        selection.date < trip.request.startDate ||
        selection.date > trip.request.endDate ||
        !withinLocationScope(offer.locationId, routeLocation, graph) ||
        selection.travellerIds.length > offer.capacity
      ) {
        return [issue("DATE_CONFLICT", "error", selection.id, `Activity ${selection.id} is outside its selected trip date`, [selection.id])];
      }
    }
    if (
      selection?.kind === "stay" &&
      isStayOffer(offer) &&
      (selection.checkIn !== offer.checkIn ||
        selection.checkOut !== offer.checkOut ||
        selection.rooms !== offer.rooms ||
        selection.rooms * offer.roomFacts.maxOccupancy < selection.travellerIds.length)
    ) {
      return [issue("DATE_CONFLICT", "error", selection.id, `Stay ${selection.id} does not match its resolved dated offer`, [selection.id])];
    }
    return [];
  });
}

function timedIntervals(trip: TripState, hydrated: HydratedSelection[]) {
  const selections = selectionById(trip);
  return hydrated.flatMap(({ selectionId, offer }) => {
    const selection = selections.get(selectionId);
    if (!selection) return [];
    if (isTransportOffer(offer)) return [{ selection, startAt: offer.departureAt, endAt: offer.arrivalAt, minutes: offer.durationMinutes }];
    if (isActivityOffer(offer)) return [{ selection, startAt: offer.startsAt, endAt: offer.endsAt, minutes: Math.round((Date.parse(offer.endsAt) - Date.parse(offer.startsAt)) / 60_000) }];
    return [];
  });
}

function validateSchedule(
  trip: TripState,
  hydrated: HydratedSelection[],
  graph: LocationNode[],
): ValidationIssue[] {
  const intervals = timedIntervals(trip, hydrated);
  const issues: ValidationIssue[] = [];
  for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < intervals.length; rightIndex += 1) {
      const left = intervals[leftIndex];
      const right = intervals[rightIndex];
      if (
        left.selection.travellerIds.some((id) => right.selection.travellerIds.includes(id)) &&
        Date.parse(left.startAt) < Date.parse(right.endAt) &&
        Date.parse(right.startAt) < Date.parse(left.endAt)
      ) {
        issues.push(issue("SCHEDULE_CONFLICT", "error", `${left.selection.id}-${right.selection.id}`, `Selections ${left.selection.id} and ${right.selection.id} overlap`, [left.selection.id, right.selection.id]));
      }
    }
  }

  const selections = selectionById(trip);
  const activeByDate = new Map<string, Array<{ selectionId: string; minutes: number; travellerIds: string[] }>>();
  intervals.forEach(({ selection, startAt, minutes }) => {
    const date = startAt.slice(0, 10);
    activeByDate.set(date, [...(activeByDate.get(date) ?? []), { selectionId: selection.id, minutes, travellerIds: selection.travellerIds }]);
  });
  hydrated.forEach(({ selectionId, offer }) => {
    if (!isTransferOffer(offer)) return;
    const selection = selections.get(selectionId);
    const date = routeDateForTransfer(offer, trip, graph);
    if (selection?.kind === "travel" && date) {
      activeByDate.set(date, [...(activeByDate.get(date) ?? []), { selectionId, minutes: offer.durationMinutes, travellerIds: selection.travellerIds }]);
    }
  });

  trip.request.constraints.filter((constraint) => constraint.category === "schedule").forEach((constraint) => {
    for (const [date, entries] of activeByDate) {
      const scoped = entries.filter((entry) => applicable(constraint, entry.travellerIds));
      const total = scoped.reduce((sum, entry) => sum + entry.minutes, 0);
      if (constraint.value.maxActiveMinutesPerDay !== undefined && total > constraint.value.maxActiveMinutesPerDay) {
        issues.push(issue("SCHEDULE_CONFLICT", constraintSeverity(constraint), `${constraint.id}-${date}`, `Active schedule on ${date} is ${total} minutes`, scoped.map((entry) => entry.selectionId), [constraint.id]));
      }
    }
  });
  return issues;
}

function validateBudget(trip: TripState, budget: TripBudget): ValidationIssue[] {
  const constraint = trip.request.constraints.find(
    (candidate) => candidate.category === "budget" && !candidate.travellerIds?.length,
  );
  if (!constraint || constraint.category !== "budget") return [];
  const issues: ValidationIssue[] = [];
  if (budget.maximum && budget.total.amount > budget.maximum.amount) {
    issues.push(issue("BUDGET_EXCEEDED", "error", `${constraint.id}-maximum`, `Trip total INR ${budget.total.amount} exceeds maximum INR ${budget.maximum.amount}`, undefined, [constraint.id]));
  } else if (budget.target && budget.total.amount > budget.target.amount) {
    issues.push(issue("BUDGET_EXCEEDED", "warning", `${constraint.id}-target`, `Trip total INR ${budget.total.amount} exceeds target INR ${budget.target.amount}`, undefined, [constraint.id]));
  }
  return issues;
}

export async function projectTrip(
  input: TripState,
  context: TripProjectionContext,
): Promise<TripProjection> {
  const parsed = tripStateSchema.parse(input) as TripState;
  const trip: TripState = { ...parsed, request: requirePlannableRequest(parsed.request) };
  const { hydrated, issues: hydrationIssues } = await hydrateTrip(trip, context.resolveOffer);
  const budget = calculateTripBudget(trip, hydrated);
  const itinerary = buildItinerary(trip, hydrated, context.locationGraph);
  const issues = [
    ...hydrationIssues,
    ...validateRoute(trip, context.locationGraph),
    ...validateStayCoverage(trip, hydrated, context.locationGraph),
    ...validateTravelRoute(trip, hydrated, context.locationGraph),
    ...validateSelectionDates(trip, hydrated, context.locationGraph),
    ...validateConstraints(trip, hydrated),
    ...validateSchedule(trip, hydrated, context.locationGraph),
    ...validateBudget(trip, budget),
  ].sort((left, right) => left.id.localeCompare(right.id, "en"));
  return {
    hydratedSelections: hydrated,
    budget,
    itinerary,
    validation: { valid: !issues.some((item) => item.severity === "error"), issues },
    badgesByCandidateId: {},
  };
}
