# AI implementation handoff

Last updated: 1 September 2026

This file records the current implementation boundaries that are easy to lose
when iterating on the UI. `PROJECT_CONTEXT.md` remains the product source of
truth and `IMPLEMENTATION_SPEC.md` remains the technical contract.

## Current request path

1. Explicit UI actions remain typed client actions. Free-form draft and
   committed turns go to `/api/agent/conversation` with a client turn ID and a
   bounded `ConversationContext` containing recent history plus the app-owned
   active task, awaited fields, and actions that were actually presented.
2. `src/agent/conversation-orchestrator.server.ts` is the single free-form turn
   boundary. It uses strict model-first semantic routing when AI is configured,
   then selects exactly one permitted deterministic executor. Model failure
   falls back to bounded deterministic interpretation rather than blocking the
   trip.
3. Domain and planning code extracts and validates the trip request, searches
   grounded inventory, assembles the itinerary, and owns every consequential
   fact and state transition.
4. Final assistant-facing prose passes through
   `src/agent/assistant-message.server.ts`. The language model may improve tone
   and clarity, but it may not add or change facts. A deterministic fallback is
   always returned when communication generation is unavailable or invalid.
5. The client renders the returned message and typed result. Temporary progress
   labels remain deterministic client UI state; they are not presented as model
   conclusions.

## Conversation state and tracing

- `WorkspaceState.activeInteraction` is canonical app-owned conversational
  state, separate from the visual `InteractionPresentation`. It records whether
  the user is exploring or building, the current task, awaited fields, the last
  assistant message, and the exact guided actions shown.
- Short replies such as `Delhi`, `2 adults`, or `the second one` are interpreted
  against that active interaction. Presented-option references can resolve only
  to actions that the application actually supplied.
- No-destination prompts can remain in explicit recommendation mode. The UI
  offers editable date and traveller starting points; grounded inventory search
  still waits until the minimum executable brief is available.
- Every free-form turn logs a server trace with client turn ID, trace ID, phase,
  semantic route, deterministic executor, outcome, duration, and degraded-mode
  status. Downstream OpenAI request IDs include the same trace correlation.

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

## Hybrid modification intent

High-confidence budget, activity-addition, and explicitly scoped card changes
are interpreted deterministically. Natural phrasing that does not map
confidently to one of those typed commands is sent to the configured planning
model for `ScopedModificationIntent` generation. The model does not bypass any
domain boundary: canonical IDs, trip dates, themes, constraints, locks,
inventory, previews, and proposals remain code-validated. A genuinely
ambiguous explicit card target is clarified with the user instead of being
delegated to the model to guess.

## OpenAI runtime configuration

- `src/agent/openai-config.server.ts` is the single server-only source for the
  OpenAI model, API key, timeout policy, and diagnostic client request IDs.
- Recommended default deadlines are 20 seconds for communication and travel
  context, 25 seconds for destination discovery, and 30 seconds for planning,
  modification, and explanation. These reflect observed structured-response
  latency from the configured `gpt-5-mini` model rather than the former 2.5–4
  second hardcoded limits.
- A request-specific timeout environment value overrides `OPENAI_TIMEOUT_MS`,
  which overrides the checked-in default. See `.env.example` for names.
- Reasoning effort is also centralized: communication and context default to
  `minimal`; destination discovery and planning default to `low`. This avoids
  spending deep-reasoning latency on schema-constrained copy while keeping the
  setting explicitly overridable per request class.
- Every Responses API call sends a unique `X-Client-Request-Id`. Structured-call
  logs include that ID, the server request ID when available, schema, model,
  duration, timeout, and failure reason without logging prompts or credentials.

## Verification baseline

- ESLint: clean.
- TypeScript: clean with `tsc --noEmit`.
- Vitest: 41 files and 202 tests passing.

## Next product pass

The next pass may focus on design-system polish and motion. It should not move
planning facts into the communication model, duplicate state outside the
reducer/domain model, or reintroduce raw API orchestration into the workspace
component.
