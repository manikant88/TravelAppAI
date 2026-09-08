# 08: Complete the saved-trip journey with live providers

Status: draft
Blocked by: .scratch/cheaper-stay/issues/06-participant-approval.md, .scratch/cheaper-stay/issues/07-live-provider-evaluation.md
Spec: ../spec.md

## What to build

An organizer compares genuine stay alternatives, safely updates the shared trip, gathers renewed approval and follows a valid supplier handoff.

## Acceptance criteria

- [ ] Connect the approved provider capabilities to the existing application operations without weakening domain checks.
- [ ] Implement provider-specific freshness, retention, attribution and handoff behavior; keep app-owned decisions distinct from licensed responses.
- [ ] Configure measured finite task budgets and useful failure states. Missing live inventory never falls back to synthetic customer offers.
- [ ] Verify all twelve spec acceptance scenarios across application integration tests and access-dependent provider contract checks.
- [ ] Perform manual mobile/desktop review; automated browser testing remains subject to explicit user request.
- [ ] Record latency, cost per comparison, invalid-result rate, unsupported conditions and unresolved release risks.
- [ ] Reconcile canonical technical docs and README with delivered behavior. An outbound handoff is not recorded as a completed booking.

## Validation

Combine deterministic application acceptance tests with a small permitted live provider evaluation and manual UI review. Verify real handoff continuity, not just an HTTP success.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
