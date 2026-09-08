# 06: Review and approve the changed trip

Status: draft
Blocked by: .scratch/cheaper-stay/issues/05-preview-and-apply-stay.md
Spec: ../spec.md

## What to build

Invited travellers or their assigned representatives review the changed stay and approve the specific trip version before organizer finalization.

## Acceptance criteria

- [ ] Claim invitations with verified identity; forwarded links alone cannot impersonate the intended traveller or disclose private details.
- [ ] Persist membership, visible representative assignments and per-version approval coverage.
- [ ] Group members may inspect permitted comparisons and suggest choices but cannot apply organizer-only shared changes.
- [ ] Show the changed stay, personal costs, timing effects and preserved choices on mobile and desktop.
- [ ] Material edits invalidate current approval coverage while preserving historical approvals. Finalization requires valid coverage for everyone and no unresolved hard/feasibility gaps.
- [ ] Keep private departure details and personal exploration out of shared explanations.
- [ ] Do not expand this ticket into the full anonymous option-voting feature; that remains a separate product slice.

## Validation

Exercise invitation claiming, member reads, representative approval and finalization through public operations. Verify version changes, forged identities, uncovered travellers, privacy and denied member mutations.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
