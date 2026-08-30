# AI implementation handoff

Last updated: 30 August 2026

This file records the current implementation boundaries that are easy to lose
when iterating on the UI. `PROJECT_CONTEXT.md` remains the product source of
truth and `IMPLEMENTATION_SPEC.md` remains the technical contract.

## Current request path

1. The client sends natural-language intake to `/api/agent/conversation`.
2. Domain and planning code extracts and validates the trip request, searches
   grounded inventory, assembles the itinerary, and owns every consequential
   fact and state transition.
3. Final assistant-facing prose passes through
   `src/agent/assistant-message.server.ts`. The language model may improve tone
   and clarity, but it may not add or change facts. A deterministic fallback is
   always returned when communication generation is unavailable or invalid.
4. The client renders the returned message and typed result. Temporary progress
   labels remain deterministic client UI state; they are not presented as model
   conclusions.

## Client boundaries

- `src/ui/services/agent-http.ts` owns agent POST transport and normalized API
  errors.
- `src/ui/services/conversation-client.ts` owns intake, committed-trip
  conversation, and optional assistant-message rewriting.
- `src/ui/services/planning-client.ts` owns specified planning and destination
  discovery requests.
- `src/ui/services/modification-client.ts` owns proposal application.
- `src/ui/workspace.tsx` coordinates view state and renders the persistent trip;
  it does not construct raw agent requests with `fetch`.

## Deterministic planning invariant

Recurring activity offers may share an activity identity across dates. The
deterministic planner tracks `activity_id` and never selects the same activity
identity more than once in an itinerary. The assembler continues to enforce
this invariant as a final validation boundary.

## Verification baseline

- ESLint: clean.
- TypeScript: clean with `tsc --noEmit`.
- Vitest: 39 files and 180 tests passing.

## Next product pass

The next pass may focus on design-system polish and motion. It should not move
planning facts into the communication model, duplicate state outside the
reducer/domain model, or reintroduce raw API orchestration into the workspace
component.
