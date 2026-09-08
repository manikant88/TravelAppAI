# 05: Preview and safely apply the selected stay

Status: draft
Blocked by: .scratch/cheaper-stay/issues/04-durable-comparison-tasks.md
Spec: ../spec.md

## What to build

The organizer selects an alternative, reviews refreshed consequences and confirms one atomic trip update.

## Acceptance criteria

- [ ] Build previews on the server from owned task/option references and current trip state; never trust client totals or arbitrary operations.
- [ ] Revalidate availability and material terms where supported. Any material drift requires a new preview and confirmation.
- [ ] Recheck current authority, exact version, locks and all affected constraints before commit; do not allow a stale proposal to overwrite newer state.
- [ ] Atomically save the stay, dependent transfers, cost allocations, version and mutation outcome, or save nothing.
- [ ] Use idempotency keys: repeating the same request returns its original result; reuse with different content fails.
- [ ] Return the updated projection to timeline, map, budget and chat; preserve unrelated flights, dates and activities.
- [ ] An explicitly confirmed draft edit may complete while the organizer is away if all conditions still hold. Cancellation does not undo an already committed change.
- [ ] Until participant approval functionality is delivered, do not expose customer group finalization. Any existing approval metadata must remain tied to its original version.

## Validation

Apply B through the public interface and read version 13. Test double submission, two concurrent applies, revoked access, changed price, stale version and transaction rollback using the isolated database.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
