# AI implementation handoff

Last updated: 12 September 2026

This is the short continuation map for `codex/product-foundation`. Product decisions are
in `PROJECT_CONTEXT.md`, current technical contracts in `IMPLEMENTATION_SPEC.md`, terms
in `CONTEXT.md`, and feature acceptance history in `.scratch/`.

## Start here

The branch contains one session-only live planner. `/plan` renders `LiveWorkspace`; the
conversation endpoint accepts `phase: live` and `phase: live-selection`. The retired
prototype runtime, stored inventory, migrations, APIs, UI, tests, and assets were removed
during the 12 September architecture review.

For routine work, read only the relevant implementation-spec section:

- sections 3–5 for brief intake, Trip Essentials, dates, and recovery;
- sections 6–8 for providers, travel, road journeys, scheduling, and meals;
- section 9 for changes, locks, and impact confirmation; and
- sections 10–11 for workspace behavior, maps, loading, and runtime errors.

## Runtime path

1. `src/ui/live-workspace.tsx` owns the session, stages brief updates, sends delta chat
   messages, and renders essentials, recovery, loading, or a valid itinerary.
2. `src/live/handler.server.ts` constructs providers and deadlines for the single
   conversation route.
3. `src/live/planner.ts` coordinates extraction, readiness, searches, travel, stay
   occupancy, scheduling, validation, and the final explanation.
4. `src/live/intake-fallback.ts` and `explicit-dates.ts` preserve explicit facts when the
   model is unavailable. `essentials.ts` decides whether planning may start.
5. `src/live/travel-policy.ts` owns route profiles and flight ranking.
   `road-journey.ts` owns safe multi-day road segmentation and transit stays.
6. `src/live/scheduler.ts` owns capacity and constraint findings;
   `timeline.ts` projects dated events for UI and map use.
7. `src/live/selection.server.ts` validates locks and observed IDs, recalculates affected
   state, and returns edit impact or confirmation.

## Trust boundaries

- `LiveBrief` is canonical session intent. Outward and later destinations and modes are
  independent.
- Render a newly generated plan only when `generationStatus === "valid"`. An incomplete
  result carries a `generationIssue` and returns to Trip Essentials recovery.
- Route evidence is not a ticket, seat, private-cab quote, or booking. Place evidence is
  not dated room availability. Supplier offers retain environment, freshness, price,
  availability, and booking capability.
- Model output may interpret text and rank observed IDs. Code owns dates, arithmetic,
  feasibility, route continuity, availability interpretation, locks, and state changes.
- Customer copy explains destinations, choices, and practical trade-offs. Provider names
  remain on evidence and attribution surfaces.

## Changes from the architecture review

- Removed the retired deterministic planning runtime, stored inventory, database schema
  and migrations, seed data, routes, UI, tests, assets, dependencies, scripts, and env
  variables.
- Replaced the home-page seed dependency with static destination prompts.
- Reduced provider-neutral inventory contracts to the live stay and transport offers.
- Reduced shared domain primitives to dates, locations, travel modes, and route stops.
- Added deterministic explicit-date and intake fallbacks.
- Added shared route-search and flight-ranking policy.
- Added first-class multi-day road segmentation with breaks, meals, transit stays, and
  destination-day capacity.
- Fixed mixed-mode planning so outward flight fallback routes survive when the later leg
  uses another mode.
- Fixed road-adjusted stay revalidation so an absent or failed property recheck removes
  stale price and availability.
- Rewrote canonical docs around the current live-only architecture.

## Active design debt

- `planner.ts` and `selection.server.ts` remain large orchestration modules. Extract
  cohesive policy when modifying those areas.
- `LivePlan` is a compatibility contract. Replace outward/return projections with ordered
  journey legs via
  `.scratch/multi-leg-road-journeys/issues/06-first-class-journey-leg-contract.md`.
- Add route-edit feasibility impact via
  `.scratch/multi-leg-road-journeys/issues/05-road-feasibility-edit-impact.md`.
- Complete the deferred night-occupancy and lock-aware work in
  `.scratch/route-aware-evenings/issues/05-future-cross-midnight-and-user-options.md`.

## Verification

Do not run automated browser tests unless the user explicitly requests them.

Verified on 12 September 2026 after the live-only cleanup:

- `npm run typecheck` passed;
- `npm run lint` passed;
- `npm test` passed 20 files and 148 tests; and
- `npm run build` passed with `/`, `/plan`, and `/api/agent/conversation` as the only
  application routes besides the framework not-found page.

No commit or push is part of this pass.
