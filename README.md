# Travel App AI

An AI-assisted travel-planning workspace being developed for actual customers. Users describe a trip in natural language, receive a grounded itinerary, and refine travel, stays, activities, dates, travellers, budget, and preferences from one persistent workspace.

The current development implementation has these limitations; the customer product scope is being defined:

- inventory is synthetic, deterministic, and read-only at runtime;
- code owns dates, prices, availability, route assembly, totals, constraints, locks, and validation;
- AI interprets intent, chooses bounded planning actions, and improves conversational copy;
- no booking, payment, authentication, live supplier APIs, or autonomous browser control is included.

## Stack

- Next.js App Router 16
- React 19 and TypeScript strict mode
- Zod contracts at API/model boundaries
- Drizzle ORM and Neon Postgres for the optional database-backed inventory
- Bundled snapshot inventory for the repeatable development path
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

For the local development with synthetic inventory, keep these values in `.env.local`:

```bash
INVENTORY_SOURCE=snapshot
INVENTORY_VERSION=travel-seed-v2
```

`OPENAI_API_KEY` is optional. Without it, supported planning and communication paths use deterministic fallbacks. Add `OPENAI_MODEL` and `OPENAI_API_KEY` to enable model-assisted intent extraction or conversational copy.

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

## Test the live AI planning flow locally or in Preview

The default `/plan` page now uses live Google Places and Routes, independently of
snapshot market coverage. With the dev server running, open http://localhost:3000/plan.
Vercel Preview and custom staging deployments can use the same flow; the Vercel
Production environment remains disabled. A non-Vercel optimized staging deployment must
set `LIVE_PLANNING_ENABLED=true` explicitly.
Send: “I'm planning a trip to Jaipur with my wife for 3 nights and 4 days, starting from 8th September 2027, travelling from Delhi.” Use a future date when running this smoke test, then confirm the requested year and nights in the next chat turn.
A prompt entered on the homepage is carried into this chat; press Send to planner.
The earlier snapshot workspace is available at `/plan?mode=snapshot`.

Configure these in the Git-ignored `.env.local` (never commit actual keys):

```dotenv
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_browser_key
GOOGLE_MAPS_SERVER_API_KEY=your_server_key
GOOGLE_MAPS_PREFER_IPV4=true
NUITEE_API_KEY=your_sandbox_key
NUITEE_API_BASE_URL=https://api.liteapi.travel
NUITEE_GUEST_NATIONALITY=IN
```

The existing `OPENAI_API_KEY` and `OPENAI_MODEL` are also required. For a Vercel test,
add these credentials to the Preview environment and redeploy; local `.env.local` values
are not uploaded. Restrict the browser key to Maps JavaScript API and the exact localhost
and Preview host patterns you use. Restrict the server key to Places API (New) and Routes
API, and ensure its application restrictions permit requests from the Preview server
runtime. Restart or redeploy after changing environment values. Vercel supplies
`VERCEL_ENV`/`VERCEL_TARGET_ENV`; do not add them manually. Production live requests are
intentionally disabled.
The Google map uses the demonstration map style ID; use your own map ID before launch.

This is a provisional, in-memory live plan. When `NUITEE_API_KEY` is configured, hotel
cards use dated Nuitée room offers with coordinates, photos, sandbox availability,
customer-facing stay totals, normalized per-room/night comparisons, room boards and
cancellation evidence. Sandbox evidence is labelled and never presented as production
inventory. Without the key, hotel locations remain unpriced Google place candidates.
Tickets and full feasibility remain unchecked. The live flow asks for a dining preference
and adds breakfast, lunch and dinner planning blocks. Restaurant identity, location,
ratings, photos and regular-hours evidence come from Google Places; menus, allergens,
dietary handling and meal prices still require confirmation. A bounded set of lunch and
dinner windows prefer restaurants returned along the Google route between their
surrounding itinerary anchors. Remaining or failed searches use an explicit
destination-wide fallback to keep each plan within the live Google call budget.
Regular-hours checks cover the complete
projected meal or activity interval. The planner also retains an optional early-night,
evening, nightlife or overnight-interest preference and can show evening ideas as a chat
refinement; it never inserts nightlife or overnight activities automatically.
Refreshing clears the session. Opening hours are references, visit lengths and buffers
are assumptions, and driving times reflect the time of lookup. No synthetic fallback
or invented totals are used. Google data and links are attributed in the results.

Before searching, the planner asks whether the traveller prefers flying, self-driving or
public transport. Self-driving and flights then ask for a starting area/address or public
meeting point so a broad city is not used as the pickup point. The planner searches only the selected mode and places one suggested
outbound card in Day 1 and one suggested return card in the final day. The suggestion is
the shortest-duration route returned for that preference. Cards reuse the itinerary
travel-card layout and show duration, distance, transit vehicle/line details, scheduled
times and fare only when returned. Driving departure and arrival are labelled estimates.
Travel, the stay and activities sit on one time rail. Day 1 continues from route arrival
after a visible 30-minute arrival/check-in buffer instead of starting again at 10:00;
unknown arrival makes its later times unresolved. As the user scrolls, the adjacent map
switches between the origin-to-stay polyline and local hotel/activity routes.
The current search assumes 08:00 outbound and 17:00 return. These are routing results,
not tickets: Google does not verify seat
availability, exhaustive train/bus inventory or private-cab fares. When Flights access is
enabled for the configured Nuitée key, an explicit flight preference searches separate
one-way sandbox offers for the nearest IATA airports. The itinerary places Google road
transfers before and after each flight and derives Day 1 timing from arrival at the stay.
The schedule-aware suggestion prefers arrival by 13:00 and return departure after 17:00,
then price and duration. Only direct results are included in this pass; sandbox evidence
cannot be booked. Each selected flight exposes its other returned alternatives inline.
Selecting another flight refreshes that direction's airport road transfers. Selecting an
alternative stay refreshes every affected intercity, airport and local activity route.
Stay, outbound-flight and return-flight locks prevent accidental replacement until
explicitly unlocked. These choices remain in this browser session and are not durable
organizer approvals. Uber is not called; Google Routes remains the ground-routing source
while access is pending. TBO remains the
planned next commercial provider integration after account approval.

`node scripts/verify-google-maps.mjs` runs a bounded provider-only smoke test.
`npx tsx scripts/verify-live-travel.ts` checks Delhi–Jaipur road and public-transit
route parsing without logging the API key.
`npx vitest run tests/agent/live-planner.test.ts` checks validation and failure cases
without external API calls. The browser key must also be checked manually by loading
a generated live itinerary; no automated browser test is required.


The live workspace reuses the original stay/activity card frame and design tokens,
with a map beside the itinerary on desktop. Photos, credits, ratings, review counts,
editorial summaries, limited affirmative amenities, official websites and any Google
price guidance appear only when returned by Places. Regenerate a plan after updating
to fetch these fields. Google Places does not expose the hotel supplier offers shown
on the Google Maps consumer website; missing dated room rates remain unchecked.
“Add a planning estimate” lets you enter
an INR allowance per room/night or person/visit; this is not a verified supplier quote.
Photo lookups add requests. Rating/price fields use Enterprise Places SKUs; editorial
summaries and most structured amenities use Enterprise + Atmosphere for enriched
selected places.

The live itinerary renders all days in one scrollable timeline. Sticky date buttons
jump to a day; drive, buffer and visit rows show estimated times and durations.
Structured regular opening periods validate each activity's proposed weekday. A
regularly closed activity moves to the nearest open trip day with capacity or is
omitted; the card shows only that outcome instead of the full weekly hours list.
Unknown hours and future exceptions remain review items.
The adjacent desktop map follows the visible stop using the already loaded routes.
Use **Following timeline · Pause** to explore the map independently. Alternative
stay cards are under **Change stay** below the itinerary.
