# Travel App AI

Travel App AI turns a natural-language trip request into a provisional, evidence-backed
itinerary. The traveller can complete missing essentials, review why options were
chosen, and change travel, stays, activities, and meals in one workspace.

The current application is the live planner at `/plan`. It is session-only and intended
for local development and Vercel Preview deployments.

## Current boundaries

- The plan is held in browser memory and is cleared by refresh. Authentication, durable
  trips, booking, and payment are not implemented.
- Google Places and Routes provide place and route evidence. Routes do not prove ticket,
  seat, private-cab availability, or fare.
- Nuitée Connect can provide dated sandbox stay offers and direct sandbox flight offers
  when the configured account has access. Sandbox offers cannot be booked.
- Code owns dates, arithmetic, feasibility, route continuity, locks, selection
  validation, and state changes. Model output interprets intent and ranks observed IDs.
- Vercel Production blocks live planning. Vercel Preview and explicitly enabled
  non-Vercel staging are test surfaces.

## Stack

- Next.js App Router 16, React 19, and strict TypeScript
- Zod schemas at API, provider, and model boundaries
- Google Places and Routes for live place and route evidence
- Nuitée Connect adapters for sandbox stays and direct flights
- OpenAI Responses API with deterministic intake fallbacks
- Vitest for unit, contract, and component tests

Node.js 22.13 or newer is required.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Configure the providers you want to exercise in the Git-ignored `.env.local`:

```dotenv
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5-mini
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_browser_key
GOOGLE_MAPS_SERVER_API_KEY=your_server_key
GOOGLE_MAPS_PREFER_IPV4=true
NUITEE_API_KEY=your_sandbox_key
NUITEE_API_BASE_URL=https://api.liteapi.travel
NUITEE_GUEST_NATIONALITY=IN
```

The OpenAI key enables model-assisted extraction and selection. Deterministic intake
fallbacks preserve explicit facts when the model call fails. The Google browser key
renders the map; the server key powers Places and Routes. The Nuitée key is optional.

For Vercel Preview, open **Project → Settings → Environment Variables**, add each key to
the **Preview** environment, and redeploy. Do not create `VERCEL_ENV` or
`VERCEL_TARGET_ENV` manually. An optimized non-Vercel staging build must set
`LIVE_PLANNING_ENABLED=true`.

Restrict the browser key to Maps JavaScript API and the localhost or Preview hosts in
use. Restrict the server key to Places API (New) and Routes API. Never commit secrets.

## Planning behavior

The planner supports a specified destination, 2–14 calendar days, and 1–12 travellers.
An explicit start and end date determine both calendar days and hotel nights. Before a
search begins, the brief requires:

- origin and destination;
- start and end dates, or a start date and confirmed duration;
- traveller count;
- outward travel mode;
- a pickup point for flight, cab, or self-drive;
- what happens after the destination; and
- a separate later travel mode when the trip returns or continues elsewhere.

Trip Essentials displays only missing facts. Choices are staged and submitted together.
Once the complete brief validates, planning starts automatically. A failed or infeasible
plan stays on Trip Essentials and offers changes that directly address the failure.

Long cab and self-drive routes are divided into daily driving segments with road breaks,
meal time, and overnight rest. Travel-only days do not receive destination activities.
A journey that consumes the full trip is rejected. A journey that dominates it requires
an explicit road-trip confirmation.

The itinerary is one continuous timeline. Travel, transfers, transit stays, destination
stays, activities, meals, buffers, and local routes occupy their actual dates. The map
follows the selected day and can be hidden to center the timeline. Locks protect
individual selections, and edits validate observed option IDs before applying changes.

Restaurant identity, location, ratings, and regular hours may come from Google. Menus,
allergens, kitchen separation, dietary handling, and missing prices remain unresolved.
Regular hours are evidence, not a guarantee for a future date.

## Runtime limits

Each planning turn has a two-minute overall deadline, at most two model calls, and at
most 60 Google requests per provider instance. The server accepts at most two concurrent
planning turns and does not automatically retry providers.

Progress copy describes the travel-planning activity instead of internal provider names.
Provider failures keep the previous validated plan unchanged and return partial evidence
only where it is safe to do so.

## Commands

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Do not run automated browser tests unless the user explicitly asks. Manual browser
checks remain useful for map keys, responsive layout, the loading animation, and live
provider credentials.

Provider checks:

```bash
node scripts/verify-google-maps.mjs
npx tsx scripts/verify-live-travel.ts
```

## Project map

```text
src/agent/       Shared OpenAI runtime configuration
src/app/         App Router pages and the conversation API
src/domain/      Date helpers and small shared domain primitives
src/inventory/   Live stay/transport contracts and stay provider adapter
src/live/        Intake, orchestration, road journeys, scheduling, and selection
src/transport/   Transport provider interface and flight adapter
src/ui/          Live workspace, timeline cards, map, and loading states
tests/           Live planning, provider, contract, and UI tests
.scratch/        Accepted feature specs and actionable local tickets
```

Read `AI_HANDOFF.md` for the concise implementation map. `PROJECT_CONTEXT.md` owns
product decisions, `IMPLEMENTATION_SPEC.md` owns technical contracts, and `CONTEXT.md`
owns the domain glossary.

## Manual smoke scenarios

1. Plan Delhi to Udaipur for two adults from 10 October 2026 to 18 October 2026,
   returning to Delhi by flight. Confirm a complete brief plans automatically.
2. Plan Delhi to Darjeeling by cab for four days. Confirm recovery offers faster modes
   and a computed minimum end date.
3. Extend that trip enough for a road journey. Confirm travel days show driving, breaks,
   meals, and transit stays before destination activities begin.
4. Change only the end date. Confirm chat records the changed dates rather than sending
   the complete brief again.
5. Change a meal and a stay. Confirm locks, route refresh, and schedule impact remain
   scoped to the affected selections.
