# Onward flight adapter

Status: done

Blocked by: 01-independent-journey-intake.md

## Intended behavior

Search a flight from the primary destination to a different onward destination
independently.

## Acceptance criteria

- The onward origin is the primary destination.
- The onward destination and dates are validated independently.
- The selected offer and its airport transfers use the later-journey direction.
- The compatibility projection does not relabel the journey as a return to origin.

## Validation approach

Use planner and selection tests for mixed outward/later modes and onward destinations.

## Comments

Implemented with the existing later-flight compatibility slot. Verified by planner and
selection tests on 12 September 2026. Replacing that slot with a first-class journey-leg
collection is tracked by ticket 06.
