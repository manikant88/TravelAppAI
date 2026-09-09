# Complete activity-specific timing rules

Status: done

Blocked by: none

## Intended behavior

Preserve provider/manual fixed commitments, model outdoor difficulty and daylight, and
keep group adjustments limited to sensitive planning estimates.

## Acceptance criteria

- Fixed and provider-slot timing is never stretched or moved by group size.
- Treks and similar outdoor activities retain difficulty and daylight constraints.
- Meal windows match the accepted Phase 6 ranges.
- Timing evidence remains explicit in the live contract and timeline.

## Validation approach

Run scheduler and contract tests, TypeScript and ESLint.

## Comments

Accepted as part of the Phase 6 completion request on 8 September 2026.

Implemented exact provider/manual timing, activity duration ranges, outdoor difficulty
and daylight constraints, accepted meal windows and explicit medical meal handling.
Scheduler, TypeScript and ESLint checks passed.
