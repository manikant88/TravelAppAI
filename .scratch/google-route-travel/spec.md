# Google route travel comparison

Status: accepted

## Goal

Add real outbound and return travel evidence to the first live planning flow while TBO
onboarding is pending. Use Google Places to resolve the stated city-level origin and
Google Routes for traffic-aware road and available public-transit alternatives.

## Product boundary

Google results are route evidence. They may provide paths, duration, distance, transit
vehicle types, lines, scheduled stop times and an optional fare. They do not prove seats,
ticket availability, exhaustive bus/train coverage, a private-cab quote, or flight options.
Missing fields remain missing. No snapshot or invented transport option may fill a gap.

TBO is the next commercial provider candidate after onboarding and approval. Its future
adapter will own dated supplier offers, price/expiry, availability and booking/handoff
terms. It must remain separate from Google route observations.

## Accepted behavior

- Ask the traveller to choose self-driving or public transport before provider searches.
- For self-driving, ask for an explicit starting area/address before provider searches.
- Resolve the applicable starting point to one Google place.
- Search outbound routes on the trip start date at an explicit 08:00 assumption.
- Search return routes on the final trip date at an explicit 17:00 assumption.
- Request only the preferred mode and keep a successful direction if the other fails.
- Show no more than three unique results per mode and direction.
- Select the shortest-duration returned route as a provisional suggestion.
- Render only that suggestion in the Day 1/final-day timeline using the travel-card UI.
- Put outbound travel, stay arrival, local visits and return travel on one time rail.
- Continue Day 1 from route arrival plus a labelled 30-minute arrival/check-in buffer.
- Propagate an unknown arrival through all later Day 1 times.
- Show the focused intercity route and origin/stay markers in the adjacent map while its
  timeline row is active; restore the local day route for stay/activity rows.
- Render observed schedule, vehicle, line and fare fields only when Google returns them.
- Keep Day 1 timing provisional until the user selects and confirms a real travel service.
- Keep all results in the current in-memory live-plan boundary.

## Deferred

- Flight search and booking.
- Train/bus ticket and seat inventory.
- Cab quotes and booking.
- User confirmation applied to itinerary timing.
- Multiple traveller origins and securely persisted private pickup addresses.
- TBO credentials, offer lifecycle, commercial terms and booking operations.
