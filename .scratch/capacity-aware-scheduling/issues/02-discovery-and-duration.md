# Broaden activity discovery and classify durations

Status: done

Blocked by: 01-scheduling-contracts.md

## Intended behavior

Build a diverse bounded activity pool and classify planning durations without inventing
provider schedules.

## Acceptance criteria

- Discovery covers several relevant categories and deduplicates place IDs.
- Detailed/photo work is limited to scheduled candidates.
- Fixed/provider evidence is never stretched for group size.
- Elastic and pace-sensitive estimates retain ranges and group adjustments.

## Validation approach

Run planner/provider tests and call-budget assertions.

## Comments

Implemented six bounded, deduplicated Google category searches plus conditional evening
discovery and limited detailed photo enrichment to six scheduled candidates. Duration
profiles retain explicit evidence, group sensitivity, outdoor difficulty and daylight
planning constraints. Repository checks passed on 8 September 2026.
