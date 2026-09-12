# Live planner implementation specification

Status: current implementation contract on `codex/product-foundation`

This document describes the only planning runtime in the branch. Git history preserves
the retired prototype architecture. Product intent belongs in `PROJECT_CONTEXT.md`,
domain terms in `CONTEXT.md`, and current navigation notes in `AI_HANDOFF.md`.

## 1. Delivery boundary

The application serves a globe-first start page and a session-only planner at `/plan`.
The planner is available during local development, on Vercel Preview, and in an optimized
non-Vercel environment only when `LIVE_PLANNING_ENABLED=true`. Vercel Production rejects
planning requests.

The current runtime does not provide authentication, persistence, collaboration,
booking, payment, or production supplier guarantees. Refreshing the browser clears the
conversation and plan.

## 2. Runtime architecture

```text
Home prompt
  → /plan?prompt=...
  → LiveWorkspace
  → POST /api/agent/conversation
       phase: live           → runLivePlan
       phase: live-selection → applyLiveSelection
  → validated response
  → Trip Essentials, recovery, or itinerary
```

`src/app/api/agent/conversation/route.ts` is the single API route. It parses JSON, admits
only two concurrent planning requests per server process, delegates to the live handler,
and returns structured errors.

`src/live/handler.server.ts` owns request deadlines and dependency construction. Planning
has a 120-second deadline; selection changes have a 60-second deadline. Provider and
model calls have shorter internal timeouts and receive the request abort signal.

`src/ui/live-workspace.tsx` owns the browser session, conversation, fact editors, current
plan, staged actions, map visibility, and loading state. Server components do not carry
mutable trip state.

## 3. Canonical intent: LiveBrief

`LiveBrief` is the canonical user intent for a live session. It contains:

- `origin`, `destination`, `startDate`, `days`, and `travellers`;
- outward `travelMode` and an optional `pickupLocation`;
- `endIntent`: return to origin, end at destination, or continue elsewhere;
- optional `onwardDestination` and independent `endTravelMode`;
- `roadTripConfirmed`;
- dietary preference and notes, evening rhythm, pace, interests, and constraints; and
- `nightsConfirmed`, which records whether date and occupancy intent is safe to use.

Supported trips contain 2–14 calendar days and 1–12 travellers. Dates use ISO calendar
dates without converting through UTC instants.

An explicit start and end date determine `days` inclusively and hotel nights as
`days - 1`. This sets `nightsConfirmed=true`; the application must not ask the user to
confirm the arithmetic. A start date plus duration still requires enough information to
identify the intended checkout date.

Outward and later journeys are independent. `end_at_destination` needs no later travel
mode. `return_to_origin` requires a later mode to the origin. `continue_elsewhere`
requires both an onward destination and a later mode.

A pickup point is required for flight, cab, and self-drive. Trip Essentials offers
origin-aware places, browser geolocation, and free-text address entry. Train and bus do
not require a local pickup point in the brief.

## 4. Intake and conversation

The client sends the latest message, the current brief, and at most 12 recent messages.
Model extraction uses a strict schema. It may interpret language but may not invent dates,
availability, or provider facts.

`src/live/intake-fallback.ts` deterministically preserves explicit information when model
extraction is unavailable. It recognizes:

- ISO and common English date ranges with an explicit year;
- origin and destination statements;
- traveller counts;
- outward and later travel modes;
- pickup points;
- return, end-here, and continue-elsewhere intent;
- road-trip confirmation; and
- pace and stated interests.

`src/live/explicit-dates.ts` is the authoritative explicit-range parser. Invalid ranges
and ranges outside 2–14 days do not become a brief silently.

Edits are deltas. The UI sends only staged changes plus wording that preserves the rest
of the Trip Brief. It must not repeat the complete brief whenever one field changes.
Multiple Trip Essential or recovery choices are staged locally and applied in one turn.

Assistant copy should describe the trip and why a choice helps. Loading copy uses travel
activities such as understanding the request, checking stays, arranging journeys, and
building days. Internal provider or orchestration detail stays out of general chat.

## 5. Readiness and automatic planning

`src/live/essentials.ts` is the deterministic readiness boundary. Trip Essentials shows
only pending items and highlights corresponding fact fields. When every required item is
ready, planning begins automatically; there is no separate “Build my trip” step.

An itinerary renders only when `isRenderableLivePlan` accepts it. New plans set
`generationStatus` explicitly:

- `incomplete`: planning did not produce a safe itinerary; include `generationIssue`;
- `valid`: the trip passed the generation gate and may render.

On failure, retain Trip Essentials and show actions derived from `generationIssue`.
Actions must state what changes, why it can help, and provide a selectable chip or field
editor. A provider retry appears only when `retryable=true`. Date recovery uses a
computed end date or minimum duration rather than a vague request to “change dates.”

Generation issue codes are `no_stays`, `no_activities`, `selection_invalid`,
`road_infeasible`, `road_confirmation`, `schedule_empty`, and
`blocking_constraints`.

## 6. Provider and evidence boundaries

### Google Places and Routes

`src/live/google.server.ts` exposes the live place/route boundary. A provider instance
allows at most 60 Google requests. Place evidence can include identity, coordinates,
address, ratings, regular hours, editorial text, amenities, photos, and attribution.

Route evidence can include duration, distance, path, scheduled transit times, transit
lines, and a returned fare. A road route does not establish cab availability or price.
A transit route is not exhaustive ticket inventory.

The browser map uses the public Maps key. Server-side Places and Routes use a separate
server key. Missing or invalid keys produce explicit unresolved behavior.

### Stay offers

`src/inventory/providers/stay-provider.ts` defines the stay interface and
`nuitee.server.ts` implements it. Each `StayOffer` carries dated occupancy, availability,
price, cancellation terms when returned, property facts, source environment, checked
time, expiry, and booking capability.

Sandbox offers are evidence only and are never represented as bookable. A Google hotel
place without a supplier offer is an unresolved candidate, not dated availability.

Road travel changes the destination occupancy window. The selected destination property
must be rechecked for the actual arrival and checkout dates. If the property is absent
or the recheck fails, remove its stale supplier offer, price, and availability.

### Flight offers

`src/transport/provider.ts` defines the transport interface and
`nuitee-flight.server.ts` implements direct sandbox flight search. Flight offers carry
provider IDs, schedules, airports, segments, duration, capacity, price, checked time,
expiry, environment, and booking capability.

The recommended flight favors useful arrival or departure times, then lower price and
duration. Outward and later flights are searched independently when their modes differ
or the trip continues elsewhere.

When a flight search returns no usable offer, observed train, bus, cab, or self-drive
routes remain available. Resolving one journey must not discard fallbacks for the other.

## 7. Travel policy and multi-day road journeys

`src/live/travel-policy.ts` owns the shared mapping from user travel modes to Google route
profiles and the shared flight-ranking rule. Planner and selection flows must use this
module rather than duplicate those policies.

`src/live/road-journey.ts` turns a raw drive duration into dated journey segments:

- self-drive permits at most 8 driving hours per day;
- cab permits at most 10 driving hours per day;
- a 20-minute rest follows about 2.5 hours of continuous driving;
- a 45-minute lunch is placed on substantial driving days;
- multi-day travel includes 12 hours of overnight rest; and
- each overnight stop attempts a dated one-night stay search.

Verified restaurant and transit-stay candidates attach to their route points. If a live
search fails, the timeline keeps the planned break or unresolved place candidate without
inventing availability.

Combined outward and later road days determine feasibility:

- `feasible`: destination time remains greater than road time;
- `road_trip`: road days are at least the remaining destination days and require explicit
  confirmation; and
- `not_feasible`: no usable destination day remains.

Travel-only days contain road events, breaks, meals, and transit stays. Destination meals
and activities begin after arrival. A later road journey occupies the appropriate final
dates in the same timeline.

## 8. Scheduling and meals

`src/live/scheduler.ts` owns duration profiles, pace-sensitive capacity, meal windows,
fixed or provider timing, and constraint findings. `src/live/timeline.ts` projects each
day into ordered events for the UI and map.

The scheduler defaults an unstated pace to balanced and marks that default. Arrival and
departure travel reduce usable time. Travel-only road days bypass destination scheduling.

Meals are first-class selections with lock and change actions. A restaurant is preferred
when it fits the surrounding route; destination-wide fallback is labeled for review.
Breakfast may use the selected stay when inclusion or location supports it.

Regular opening hours may validate or reject a proposed time, but they are not dated
availability. Missing hours, menus, prices, allergens, and dietary handling remain
unresolved. A meal must not claim dietary suitability based only on a category or name.

Findings have `warning`, `blocking`, or `unresolved` severity and state whether the user
may override them. Blocking findings prevent a valid generation result.

## 9. Selection, locks, and edit impact

The `live-selection` phase accepts only commands validated by
`liveSelectionRequestSchema`:

- lock or unlock a stay, outward/later flight, outward/later route, activity, or meal;
- select an observed stay, flight, route, activity, or meal; or
- retry flight search.

The server validates selected IDs against options embedded in the current plan. It rejects
expired, unavailable, unknown, or locked choices. After a change, it refreshes affected
routes, road segmentation, occupancy, schedule capacity, hours, and findings.

`LiveSelectionImpact` reports affected days, moved items, route changes, meal changes,
usable-time delta, findings, and alternatives. A newly introduced warning or conflict is
returned for confirmation before the change is applied.

Current limitation: changing a route can move a journey between feasible, road-trip, and
impossible states, but that transition does not yet have a dedicated road-feasibility
impact summary. Track this in
`.scratch/multi-leg-road-journeys/issues/05-road-feasibility-edit-impact.md`.

## 10. UI contract

The desktop layout contains a conversation panel, sticky Trip Brief, dated navigation,
timeline, and optional map. On smaller screens, the layout stacks without removing
essential actions.

Place cards use `PlaceCardFrame` and show no more than five amenity tags initially. The
toggle labels are “Show all” and “Show less.” Repeated provider caveats belong in a
compact evidence footer rather than the main explanation.

Stay, flight, route, activity, and meal cards expose lock and change actions. The map can
be hidden; the timeline then centers in the available stage. For the selected day it
shows route paths and verified activity, restaurant, rest, airport, destination-stay, and
transit-stay points available in that day's timeline.

Planning uses `travel-planning.lottie`. The animation remains visible while the server
turn is running and progresses through human-readable planning stages. Repeated clicks or
automatic planning must not enqueue duplicate user and assistant messages.

## 11. Runtime safety and errors

All external input crosses a Zod boundary. Secrets are read server-side; only the browser
map key is public. Provider errors are sanitized before reaching customer copy.

The OpenAI runtime sends a client request ID, uses the planning-specific timeout and
reasoning override when configured, and falls back to the shared values otherwise. A
failed extraction keeps the user's original message available and runs deterministic
extraction before asking for facts already stated explicitly.

The previous valid plan is not replaced by an incomplete update. Concurrent generation
is bounded, abort signals propagate, and the UI prevents duplicate submission while a
turn is active.

## 12. Verification

Routine verification is:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Automated browser tests run only when the user explicitly requests them. Manual smoke
checks cover provider credentials, browser geolocation, map rendering, responsive layout,
loading animation, and real timeout behavior.

Tests should prioritize deterministic boundaries: explicit dates, readiness, intake
fallback, road segmentation, travel-day capacity, provider normalization, mixed journey
modes, stale-offer removal, option validation, locks, and edit impact.

## 13. Known design debt

- `LivePlan` still models outward and later travel through separate `travel` and `flight`
  structures. The independently searched later flight is projected into the legacy
  `return` display slot. The first-class ordered journey-leg migration is specified in
  `.scratch/multi-leg-road-journeys/issues/06-first-class-journey-leg-contract.md`.
- `src/live/planner.ts` and `src/live/selection.server.ts` remain broad orchestration
  modules. New cohesive policy should move behind narrow modules instead of expanding
  either file.
- `src/live/contracts.ts` combines intent, evidence, schedule, plan, and selection schemas
  in one file. Split it only with a deliberate compatibility plan because every server
  and UI boundary imports it.
- Complete night occupancy, provider-verified overnight activities, user-added options,
  and full lock-aware recalculation remain tracked in
  `.scratch/route-aware-evenings/issues/05-future-cross-midnight-and-user-options.md`.
