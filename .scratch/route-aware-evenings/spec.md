# Route-aware meals and evening discovery

## Accepted behavior

The live planner uses the route between the itinerary anchors surrounding lunch and
dinner to search for restaurants that require a smaller detour. The route-corridor
result is ranked by Google, then checked against the complete planned meal interval.
These searches are capped at four meal windows, or fewer for shorter trips, to keep the
whole plan inside the live Google call budget. Unsearched, failed, or unavailable
corridor slots use the existing destination-wide restaurant set as an explicitly
labelled fallback.

The trip brief may retain a traveller-stated day rhythm: early nights, evening
experiences, nightlife, overnight adventure, or flexible. This preference is optional
and never blocks initial planning. If it is absent, the planner may discover suitable
evening ideas and invite the traveller to opt in, but it must not insert bars, clubs,
casinos, or overnight activities without an expressed preference.

Regular opening hours are planning evidence. Validation covers the complete scheduled
interval and distinguishes valid, invalid, and unresolved evidence. It does not prove
holiday exceptions, last admission, tickets, dated events, or provider availability.

## Provider boundary

Google Places supplies place identity, regular hours, ratings, and route-biased search
results. Google Routes supplies the corridor polyline, duration, and distance. The live
planner retains the direct route and selected detour evidence without treating either as
a commercial offer.

## Deferred scope

Complete night occupancy, provider-verified overnight activities, user-added items, and
complete lock-aware recalculation are recorded in
`issues/05-future-cross-midnight-and-user-options.md`. Safe multi-day road segmentation
and independent later journey modes moved to `.scratch/multi-leg-road-journeys/`.
