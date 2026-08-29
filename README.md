# Travel App AI

An AI-assisted travel-planning workspace prototype. Users describe a trip in natural language, receive a grounded itinerary, and refine travel, stays, activities, dates, travellers, budget, and preferences from one persistent workspace.

The product is intentionally bounded:

- inventory is synthetic, deterministic, and read-only at runtime;
- code owns dates, prices, availability, route assembly, totals, constraints, locks, and validation;
- AI interprets intent, chooses bounded planning actions, and improves conversational copy;
- no booking, payment, authentication, live supplier APIs, or autonomous browser control is included.

## Stack

- Next.js App Router 16
- React 19 and TypeScript strict mode
- Zod contracts at API/model boundaries
- Drizzle ORM and Neon Postgres for the optional database-backed inventory
- Bundled snapshot inventory for the dependable demo path
- OpenAI Responses API with structured outputs when an API key is configured
- Vitest for unit and contract tests
- CSS variables and global styles for the workspace UI

Node.js 22.13 or newer is required.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For the most reliable local demo, keep these values in `.env.local`:

```bash
INVENTORY_SOURCE=snapshot
INVENTORY_VERSION=travel-seed-v2
```

`OPENAI_API_KEY` is optional. Without it, supported planning and communication paths use deterministic fallbacks. Add `OPENAI_MODEL` and `OPENAI_API_KEY` only when you want to demonstrate model-assisted intent extraction or conversational copy.

Never commit `.env.local` or credentials.

## Environment variables

See [.env.example](./.env.example). The important variables are:

| Variable | Purpose |
| --- | --- |
| `INVENTORY_SOURCE` | `snapshot` (default), `hybrid`, or `neon` |
| `INVENTORY_VERSION` | Seed version, currently `travel-seed-v2` |
| `DATABASE_URL` | Runtime database connection, optional for snapshot mode |
| `DATABASE_ADMIN_URL` | Migration/seed connection only |
| `OPENAI_API_KEY` | Server-only model credential |
| `OPENAI_MODEL` | Configurable model name, e.g. `gpt-5-mini` |
| `PEXELS_API_KEY` | Image seeding only |
| `PEXELS_IMAGE_LIMIT` | Optional image import limit |
| `PEXELS_RESULTS_PER_TARGET` | Pexels search results per target |

## Application behavior

The workspace has one durable itinerary document:

- `WorkspaceState.itinerary.request` is the current trip brief;
- `WorkspaceState.itinerary.trip` is the current validated trip when one exists;
- `WorkspaceState.itinerary.projection` contains derived itinerary cards and totals;
- `WorkspaceState.interaction` is ephemeral progress, focus, and guided-action metadata—not a second trip state.

AI-driven changes show truthful progress and pulse the affected field, day, card, or total. They do not automatically take actions and are guard railed by deterministic actions. Explicit user Change/Add action are also accounted for. Errors and constraint conflicts are communicated in chat with grounded recovery actions.

## Database and image commands

Only run database commands when the relevant Neon variables are configured:

```bash
npm run db:migrate       # apply Drizzle migrations
npm run db:seed          # seed deterministic inventory
npm run db:seed:images   # fetch/store Pexels image assets
npm run db:sync:images   # export resolved Pexels rows into snapshot seed
npm run db:verify        # verify Neon seed coverage/integrity
npm run db:verify-runtime
npm run inventory:verify
```

The runtime app does not write inventory. Image seeding requires a valid `PEXELS_API_KEY`; existing snapshot image rows remain usable without reseeding.

## API areas

- `/api/agent/conversation` — draft intake, explanation, and committed-trip modification routing
- `/api/agent/communicate` — optional bounded message/action-label rewriting with deterministic fallback
- `/api/agent/plan` — specified-destination planning
- `/api/agent/discover` — open destination comparison
- `/api/agent/intake` and `/api/agent/modify` — focused agent contracts
- `/api/inventory/*/search` — typed transport, stay, activity, and transfer search
- `/api/locations/search` — normalized location lookup
- `/api/trip/proposals/*` — validated internal proposal preview/application transactions
- `/api/health/inventory` — runtime inventory readiness

The model never receives database credentials or mutates `TripState`. It only returns schema-constrained intent, bounded hypotheses/actions, or communication copy grounded in facts supplied by code.

## Verification

Run these before handing the project to another device or assistant:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

The latest recorded handoff passed all four commands: 37 test files and 165 tests passed, lint completed cleanly, and the production build succeeded.


## Project structure

```text
src/agent/       Intent extraction, deterministic planning/modification, bounded model adapters
src/app/         Next.js page, layout, API route handlers, global styles
src/db/          Drizzle schema, migrations, deterministic seed and image synchronization
src/domain/      Dates, money, request validation, trip projection, proposals
src/inventory/   Snapshot/Neon repositories, typed search contracts and inventory service
src/ui/          Workspace canvas, planning animation, image skeletons and inventory cache
tests/           Agent, domain, inventory, database, contract and snapshot end-to-end tests
public/          Lottie animation, logos, seeded/local visual assets and Figma references
```

## Manual smoke scenarios

1. “Plan a 3-day relaxing trip from Delhi for two adults under ₹45,000 with good food and minimal travel.”
2. “Plan five days from Delhi to Goa from 15 December 2026 for two adults. Budget ₹95,000, relaxed pace, beaches and food.”
3. After a trip exists: “Find a cheaper stay but keep my travel selections.”
4. “Update day 3 with two activities: one outdoor adventure and one food and market experience.”
5. “Plan a trip to Bali for two adults next weekend.” Verify origin guidance appears rather than a blocking erro