# 03: Compare cheaper stays without changing the trip

Status: draft
Blocked by: .scratch/cheaper-stay/issues/02-room-groups-and-costs.md
Spec: ../spec.md

## What to build

An organizer requests cheaper stays and reviews sourced alternatives with room and affected-transfer costs while retaining the selected stay.

## Acceptance criteria

- [ ] Resolve the target stay or ask for clarification; searching alone never changes the shared itinerary.
- [ ] Keep AI interpretation and recommendation separate from validated supplier calls, route evaluation, arithmetic and mutation authority.
- [ ] Use controlled provider adapters only in isolated development/tests. Customer operation requires supported live adapters or an honest unavailable state.
- [ ] Apply hard constraints and evaluate affected transfers, vehicle capacity, room inclusions and meals before presenting estimated savings.
- [ ] Reproduce the spec comparison: A saves INR 2,000 and B INR 3,500 with correct per-traveller allocations; explain time and comfort trade-offs from supplied facts.
- [ ] Flag incomplete evidence, unknown accessibility, locked choices, booked/unknown stay status and failures without inventing facts or implying exhaustive market coverage.
- [ ] Enforce finite request/candidate/retry limits and derive notification/progress text from actual work.

## Validation

Exercise request/read-result operations against controlled model/provider responses. Verify the unchanged saved version, exact comparison oracle, unsupported facts, injected supplier instructions and malicious model IDs.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
