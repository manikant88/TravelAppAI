# Support combined experiences and constraint-aware edits

Status: done

Blocked by: 03-capacity-scheduler.md

## Intended behavior

Allow evidence-bearing experiences to cover a meal and assess itinerary changes through
the same scheduler rules used for initial planning.

## Acceptance criteria

- A combined experience suppresses only the meal its evidence covers.
- Selection impact reports moved time, warnings, blockers and unresolved evidence.
- Locked selections are not silently changed.
- Unsafe edits require an explicit confirmation step before application.

## Validation approach

Run selection, contract and UI unit tests.

## Comments

Implemented explicit meal-coverage evidence and shared schedule reassessment for live
stay, flight, route and activity selections. The response reports concrete movement,
transfer, meal, capacity and finding changes. Overridable warnings require typed client
confirmation; non-overridable fixed conflicts preserve the original plan. Existing locks
and closed-day rejection remain active.
