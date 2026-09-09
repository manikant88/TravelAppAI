# Return complete constraint-aware edit impacts

Status: done

Blocked by: 01-activity-timing-rules.md

## Intended behavior

Use the shared scheduler to compare the existing and proposed itinerary and return
structured movement, route, meal, usable-time and constraint effects.

## Acceptance criteria

- Every successful selection returns a structured impact.
- New overridable warnings require confirmation.
- Non-overridable blocking conflicts leave the plan unchanged.
- Locks remain authoritative.

## Validation approach

Run selection, route-boundary and UI tests.

## Comments

Implemented structured affected-day, moved-item, transfer, meal, usable-time, finding and
alternative output. Overridable warnings require confirmation. Non-overridable fixed
conflicts and locks preserve the existing itinerary.
