# Multi-leg road journeys

Status: accepted and in progress

## Problem

The live planner treated every route as a round trip using one mode and projected long
drives as continuous travel. That produced unresolved or unsafe arrival times and could
place destination activities before travellers could arrive.

## Accepted behavior

- Record an explicit trip end intent: return to origin, end at destination, or continue elsewhere.
- Record the outward and later travel modes independently.
- Split self-drive and cab route evidence into daily driving segments with breaks, meals, and overnight rest.
- Treat overnight road stops as transit stays with separate availability provenance.
- Remove destination activity capacity from travel-only days.
- Reject road choices that consume the complete trip and flag journeys dominated by road travel.
- Recalculate the same feasibility model after route and stay edits.

## Remaining follow-up work

- Add a dedicated edit-preview finding for changing between feasible, road-trip, and impossible states.

The current flight contract projects an independently searched onward one-way offer into
the legacy `return` display slot. This keeps existing selection and timeline components
working, but a future leg-shaped transport collection should remove that compatibility
adapter.

The main destination property is rechecked for the actual road-adjusted arrival and
checkout dates. If the same property is not returned, its price and availability remain
explicitly unresolved rather than retaining the original whole-trip offer.

## Validation

- Pure deterministic segmentation tests.
- Intake tests for end intent, onward destination, and independent mode.
- Planner tests for timezone propagation and road-day capacity.
- Selection tests for recalculation after route and hotel changes.
