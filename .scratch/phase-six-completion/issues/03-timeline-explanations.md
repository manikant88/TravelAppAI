# Complete Phase 6 timeline explanations

Status: done

Blocked by: 01-activity-timing-rules.md, 02-edit-impact-preview.md

## Intended behavior

Show exact versus estimated timing, outdoor constraints, combined-meal provenance,
selection impacts and reasons unused capacity remains.

## Acceptance criteria

- Fixed/provider slots are labelled as exact commitments.
- Estimated activities show a duration range.
- Day-level capacity notes explain meaningful unfilled time.
- Confirmations show the concrete effects of the proposed edit.

## Validation approach

Run component and browser tests at desktop and mobile sizes.

## Comments

The shared timeline cards now show exact versus estimated timing, duration ranges,
outdoor constraints and combined meal evidence. Day capacity notes and the edit-impact
confirmation use the same final schedule projection. Five Playwright scenarios passed.
