# Dated transit stays

Status: done

Blocked by: 02-road-feasibility-and-segmentation.md

## Intended behavior

Use each overnight road stop and date to search supplier stay inventory. Keep a Google
place candidate as an unresolved fallback. Recheck the selected main destination property
for road-adjusted arrival and checkout dates.

## Acceptance criteria

- Every overnight road segment has a dated transit-stay search.
- A place-only fallback stays explicitly unverified for availability and price.
- The destination stay is rechecked for actual occupancy dates.
- If the property is absent or the recheck fails, stale supplier price and availability
  are removed.

## Validation approach

Use deterministic road tests plus provider-controlled planner tests for returned, absent,
and failed stay rechecks.

## Comments

Implemented in the road-journey and planner boundaries. The stale-offer removal case was
added and verified on 12 September 2026.
