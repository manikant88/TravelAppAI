# Road feasibility edit impact

Status: ready

Blocked by: 02-road-feasibility-and-segmentation.md, 04-dated-transit-stays.md

## Intended behavior

When a travel or stay edit changes a journey between feasible, road-trip dominant, and
not feasible, return a dedicated impact preview before applying the change.

## Acceptance criteria

- The preview names the affected journey and previous/new feasibility class.
- It shows added or removed travel days, destination days, transit stays, and displaced
  activities or meals.
- A newly road-trip-dominant result requires explicit road-trip confirmation.
- A not-feasible result remains unapplied and offers faster modes or a computed minimum
  trip length.
- Locks are preserved unless the user explicitly resolves a reported conflict.

## Validation approach

Add selection tests for each feasibility transition and UI tests for the preview and
confirmation actions.

## Comments

Created during the 12 September 2026 architecture review. No implementation has started.
