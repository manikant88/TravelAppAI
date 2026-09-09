# AI implementation handoff

Last updated: 8 September 2026

This file records the current implementation boundaries that are easy to lose
when iterating on the UI. `PROJECT_CONTEXT.md` remains the product source of
truth and `IMPLEMENTATION_SPEC.md` remains the technical contract.

## Current request path

1. Explicit UI actions remain typed client actions. Free-form draft and
   committed turns go to `/api/agent/conversation` with a client turn ID and a
   bounded `ConversationContext` containing recent history plus the app-owned
   active task, awaited fields, and actions that were actually presented.
2. `src/agent/conversation-orchestrator.server.ts` is the single free-form turn
   boundary. It uses strict model-first semantic routing when AI is configured,
   then selects exactly one permitted deterministic executor. Model failure
   falls back to bounded deterministic interpretation rather than blocking the
   trip.
3. Domain and planning code extracts and validates the trip request, searches
   grounded inventory, assembles the itinerary, and owns every consequential
   fact and state transition.
4. Final assistant-facing prose passes through
   `src/agent/assistant-message.server.ts`. The language model may improve tone
   and clarity, but it may not add or change facts. A deterministic fallback is
   always returned when communication generation is unavailable or invalid.
5. The client renders the returned message and typed result. Temporary progress
   labels remain deterministic client UI state; they are not presented as model
   conclusions.

## Conversation state and tracing

- `WorkspaceState.activeInteraction` is canonical app-owned conversational
  state, separate from the visual `InteractionPresentation`. It records whether
  the user is exploring or building, the current task, awaited fields, the last
  assistant message, and the exact guided actions shown.
- Short replies such as `Delhi`, `2 adults`, or `the second one` are interpreted
  against that active interaction. Presented-option references can resolve only
  to actions that the application actually supplied.
- No-destination prompts can remain in explicit recommendation mode. The UI
  offers editable date and traveller starting points; grounded inventory search
  still waits until the minimum executable brief is available.
- Every free-form turn logs a server trace with client turn ID, trace ID, phase,
  semantic route, deterministic executor, outcome, duration, and degraded-mode
  status. Downstream OpenAI request IDs include the same trace correlation.

## Client boundaries

- `src/ui/services/agent-http.ts` owns agent POST transport and normalized API
  errors.
- `src/ui/services/conversation-client.ts` owns intake, committed-trip
  conversation, and optional assistant-message rewriting.
- `src/ui/services/planning-client.ts` owns specified planning and destination
  discovery requests.
- `src/ui/services/modification-client.ts` owns proposal application.
- `src/ui/workspace.tsx` coordinates view state and renders the persistent trip;
  it does not construct raw agent requests with `fetch`.

## Deterministic planning invariant

Recurring activity offers may share an activity identity across dates. The
deterministic planner tracks `activity_id` and never selects the same activity
identity more than once in an itinerary. The assembler continues to enforce
this invariant as a final validation boundary.

## Hybrid modification intent

High-confidence budget, activity-addition, and explicitly scoped card changes
are interpreted deterministically. Natural phrasing that does not map
confidently to one of those typed commands is sent to the configured planning
model for `ScopedModificationIntent` generation. The model does not bypass any
domain boundary: canonical IDs, trip dates, themes, constraints, locks,
inventory, previews, and proposals remain code-validated. A genuinely
ambiguous explicit card target is clarified with the user instead of being
delegated to the model to guess.

## OpenAI runtime configuration

- `src/agent/openai-config.server.ts` is the single server-only source for the
  OpenAI model, API key, timeout policy, and diagnostic client request IDs.
- Recommended default deadlines are 20 seconds for communication and travel
  context, 25 seconds for destination discovery, and 30 seconds for planning,
  modification, and explanation. These reflect observed structured-response
  latency from the configured `gpt-5-mini` model rather than the former 2.5–4
  second hardcoded limits.
- A request-specific timeout environment value overrides `OPENAI_TIMEOUT_MS`,
  which overrides the checked-in default. See `.env.example` for names.
- Reasoning effort is also centralized: communication and context default to
  `minimal`; destination discovery and planning default to `low`. This avoids
  spending deep-reasoning latency on schema-constrained copy while keeping the
  setting explicitly overridable per request class.
- Every Responses API call sends a unique `X-Client-Request-Id`. Structured-call
  logs include that ID, the server request ID when available, schema, model,
  duration, timeout, and failure reason without logging prompts or credentials.

## Verification baseline

- ESLint: clean.
- TypeScript: clean with `tsc --noEmit`.
- Vitest: 49 files and 278 tests passing.

## Next product pass

As of 4 September 2026, the next pass is customer-product discovery: resolve the first customer, core job, and product responsibility before prioritizing implementation. Earlier baseline exclusions do not define the customer launch scope. It should not move
planning facts into the communication model, duplicate state outside the
reducer/domain model, or reintroduce raw API orchestration into the workspace
component.


## Live planning implementation — 4 September 2026

The default `/plan` page now renders the live chat workspace. The previous workspace
is available explicitly at `/plan?mode=snapshot`. Free-form live requests use the
existing conversation URL with `phase: live`, dispatched before snapshot validation.
The implementation and limitations are documented in `IMPLEMENTATION_SPEC.md` under
“Implemented first live flow”, with local setup in README.

Verification this pass: TypeScript and ESLint passed; ten targeted tests cover dates,
unknown costs, ID validation, cancellation, partial failures and unknown-time propagation.
A real two-turn HTTP test against localhost clarified the Jaipur brief and then returned
four hotel locations and a four-day itinerary with successful Google driving connections.
A missing-year model hallucination was caught and blocked by a deterministic provenance
check; the follow-up live check returned a clarification without issuing supplier calls.
No automated browser tests were run. The page returned HTTP 200 with the live chat UI;
browser map rendering/key acceptance still requires a manual check.

This is a local-only experiment, not a complete travel supplier integration or durable
trip workflow. No room prices/availability, transport offers, meal schedule or budget
validation is implemented. Do not treat these missing facts as zero or use snapshot fallback.


## Live workspace card redesign — 4 September 2026

User screenshots confirmed that the browser map works. The live workspace now
shares `PlaceCardFrame` with the snapshot hotel/activity cards and reuses the
existing Lato typography, color tokens, icons and UI primitives. The desktop map
is a sticky vertical column beside the itinerary. The initial card pass used Itinerary, Stays and Activities tabs, superseded by
the continuous timeline below. Mobile stacks the map after the cards.

Google enrichment supplies photos with author credits, ratings/review counts and
optional generic price guidance. A live Jaipur hotel lookup verified an actual
photo, one author credit and rating/reviews; no price was returned for that hotel.
Users can add per-room/night or per-person/visit INR estimates, explicitly separated
from supplier facts and verified totals. No default hotel rate or fee is invented.
Photos require a newly generated plan; existing in-memory results lack the new fields.

Verification: 14 live planner/provider tests, TypeScript and ESLint passed, and
`/plan` served HTTP 200. No automated browser tests were run. Visually check the
redesigned cards and responsive map arrangement manually in the app.

## Continuous live timeline — 4 September 2026

Replaced the category/day switching views with every day rendered in sequence.
Sticky date chips scroll to day sections and follow the visible timeline row.
Cards retain the shared design; a time rail separates driving, 15-minute buffers,
visits and the return connection. Day summaries show visit/drive/buffer minutes.
Missing return routes stay unknown rather than reusing an outbound leg.
Alternative hotel cards now appear through the shared drawer described in the later
drawer-based alternatives follow-up.

The desktop map stays beside the itinerary, reuses one Maps instance and follows
scroll position with highlighted routes, numbered stops and cancellable camera
animation. A pause control permits independent map exploration; reduced motion
skips animation. Scroll tracking makes no provider calls. Narrow mobile layouts
still place the map below the itinerary.

Verified this pass: TypeScript, targeted ESLint, 16 live planner/provider tests,
and HTTP 200 from `/plan`. No automated browser tests were run. Scroll alignment,
responsive layout and the animation feel still need manual browser review.

## Verified place detail enrichment — 4 September 2026

Selected live hotel/activity cards request and render Google rating/count, editorial
summary, affirmative structured amenities and official website when returned. The
About copy is provider text, not planner-authored copy. A live Jaipur details check
returned rating 4.6, 3,726 ratings, an editorial summary and three structured facts;
it returned no price range or website, which therefore remain absent. Google Places
does not expose consumer Google Maps hotel supplier offers. See
`docs/research/google-places-card-fields.md` for the official-source capability and
attribution analysis.

## Opening-hours scheduling validation — 5 September 2026

Activity cards no longer expose the full Google weekly opening-hours list. Place
normalization retains structured regular periods and deterministic planning checks
the proposed weekday after selection. A regularly closed visit moves to the nearest
open trip day with fewer than two visits, or is omitted if no valid trip day has
capacity. Unknown hours stay explicit. This validates the typical weekly schedule;
future holiday and temporary exceptions remain unconfirmed.

## Intercity Google route comparison — 5 September 2026

The first live flow now asks for self-driving or public transport before any provider
search. Self-driving requires an explicitly supplied starting area/address. It searches
only that chosen mode between the resolved start and selected stay. The shortest-duration
returned result becomes a provisional suggestion rendered with the existing travel-card
layout inside Day 1 and the final day. Cards show duration, distance, transit vehicle
types, line names, stop times and fare when present. Driving times are labelled estimated;
returned transit times are labelled scheduled. Searches use explicit 08:00 outbound and
17:00 return assumptions. A failed direction preserves the itinerary and successful route.

Outbound travel, the selected stay and activity cards now share the Day 1 time rail.
The day projection starts from the suggested route arrival plus a labelled 30-minute
arrival/check-in buffer; missing arrival propagates unresolved times rather than falling
back to 10:00. Return travel is likewise a timed row on the final day. Scroll focus passes
the selected intercity route to the existing map, which swaps to origin/stay markers and
the Google route polyline, then returns to local hotel/activity routes as those rows enter
view. No additional provider call occurs while scrolling.

This evidence is not supplier inventory: flights, seats, ticket availability, private-cab
fares and booking remain unresolved. TBO is deferred as the next commercial integration
because it requires onboarding and approval; keep its eventual offer/booking contract
separate from Google route evidence.

A bounded live Delhi–Jaipur smoke test on 5 September returned three road routes and
three public-transit routes. The transit results contained bus/subway modes, line names
and scheduled times but empty fare objects; normalization correctly retained the routes
and rendered “Fare not provided.” TypeScript and repository-wide ESLint passed; the
full suite passed 46 files and 269 tests, including 26 targeted provider/planner tests.
`/plan` returned HTTP 200. No automated browser tests were run.
Two live intake turns also verified the staged questions: the complete Jaipur brief asked
for self-driving versus public transport, and choosing self-driving then asked for the
starting area/address without issuing route searches.

## Provider-neutral transport boundary — 5 September 2026

The canonical travel modes now include flight, train, bus, cab, self-drive, ferry, ship,
and cruise. Canonical supplier
offers are versioned and carry provider provenance, availability, booking semantics, and
per-segment modes. Transfers may separately record their physical transport mode, allowing
a ferry connection to be validated as a transfer without confusing it with a cruise
activity. Google Routes results are explicitly versioned `route_evidence`, not supplier
offers. `src/transport/provider.ts` defines the capability-declaring commercial provider
adapter boundary. ADR 0001 records why provider responses never enter editable trip state.
The database transport-mode and transfer-contract migrations `0003`–`0006` were generated
but not applied. TypeScript and repository-wide ESLint passed; the full suite passed 47 files and 271 tests, including two new water-mode
contract cases. No automated browser tests were run.

## Contract and trust-boundary review — 6 September 2026

The provider-neutral boundary now validates canonical supplier offers semantically before
planning: segment endpoints and timestamps must connect, duration and stop counts must
agree, the result must match the requested route/date/mode, and provider output cannot
claim booking, availability, cancellation, capacity, price or refresh capabilities the
adapter did not declare. Transfer offers now carry the same provenance, availability and
booking evidence. Their totals respect either per-vehicle capacity or per-traveller pricing,
including ferry transfers.

Failed local-route observations are a distinct state requiring an error, rather than a
partly populated route. Google route evidence no longer invents a provider route ID when
Google does not return one. Self-drive pickup collection now explains its AI/Google use,
session retention and visibility, and permits a public meeting point. If a clarification
changes the draft request without producing a new plan, the UI labels the displayed
itinerary as the previous plan until rebuilding succeeds.

TypeScript, repository-wide ESLint and the full Vitest suite passed: 49 files and 278 tests.
No automated browser tests were run. Database migrations `0003`–`0006` remain generated
but unapplied.

## Shared option evidence foundation — 6 September 2026

Supplier metadata is now consistent across transport, transfer, stay, and activity offers.
Canonical offers identify live, sandbox, or snapshot evidence and carry availability,
provider identity, booking semantics, and optional cancellation terms. Live and sandbox
evidence requires a checked timestamp.

`src/inventory/option-evidence.ts` defines the separate option-candidate contract for
supplier, route, place, user-link, and manual provenance. Evidence is assessed by intended
action across identity, location, schedule, price, availability, and requirements. Planning,
trip finalization, and booking handoff each have explicit readiness requirements, so a UI
shortcut cannot strengthen incomplete evidence. ADR 0002 records the distinction between
candidates, offers, selections, and bookings.

Validation after this change: TypeScript passed, ESLint passed, and the full Vitest suite
passed (50 files, 281 tests). No automated browser tests were run.

## Nuitée sandbox stay search — 6 September 2026

`src/inventory/providers/nuitee.server.ts` now searches the configured Nuitée Connect
sandbox for dated stay offers. It normalizes property identity, coordinates, photos,
room/board facts, cancellation terms, availability, sandbox provenance, the exact
customer-facing total, and an average per-room/night amount. The provider key remains
server-only. The live planner uses these offers when `NUITEE_API_KEY` exists and otherwise
retains its Google place fallback.

The live itinerary renders supplier prices and suppresses manual estimates on priced stay
cards. Google local routing now uses coordinates, allowing a Nuitée property to anchor the
activity route without treating its ID as a Google Place ID. Booking and prebooking remain
out of scope; every sandbox offer has `booking: null`. Room occupancy currently assumes no
more than two travellers per room and guest nationality defaults to `IN`; both appear as
plan assumptions.

A real sandbox smoke test returned four Jaipur offers and all four passed the canonical
stay schema. TypeScript, ESLint, and the full Vitest suite passed: 51 files and 285 tests.
No automated browser tests were run.

## Nuitée sandbox flight journey — 7 September 2026

The live intake now accepts an explicit flight preference and collects a starting area or
public meeting point before provider calls. `src/transport/providers/nuitee-flight.server.ts`
owns the Nuitée airport catalogue, sandbox search payload and response normalization. It
emits canonical direct-flight `TransportOffer` values through the existing provider
capability boundary. This pass requires origin and destination to share the same observed
UTC offset; cross-time-zone and connecting results remain excluded until every airport
offset can be resolved for the travel date.

Flight plans contain four Google road transfers around the two supplier flight offers.
The continuous timeline renders pickup, airport buffer, flight, destination transfer and
stay arrival in order; Day 1 starts from arrival at the stay. The map follows transfer
polylines and uses an airport-to-airport line for the flight row. Suggestions prefer an
outbound arrival by 13:00 and return departure after 17:00 before comparing price and
duration.

A real sandbox DEL–JAI smoke test returned eight direct offers each way and all four road
transfers. The first observed sandbox fare was ₹2,305.86 per adult; this is transient
evidence and must be refreshed. The smoke test used India Gate as a synthetic public
pickup landmark. Production access, connecting flights, round-trip pricing and booking
remain unimplemented.

Validation: TypeScript, repository-wide ESLint, production build, and the full Vitest
suite passed (52 files, 289 tests). No automated browser tests were run.

## Session option selection — 7 September 2026

Phase 3 adds server-validated selection among the current Nuitée stay and direct-flight
results. Alternatives now appear in the shared right-side drawer and reuse the timeline
card modules. The selected stay and each flight direction have independent session locks.

A stay change refreshes applicable intercity routes, flight airport/stay transfers and
all daily hotel/activity connections. A flight change refreshes that direction's two
airport road transfers. Unknown IDs, unavailable or expired supplier offers, and locked
replacements are rejected without replacing the client plan. Google Routes remains the
ground-routing provider; Uber is deferred while access is reviewed.

This is still browser-session state without authenticated ownership, durable persistence,
organizer authority or concurrency control. Supplier refresh/reprice, manual/link options,
activity additions and removals, prebook and booking remain future work.

Validation: TypeScript, repository-wide ESLint, production build, and the full Vitest
suite passed (53 files, 294 tests). A live provider smoke request completed planning but
returned one stay and no flight offers for that transient future-date query, so the live
response did not contain an alternative to switch. The selection and dependency refresh
paths are covered by server-boundary tests. No automated browser tests were run.

### Drawer-based alternatives follow-up

Inline stay and flight expanders were removed. Every selected stay, flight, Google
intercity route and activity now uses the established Lock · Change control pattern.
Change opens `src/ui/live-option-drawer.tsx`, which keeps the continuous timeline focused
on the current itinerary and compares observed alternatives with supported cost, travel
time, arrival shift, rating and route-impact evidence.

The live plan now retains a bounded visual Google activity candidate set. Activity
replacement is server validated, cannot duplicate another selected activity, rejects a
regularly closed venue for the target day, and refreshes that day's driving chain. Road
route directions and individual activity places have session locks alongside the stay
and flight locks. Unknown hours or prices remain labelled as unknown.

A manual local-browser check found no console errors. Nuitée returned no usable stay set
for the two dates tried during that inspection, so a populated live drawer could not be
visually exercised against transient supplier data. No automated browser tests were run.
TypeScript, repository-wide ESLint, production build, and the full Vitest suite passed
(53 files, 298 tests).

The drawer now renders alternatives with the same `LiveFlightCard`, `LiveTravelCard` and
`LivePlaceCard` modules used in the timeline. Their interfaces accept optional selection
actions and comparison guidance, so photos, ratings, price evidence, provider provenance,
links and responsive card behavior cannot drift into a separate drawer design. The legacy
compact live drawer rows and their CSS were removed. TypeScript, repository-wide ESLint,
all 298 tests and production build passed. Computer-use startup was unavailable for the
final manual visual inspection; no automated browser tests were run.

### Flight-unavailable route fallback — 7 September 2026

Nuitée fare searches can time out even when its airport catalogue remains healthy. A
failed or empty direction now stays visible as an unresolved flight card instead of
silently disappearing. The planner concurrently requests Google transit and driving
routes for both directions and stores them as unselected `flight_fallback` evidence.
Transit cards use the rail/bus modes actually returned. The driving result is presented
as separate self-drive and cab contexts; both share Google distance/duration evidence,
while cab fare, pickup ETA and availability remain explicitly unverified.

The unresolved card can retry Nuitée without rebuilding the chosen stay or activities,
open the fallback drawer, or hand the user to Google Flights. Selecting a route fallback
updates the existing timeline and map. The drawer retains a Nuitée retry action after a
fallback is selected.

The configured Uber values currently include the sandbox base URL and client secret only.
There is no client ID, access token or granted estimate scope, so no Uber estimate call is
made and Google road evidence remains the cab-planning source.

### Live meals — 7 September 2026

The live intake now asks for vegetarian, pure-vegetarian-only, non-vegetarian, or both,
plus separate dietary notes such as allergies or seafood interest, before starting
provider searches. Google restaurant candidates are scheduled as lunch and dinner stops;
breakfast is anchored at or near the selected stay from Day 2. A Nuitée breakfast meal
plan is the only current evidence that breakfast is included.

Meal stops share the continuous timeline, Google driving chain and scroll-following map
with activities. Regular hours are checked at the target meal time. Target times can add
an explicit open-time block rather than pulling dinner into the afternoon. Google text
search can discover likely pure-vegetarian restaurants but does not verify the menu,
kitchen separation, allergens or cross-contamination, so cards retain that confirmation
requirement.

Validation: TypeScript, repository-wide ESLint, production build, all 305 Vitest tests,
and four Playwright desktop/mobile interaction tests passed. The browser suite includes a
meal card with target timing, dietary provenance, summary minutes and its adjacent route.

### Route-aware meals and optional evening discovery — 7 September 2026

The live Google provider can calculate a driving route, encode its returned path, and
issue a bounded Places Text Search along that route. Corridor discovery is capped at four
meal windows, or fewer for shorter trips, to preserve the existing live Google call
budget. Unsearched or failed windows remain explicit destination fallbacks. Lunch and
dinner retain surrounding
route anchors, direct-route duration, corridor or destination-fallback provenance, and
added driving time when their final adjacent legs still match the search anchors.

Regular-hours validation covers the complete projected interval rather than only the
start minute. It returns valid, invalid, or unresolved evidence and understands regular
periods spanning midnight. Invalid intervals remain visible with explicit warnings.

The live brief has an optional day-rhythm preference for early nights, evening
experiences, nightlife, overnight adventure, or flexible plans. It is set only from
traveller language and never blocks initial planning. Bounded evening discovery is
suppressed for early nights. Other results appear as optional ideas with a chat
refinement action; they are not inserted automatically and do not establish dated event
or provider availability.

Final verification on 7 September 2026: TypeScript, repository-wide ESLint, all 312
Vitest tests, and the Next.js production build passed. No automated browser tests were
run for this change.

## Capacity-aware live scheduling — 8 September 2026

`src/live/scheduler.ts` now owns the live day policy. The model ranks observed places;
the scheduler applies a visible balanced default (or an explicitly stated relaxed/packed
pace), usable arrival/departure bounds, duration profiles, group-sensitive adjustments,
meal windows, combined-meal evidence and warning/blocking/unresolved findings. Balanced
full days can contain up to three activities instead of the former two-place ceiling.
Destination activity discovery spans six bounded category searches for heritage,
culture, neighbourhoods, viewpoints, outdoor/adventure and family options, plus the
existing conditional evening search. Only the scheduled shortlist receives Google
detail/photo calls.

The continuous timeline orders all activities and meals by schedule position, explains
duration ranges and shifted meals, and labels genuine gaps as flexible time. Explicitly
requested evening or nightlife exploration may add one observed candidate; unrequested
nightlife remains an optional chat refinement. Overnight activities are still deferred.

Stay, flight, Google route and activity selections rerun the same schedule assessment.
Each proposed change returns moved items, transfer and meal changes, usable-time change,
new findings and valid observed alternatives. Overridable warnings use the typed
confirmation action. A non-overridable fixed-time conflict returns the unchanged plan and
cannot be confirmed through. Regular-hours closure is rejected outright. Locks remain
authoritative.

Provider/manual fixed times remain exact, outdoor profiles retain difficulty/daylight
planning constraints, and combined meal experiences retain provider, manual or Google
description provenance. Lunch and dinner use the accepted preferred/extended windows;
explicit medical timing is enforced and underspecified medical timing remains unresolved.
The timeline exposes exact versus estimated timing, capacity explanations and concrete
edit impacts.

Final Phase 6 verification: TypeScript, repository-wide ESLint, 54 Vitest files / 325
tests, the Next.js production build, and five Playwright desktop/mobile scenarios passed.
The browser run found and fixed a drawer/confirmation stacking defect before the final
pass.

## Globe handoff and live Trip Brief — 8 September 2026

The destination globe remains the primary entry point. Its prompt query is submitted once
when `/plan` opens. The live workspace keeps chat on the left. During the first prompt
interpretation, the right side shows the existing travel-planning Lottie and live progress;
the Trip Brief is deliberately hidden until the server returns a validated brief.

After interpretation, the live workspace reuses the main branch's original five-field
Trip Brief bar, compact field editor popovers and Trip Essentials checklist. Validated
facts are populated, missing facts are highlighted, and checklist chips or Add manually
actions send natural-language corrections through `requestLivePlan`. They never mutate
`LiveBrief` directly, so chat and all visible controls share the same model extraction,
validation and provider-planning boundary.

Trip Brief popovers close on outside click and stage their edits locally. They have no
per-popover Close or Apply buttons; the header always presents a single Update button,
which submits all staged fields together. Travel mode is part of Preferences with Flight,
Train, Bus, Cab, Self Drive and Recommend Me. The recommendation path compares Google
transit and cab-route evidence using duration, group-size practicality, and explicit
budget-conscious or comfort/accessibility preference signals while explicitly
leaving private-cab price, vehicle capacity and total budget fit unresolved.

The live chat now uses the main workspace's compact composer rather than separate Send,
Cancel and example buttons. Deterministic suggestions for the next missing requirement
appear as chips above the composer, and the inline send icon becomes a stop icon while a
request is active.

The globe prompt submission is deferred through `src/ui/auto-submit.ts`. This is required
because React development Strict Mode replays effect setup and cleanup; starting the request
synchronously allowed the cleanup to abort it while the consumed flag prevented a retry.
The deferred setup is covered by `tests/ui/auto-submit.test.ts`.

Origin, destination, dates, duration, travellers, night-count confirmation and transport
are required. Flight, cab and self-drive additionally require a first-mile starting point.
Dining preference and pace are optional; an omitted dining preference triggers generic
restaurant discovery with an explicit menu and dietary-fit confirmation note. Once an
itinerary exists, the same Trip Brief editors remain available and retain the single
mutation path used by the existing live workspace.

The live handler distinguishes deployment environment from build optimization. Vercel
Preview and custom staging deployments are allowed even though Next sets
`NODE_ENV=production`; actual Vercel Production remains blocked. Non-Vercel optimized
staging can opt in with `LIVE_PLANNING_ENABLED=true`. Preview credentials must be configured
in Vercel and the deployment must be rebuilt after environment changes.
