# Independent journey intake

Status: done

Blocked by: none

## Intended behavior

Capture trip end intent, optional onward destination, and a separate later travel mode
in chat and Trip Essentials.

## Acceptance criteria

- Return to origin, end at destination, and continue elsewhere are distinct choices.
- Continuing elsewhere requires a destination.
- The later journey mode does not inherit the outward mode without an explicit choice.
- Chat and Trip Essentials can stage these answers together.

## Validation approach

Exercise deterministic fallback, model extraction, readiness, and Trip Essentials
component tests.

## Comments

Implemented in the live brief, intake fallback, essentials boundary, and UI. Verified by
the live essentials, planner, and Trip Essentials test suites on 12 September 2026.
