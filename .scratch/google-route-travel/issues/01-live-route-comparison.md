# Live outbound and return route comparison

Status: done

Blocked by: none

## Intended behavior

The live Jaipur-style planning flow asks for a travel preference, searches that Google
Routes mode between the resolved starting point and selected stay, and places one
provisional suggestion in each relevant timeline day. It preserves provider facts and
states the supplier/booking limits clearly.

## Acceptance criteria

- Intake requires self-driving or public transport before provider calls.
- Self-driving requires an explicitly supplied starting point.
- Typed route options distinguish direction and driving/public transit.
- Transit vehicle, line, schedule and fare fields come only from the provider response.
- Empty or absent fare data renders as unavailable, never zero.
- One route-mode failure does not erase the itinerary or successful routes.
- The UI reuses the existing travel-card/token foundation inside Day 1 and the final day.
- Travel/stay/activity cards share the time rail and Day 1 derives from route arrival.
- Timeline scroll focus shows the corresponding intercity or local route on the map.
- TBO is recorded as the next provider implementation, not claimed as integrated.

## Validation approach

- Provider contract tests for transit details, absent fare and returned fare.
- Planner tests for four direction/mode calls and partial failure.
- TypeScript and targeted ESLint.
- Bounded live Delhi–Jaipur provider smoke test.
- Manual browser review; automated browser tests are excluded by repository instruction.

## Comments

Implemented the typed Google Routes adapter, city-origin planner orchestration, partial
failure handling, travel comparison UI, bounded verification script and documentation.
The 5 September live test returned three driving and three public-transit alternatives;
Google returned no fare, and the parser retained those routes without creating a price.
TypeScript and repository-wide ESLint passed. The full suite passed 46 files and 269
tests, including 26 provider/planner tests, and `/plan` returned HTTP 200.
Two live model-backed intake turns verified the transport-preference question followed
by the self-driving starting-location question.
