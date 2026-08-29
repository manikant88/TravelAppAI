# AI implementation handoff

Last updated: 29 August 2026

This is the first file a new coding assistant should read after `AGENTS.md`. Then read `PROJECT_CONTEXT.md` and consult `IMPLEMENTATION_SPEC.md` for domain and inventory contracts. Where older approval/state language conflicts with this handoff, the decisions in **Current product decisions** below supersede it.

## Current objective

Finish a reliable MakeMyTrip-inspired AI trip-planning demo. The demo should feel agentic through useful communication and visible, truthful UI feedback, while all dates, prices, availability, itinerary assembly, validation, locks, and mutations remain deterministic.

This is not an open-ended autonomous agent. The model is a bounded language and judgment layer around deterministic inventory and domain code.

## Current product decisions

1. **One durable itinerary state.** `WorkspaceState.itinerary` owns the current `request`, optional committed `trip`, and derived `projection`. Do not reintroduce separate workspace draft/proposal/committed documents.
2. **User intent is authoritative.** A valid change explicitly requested by the user is applied after deterministic validation. Internal typed proposals remain useful as safe mutation transactions, but they are not a second user-visible workspace state.
3. **Recommendations may persist.** A recommendation that has been deterministically assembled and validated may be placed in the itinerary. The user can keep, change, or remove it.
4. **Snapshot inventory is the demo default.** Keep `INVENTORY_SOURCE=snapshot` and `INVENTORY_VERSION=travel-seed-v2` for the dependable demo. Neon is an optional verification/seed source, not a runtime dependency for the happy path.
5. **Code owns truth.** The model never invents IDs, inventory, prices, dates, actions, totals, validation, or mutations.
6. **LLM communication is optional and bounded.** The model may rewrite deterministic messages and action labels, but action payloads are canonical and schema-validated. Failure or timeout must use deterministic fallback copy.
7. **No chain-of-thought UI.** Show concise operation events such as “checking stays” or “validating total,” not private model reasoning.
8. **Drawers are manual tools.** AI-requested changes should focus/pulse the relevant header field, itinerary day, or selection card. Do not automatically open an inventory drawer. Drawers open only after the user explicitly clicks Change/Add.
9. **Planning animation appears only for the first plan.** The initial planning state is visible for at least five seconds. Subsequent modifications use chat progress and surface emphasis for about six seconds and must not replay the initial Lottie animation.
10. **Errors belong in conversation.** Do not restore the large “Action paused” cards. Explain the constraint or failure naturally in chat and offer executable recovery actions when possible.

## What was completed in the latest refactor

### Deterministic planning and modification reliability

- Natural-language routing has a deterministic path and no longer requires an OpenAI key to perform supported flows.
- Snapshot-backed planning and discovery are the primary runtime paths.
- Deterministic modification handles common travel, stay, activity, lock, and day-scoped requests before relying on a model.
- Multi-activity requests such as “update day 3 with an outdoor activity and a food market activity” are parsed as scoped deterministic modifications.
- Planning/model failure falls back safely without changing canonical trip state.

### Conversation and AI interaction UX

- The synthetic welcome assistant message was removed. The user starts the conversation.
- The composer clears immediately when a message is submitted.
- Conversation automatically scrolls when messages or interaction progress change.
- `InteractionPresentation` now carries:
  - a concise message;
  - truthful typed progress events;
  - executable guided actions;
  - an optional UI focus target.
- Generic pills such as “Delhi,” “Explain route,” or “Make stay cheaper” were removed from the permanent UI.
- Missing facts are requested one at a time with state-derived actions.
- Planning, discovery, modification, validation, and recovery can display typed progress.
- AI-driven modifications pulse the affected trip field, selection, day, or total without opening drawers.
- Manual inventory drawers remain available from explicit Change/Add buttons.
- Error and constraint recovery is shown conversationally instead of through detached error cards.

### Bounded communication adapter

- `/api/agent/communicate` accepts only a validated `CommunicationContext`.
- The OpenAI adapter uses structured output and a 2.5 second timeout.
- The model may rewrite only the message and labels for action IDs supplied by code.
- Unknown/model-created action IDs cause deterministic fallback.
- Intake/clarification communication is integrated in `/api/agent/conversation`.

### Existing data and UI work that must be preserved

- Origin and destination markets are normalized to work in both roles where inventory coverage permits.
- Pexels `image_assets` support and snapshot image synchronization exist.
- `images.pexels.com` is configured for `next/image`.
- Hotel and activity images use seeded image URLs with skeletal loading states.
- The destination comparison canvas was redesigned to use photo cards.
- Trip brief fact editors use number inputs for traveller counts, close on outside click, stay inside the viewport, and position below the selected fact.
- Budget appears first in the preferences summary/editor.
- Itinerary totals are recalculated from the selected offers and traveller composition after update.
- Day tabs respond to click and scroll position.

## Architecture map

### Canonical client state

- `src/state.ts`
  - `WorkspaceState.itinerary.request`: current trip brief.
  - `WorkspaceState.itinerary.trip`: current validated trip, when available.
  - `WorkspaceState.itinerary.projection`: derived hydrated itinerary and totals.
  - `WorkspaceState.interaction`: ephemeral conversation progress/actions/focus. It is not a second itinerary state.

### Interaction UX contracts

- `src/agent/interaction-contracts.ts`
  - `InteractionEvent`
  - `WorkspaceFocus`
  - `GuidedAction`
  - communication input/output schemas
- `src/agent/interaction-guidance.ts`
  - deterministic intake questions/actions
  - planning progress events
  - recovery presentation helpers
- `src/agent/communication.ts`
  - deterministic fallback
  - optional model composition
  - enforcement that model copy cannot alter action payloads
- `src/app/api/agent/communicate/route.ts`
  - server-only OpenAI communication endpoint

### Main workflow UI

- `src/ui/workspace.tsx`
  - intake, plan, discovery, explanation, modification, guided actions
  - chat rendering and auto-scroll
  - trip brief editor
  - itinerary rendering and manual inventory drawers
  - focus/pulse behavior
- `src/ui/planning-animation.tsx`
  - first-plan animation only
- `src/app/globals.css`
  - workspace layout, drawer, skeleton, progress, and AI focus states

### Planning and inventory

- `src/agent/plan-api.ts`: public planning orchestration/fallback result.
- `src/agent/deterministic-planner.ts`: deterministic planning strategy.
- `src/agent/deterministic-modification.ts`: deterministic natural-language change scoping.
- `src/agent/modify.ts`: validated modification and proposal construction.
- `src/agent/natural-intake.ts`: extraction, date/traveller normalization, and location resolution.
- `src/inventory/repository.ts`: runtime repository selection (`snapshot`, `hybrid`, or `neon`).
- `src/inventory/snapshot-repository.ts`: bundled reliable demo inventory.
- `src/db/seed/market-manifest.ts`: canonical deterministic seed manifest.
- `src/db/seed/image-assets.ts`: snapshot image rows.

## Important invariants for future changes

- Never import seed modules directly into client UI.
- Never calculate prices or invent inventory in the model.
- Never accept a model-provided action, ID, destination, or fact unless it is present in the bounded context supplied by code.
- Do not add destination-name branches to planner/domain/UI code.
- Do not make the snapshot path depend on Neon availability.
- Do not expose `DATABASE_URL`, `DATABASE_ADMIN_URL`, or `OPENAI_API_KEY` to client code.
- Preserve unrelated and locked selections during scoped modifications.
- Do not use decorative progress that claims an operation happened before it did.
- Keep manual drawer selection immediate and deterministic.
- Keep all date handling in explicit ISO dates and the project’s date utilities; do not use locale parsing for canonical state.
- Before changing Next.js APIs, read the relevant installed guide under `node_modules/next/dist/docs/` as required by `AGENTS.md`.

## Environment setup

Recommended demo values in `.env.local`:

```bash
INVENTORY_SOURCE=snapshot
INVENTORY_VERSION=travel-seed-v2
OPENAI_MODEL=gpt-5-mini
OPENAI_API_KEY=         # optional for deterministic fallback; required to demonstrate model-written copy
DATABASE_URL=          # optional when snapshot is used
DATABASE_ADMIN_URL=    # only needed for migrations/seeding
PEXELS_API_KEY=        # only needed when reseeding images
```

Never put actual credentials in this document or a shared archive. Transfer `.env.local` separately through a secure channel, or recreate it on the target laptop.

Install and run:

```bash
npm install
npm run dev
```

The project requires Node.js 22.13 or newer.

## Verification status at handoff

The following passed on 29 August 2026:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Result: 37 test files and 165 tests passed. ESLint completed with zero warnings/errors. The production Next.js build completed successfully.

The user explicitly asked not to automate browser tests. Continue using unit/contract/build verification; the user will manually validate UX flows.

## Manual happy paths to test next

1. **Open destination discovery**
   - “Plan a 3-day relaxing trip from Delhi for two adults under ₹45,000 with good food and minimal travel.”
   - Expect one initial planning animation, grounded destination comparison, no Neon dependency, and photo cards.

2. **Specified destination**
   - “Plan five days from Delhi to Goa from 15 December 2026 for two adults. Budget ₹95,000, relaxed pace, beaches and food.”
   - Expect a validated itinerary, populated images, and totals derived from selected offers.

3. **Scoped stay change**
   - After a trip exists: “Find a cheaper stay but keep my travel selections.”
   - Expect chat progress and the stay card to pulse. No drawer should auto-open. The change should apply only if a valid cheaper option exists; otherwise chat should explain that no cheaper valid stay was found.

4. **Day-scoped multi-activity change**
   - “Update day 3 with two activities: one outdoor adventure and one food and market experience.”
   - Expect day 3 to pulse, truthful progress for search/selection/validation, two schedule-valid activities when inventory permits, and no “tell me what to change” clarification.

5. **Missing origin guidance**
   - “Plan a trip to Bali for two adults next weekend.”
   - Expect the assistant to ask where the journey begins and show supported origin actions, not an error card.

6. **Conflict recovery**
   - Request an intentionally impossible budget after a trip is generated.
   - Expect a natural chat explanation and executable options such as increasing/removing the exact constraint or changing destination scope.

## Known follow-up work

Prioritize these in order:

1. Manually test the six flows above and fix concrete regressions before adding features.
2. Audit the remaining planning/discovery/modification final messages so every deterministic outcome can optionally pass through the bounded communication adapter, without delaying or controlling mutation.
3. Improve operation-event progression granularity. Planning currently shows a bounded staged list; it does not stream server-side events.
4. Add deterministic “no better option” copy for every travel/stay/activity modification category and ensure it never looks stuck.
5. Review old approval wording in the long implementation spec. Typed proposals remain internal transactions, but the UI now follows the one-itinerary decision.
6. Prepare final demo artifacts only after the application flows are stable.

## Transfer between laptops without Git

If “no Git access” means no GitHub/network access but the target laptop can run Git locally, the safest option is to include the hidden `.git` directory in the archive. Local commits, diffs, and rollback work without any remote connection. Exclude `.git` only when Git truly cannot be used on the target device.

Recommended archive contents:

- include source, tests, migrations, public assets, Markdown context files, `package.json`, and lockfile;
- exclude `.git`, `.next`, `node_modules`, coverage output, logs, `.env`, and `.env.local`;
- recreate `.env.local` securely on the destination laptop;
- run `npm install`, then the four verification commands before making changes;
- before copying the edited archive back, delete the old extracted folder or extract into a new timestamped folder to avoid retaining deleted files.

Suggested archive command when Git truly cannot be used, from the directory containing the project:

```bash
zip -r travel-api-handoff.zip "Travel API" \
  -x "Travel API/.git/*" \
     "Travel API/.next/*" \
     "Travel API/node_modules/*" \
     "Travel API/coverage/*" \
     "Travel API/.env" \
     "Travel API/.env.local" \
     "Travel API/*.log"
```

Because the target has no Git access, keep a pristine copy of each transferred zip until the returned version has passed verification. This is the recovery mechanism for accidental overwrites or deleted files.

## Instructions for the next AI assistant

1. Read `AGENTS.md`, this file, and `PROJECT_CONTEXT.md` before editing.
2. Inspect `git status` if Git metadata exists; otherwise assume every existing file is user-owned and avoid broad rewrites.
3. Do not restart the architecture or introduce LangGraph, multiple agents, RAG, or new persistence unless the user explicitly changes scope.
4. Diagnose from code and tests before guessing from screenshots.
5. Use `apply_patch` for edits and preserve unrelated changes.
6. Do not run automated browser tests unless the user explicitly reverses the current instruction.
7. After every meaningful slice, run typecheck and focused tests; before handoff run all four verification commands.
8. Report exactly what changed, what remains, and which manual scenario the user should test next.
