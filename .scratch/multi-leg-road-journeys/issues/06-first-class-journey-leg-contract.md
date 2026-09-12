# First-class journey leg contract

Status: ready

Blocked by: 01-independent-journey-intake.md, 03-onward-flight-adapter.md

## Intended behavior

Replace the outward/return compatibility fields with an ordered collection of journey
legs whose origin, destination, dates, mode, offers, route evidence, road plan, locks,
and selection state are independent.

## Acceptance criteria

- End-at-destination trips contain only an outward intercity leg.
- Return trips contain an outward leg and a later leg to the origin.
- Continue-elsewhere trips contain a later leg to the stated onward destination.
- Mixed flight, transit, cab, and self-drive modes use the same leg interface.
- Timeline, map, drawers, locks, and selection refresh address a leg by stable ID.
- Existing live plans either migrate through one compatibility adapter or fail with a
  clear schema-version message.

## Validation approach

Add schema round-trip tests, planner tests for each end intent and mode combination, and
selection/UI tests for leg-addressed changes and locks.

## Comments

Created during the 12 September 2026 architecture review. The current later flight still
uses the legacy `return` slot.
