# Complete bounded category discovery and combined-meal provenance

Status: done

Blocked by: 01-activity-timing-rules.md

## Intended behavior

Cover the accepted activity categories with bounded Google searches and retain an
explicit provider, manual or place-description basis for combined meal experiences.

## Acceptance criteria

- Discovery covers landmarks, culture, markets/neighbourhoods, parks/viewpoints,
  outdoor/adventure, family and relevant evening experiences.
- Place IDs are deduplicated before scheduling.
- Only the scheduled shortlist receives detail/photo enrichment.
- Combined-meal evidence identifies its provenance.

## Validation approach

Run planner/provider tests including the complete Google call-budget assertion.

## Comments

Implemented six bounded category searches plus conditional evening discovery,
deduplication, six-candidate detail/photo enrichment and explicit provider/manual/Google
description meal provenance. Planner tests keep the mocked Google budget at or below 60.
