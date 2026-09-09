# Capacity-aware live itinerary scheduling

## Accepted behavior

The live planner deterministically schedules enough activities to make useful use of each
day without treating every free minute as a gap to fill. The model ranks observed places
and suggests durations; application code owns daily capacity, ordering, routes, meal
placement, opening-hours validation and constraint findings.

Balanced full days target two or three activities when enough valid candidates exist.
Arrival and departure days use their actual known bounds. Relaxed and packed preferences
change the target without inferring pace from traveller demographics.

Meals use preferred and extended windows. The planner may shift a meal within its
extended window when a substantial activity occupies the preferred period. Activities
retain duration profiles that distinguish fixed/provider time from elastic,
pace-sensitive and open-ended planning estimates. Group adjustments apply only to
sensitive estimates.

Every proposed schedule or selection is assessed as valid, warning, blocking or
unresolved. Locked and fixed items are preserved. Unknown provider evidence remains
provisional rather than becoming a zero-duration connection or a confirmed fact.

## Deferred scope

User-authored links/manual items, cross-midnight occupancy, overnight intercity journeys,
overnight self-drive policy and supplier-backed ticket booking remain in the existing
future-scope tickets.
