# Live option selection and locks

Status: accepted

## Goal

Let the organizer compare and select the already-returned stay and direct-flight
alternatives inside the live itinerary. A selection is safe only when deterministic
server code validates the candidate and refreshes every affected Google route and
timeline dependency.

## Accepted behavior

- Alternative outbound and return flights remain attached to their selected timeline
  card; stay, flight, route and activity alternatives appear in the shared right-side
  drawer using the same card modules as the timeline.
- The server accepts only IDs present in the current validated result bundle.
- Unavailable or expired supplier offers cannot be selected.
- Changing a flight refreshes that direction's first- and last-mile Google road routes.
- Changing a stay refreshes intercity endpoints where applicable, airport/stay routes,
  and every local hotel/activity connection.
- Stay, outbound-flight and return-flight locks independently prevent replacement until
  explicitly unlocked.
- Selections, locks and refreshed results remain local to the current browser session.
- Google Routes remains the ground-routing source. Uber is deferred pending access.

## Deferred

- Durable trips, authentication, organizer authority and cross-device persistence.
- Manual/link options and extraction.
- Activity replacement and custom activities.
- Supplier refresh/repricing, prebook, booking and payment.
- Selecting alternate Google intercity route evidence.
