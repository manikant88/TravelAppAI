# Validate complete scheduled intervals

Status: done

Blocked by: none

## Intended behavior

Use one reusable regular-hours validator for meals, activities, and evening candidates.

## Acceptance criteria

- Validation distinguishes valid, invalid, and unresolved.
- A venue must remain open through the end of the interval.
- Overnight regular-hours periods are understood.
- Cards show the validation note without rendering the full weekly schedule.

## Validation approach

Run focused opening-hours, timeline, planner, type, lint, and build checks.

## Comments

Implemented one interval validator for meals and projected activities, including regular
periods crossing midnight and explicit valid, invalid, and unresolved evidence.

Verified on 7 September 2026 with TypeScript, repository-wide ESLint, all 312 Vitest
tests, and the Next.js production build.
