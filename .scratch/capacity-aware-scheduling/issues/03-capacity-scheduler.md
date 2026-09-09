# Schedule activities and flexible meals by daily capacity

Status: done

Blocked by: 01-scheduling-contracts.md, 02-discovery-and-duration.md

## Intended behavior

Use known arrival/departure bounds, routes, opening hours, duration profiles and pace to
produce a feasible sequence with flexible meal starts.

## Acceptance criteria

- Balanced full days target two or three activities when candidates fit.
- Arrival and departure days are bounded by known travel.
- Meals may shift within their extended window.
- Open time remains only when another valid candidate does not fit at the selected pace.
- Unknown routes propagate unresolved timing.

## Validation approach

Run deterministic scheduler and live planner tests.

## Comments

Implemented pace-based capacity, arrival/departure bounds, flexible meal placement,
sequence ordering and unknown-route propagation. Scheduler and planner tests passed on
8 September 2026.
