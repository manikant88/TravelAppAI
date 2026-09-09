# Define scheduling policy and evidence contracts

Status: done

Blocked by: none

## Intended behavior

Represent pace, duration profiles, flexible meal windows, timing confidence and
constraint findings in the live itinerary contract.

## Acceptance criteria

- Existing unexpressed pace uses an explicit balanced product default.
- Activity durations distinguish fixed and estimated behavior.
- Meals retain preferred and extended windows plus their chosen start.
- Constraint findings distinguish warning, blocking and unresolved outcomes.

## Validation approach

Run schema, scheduler, TypeScript and lint checks.

## Comments

Accepted by the user on 8 September 2026.

Implemented `LiveBrief.pace`, duration profiles, flexible meal windows and typed
constraint findings. TypeScript, ESLint, Vitest and production build passed.
