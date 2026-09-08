# Future: cross-midnight journeys and user-added options

Status: draft

Blocked by: 01-route-corridor-meals.md, 02-day-rhythm.md, 03-time-window-validation.md, 04-evening-discovery.md

## Intended behavior

Future versions will model night occupancy, cross-midnight transport and activities,
hotel-night removal, overnight self-drive safeguards, provider-verified overnight
inventory, user-added links/manual items, and lock-aware downstream recalculation.

## Future-version work

- **5E — Night occupancy:** represent each night as stay, transport, self-drive,
  overnight activity, or explicitly unresolved.
- **5F — Overnight intercity travel:** carry departure and arrival across calendar days
  while preserving the first- and last-mile legs.
- **5G — Overnight self-drive:** add fatigue, rest-stop, driver and safety constraints
  before recommending a cross-midnight drive.
- **5H — Provider-verified night activities:** require dated operating, pickup, ticket
  and availability evidence for camps, treks, safaris, cruises and similar experiences.
- **5I — User-added options:** ingest links or manual stay, travel and activity details
  with explicit provenance and a conflict preview.
- **5J — Lock-aware recalculation:** preserve locked choices while recomputing affected
  transfers, times, hotel nights and downstream days.

## Acceptance criteria

- A night is occupied by a stay, transport, self-drive, overnight activity, or an
  explicit unresolved state.
- Departure and arrival transfers remain separate evidence-bearing legs.
- Hotel checkout/check-in and charged nights change consistently with overnight travel.
- User-added items retain provenance and are previewed for conflicts before applying.
- Locked selections are never silently replaced.

## Validation approach

Define separate accepted specs and executable tickets before implementation.
