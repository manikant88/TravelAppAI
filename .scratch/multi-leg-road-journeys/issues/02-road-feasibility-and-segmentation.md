# Road feasibility and segmentation

Status: done

Blocked by: 01-independent-journey-intake.md

## Intended behavior

Convert raw road duration into daily self-drive or cab segments with breaks, meal time,
overnight rest, and date-capacity classification.

## Acceptance criteria

- Self-drive uses at most eight driving hours per day and cab uses at most ten.
- Substantial driving days contain breaks and meal time.
- Multi-day travel contains overnight rest and consumes itinerary dates.
- Journeys are classified as feasible, road-trip dominant, or not feasible.
- Destination activities do not appear on travel-only days.

## Validation approach

Use pure road-segmentation tests and planner integration tests for consumed day capacity.

## Comments

Implemented in `src/live/road-journey.ts` and live planning/scheduling. Verified by the
road journey and planner test suites on 12 September 2026.
