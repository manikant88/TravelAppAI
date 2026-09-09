# Present schedule confidence and verify the feature

Status: done

Blocked by: 03-capacity-scheduler.md, 04-experiences-and-edit-assessment.md

## Intended behavior

Explain estimated ranges, fixed times, flexible meal placement, genuine free time and
constraint findings in the existing timeline foundation.

## Acceptance criteria

- Activity cards distinguish exact times from planning estimates.
- Meal cards explain when they moved within their window.
- Free time is not mislabeled as meal preparation.
- Desktop/mobile code paths remain schema-valid.
- Repository checks and production build pass.

## Validation approach

Run TypeScript, ESLint, Vitest and the production build. Do not run browser automation
without a separate explicit request.

## Comments

Timeline cards now expose estimated duration ranges, fixed timing evidence, shifted
meals, combined-meal provenance, flexible time, capacity notes and day-level findings.
TypeScript, ESLint, 325 Vitest tests, the production build and five Playwright
desktop/mobile scenarios passed on 8 September 2026.
