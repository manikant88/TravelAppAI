# Add meals to live planning

Status: done

Blocked by: none

## Intended behavior

Collect dining preferences and schedule mapped breakfast, lunch, and dinner blocks with
honest Google evidence and route dependencies.

## Acceptance criteria

- Intake asks before provider search when dining preference is missing.
- Vegetarian and pure-vegetarian-only remain distinct.
- Lunch and dinner restaurants are checked against regular hours at their target times.
- Meal stops appear in the continuous timeline and adjacent map.
- Transfers and downstream times include meal locations.
- Unknown dietary handling and prices are never presented as verified.

## Validation approach

Run targeted planner, selection, Google provider, timeline, type, lint, build, and browser
interaction checks.

## Comments

Implemented on 7 September 2026 with Google restaurant place evidence, deterministic meal
targets, stay breakfast handling, route-chain integration, and explicit dietary caveats.
TypeScript, repository-wide ESLint, production build, all 305 Vitest tests, and four
Playwright interaction tests passed.
