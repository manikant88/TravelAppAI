# 02: Represent room groups and participant costs

Status: draft
Blocked by: .scratch/cheaper-stay/issues/01-save-and-reopen-owned-trip.md
Spec: ../spec.md

## What to build

The organizer assigns five travellers to two rooms and sees correct individual and group costs on the saved trip.

## Acceptance criteria

- [ ] Represent two room groups of two and three travellers with dates, occupancy, inclusions and booked/unbooked/unknown status.
- [ ] Allow equal shares or explicit amounts/percentages for applicable shared costs; use currency minor units and exact allocation totals.
- [ ] Include distinct arrival groups and activity participants needed to identify affected transfers; unchanged itinerary selections remain intact.
- [ ] Display known, estimated and unknown charges distinctly. Missing costs do not become zero.
- [ ] Persist edits and validate personal budgets, participant references, occupancy and allocations through the application boundary.

## Validation

Save/reopen the worked-example groups and compare read-back costs with independent expected amounts. Verify rounding, mismatched shares, invalid occupancy and a personal budget breach.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
