# Nuitée flight journey

Status: accepted

## Goal

Add a testable flight option to the live planner using the configured Nuitée Flights
sandbox. A flight journey is door-to-door: pickup to departure airport, the supplier
flight, arrival airport to the selected stay, and the inverse journey home.

## Product boundary

Nuitée owns dated flight schedules, fare, capacity and fare conditions. Google Places
and Routes own airport place resolution and road-transfer evidence. Sandbox offers are
clearly labelled and cannot be treated as bookings. The planner does not allocate a
round-trip bundle price between directions; this pass searches each direction as a
separate one-way offer.

## Accepted behavior

- Intake accepts `flight` and asks for a starting area or public meeting point.
- City names resolve to nearby IATA airports from Nuitée's airport catalogue.
- The adapter maps only validated, direct flight results into canonical
  `TransportOffer` values; unsupported connecting itineraries remain excluded until
  their intermediate airport time zones can be resolved correctly.
- The suggested outbound first prefers arrival by 13:00 and the suggested return first
  prefers departure at or after 17:00; within that usable window, price and then duration
  decide. If the sandbox has no result in the window, the lowest-priced direct result is
  retained and the timing remains visible for review.
- Day 1 contains first-mile road transfer, outbound flight, last-mile road transfer,
  stay arrival and the local itinerary on one time rail.
- The final day contains the inverse transfer/flight chain.
- Day 1 activities begin after the last-mile arrival and a labelled check-in buffer.
- Google Maps shows the focused transfer route and a direct airport-to-airport flight
  line while the corresponding timeline row is active.
- Any missing supplier or transfer result remains explicit and never becomes zero.

## Deferred

- Production access and booking/prebook/order operations.
- Round-trip bundled offers and price allocation.
- Connecting flights and direct flights across different time zones, until offsets can be
  resolved for the travel date rather than inferred from the lookup date.
- User selection among alternative offers, locks and change actions.
- Baggage upsells, children/infants and traveller-specific passenger records.
