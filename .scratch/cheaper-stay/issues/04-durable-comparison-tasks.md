# 04: Resume and cancel stay comparisons

Status: draft
Blocked by: .scratch/cheaper-stay/issues/03-compare-cheaper-stays.md
Spec: ../spec.md

## What to build

An organizer starts a comparison, leaves, then returns to its progress or results; cancellation prevents further actionable work.

## Acceptance criteria

- [ ] Persist task identity, actor/scope, base version, progress, finite deadline and call/cost counters.
- [ ] Run the same comparison behind resumable worker execution; do not leave a second independent planning implementation.
- [ ] Leaving the page does not cancel. A new session can read authorized progress and useful partial results.
- [ ] Checkpoint/lease work and handle worker retries without duplicate application effects. Define bounded retries before activation.
- [ ] Cancellation is idempotent and stops new calls and actionable publication; explain that already-running supplier requests may still finish or incur cost.
- [ ] Prevent cross-trip or private-task reads; distinguish awaiting input, completion, cancellation, exhaustion and failure. No recurring monitoring is enrolled.

## Validation

Use the public task operations with controlled provider delays and isolated durable storage. Verify reconnect, worker recovery, duplicate delivery, unauthorized reads, cancellation races and budget exhaustion without browser automation.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
