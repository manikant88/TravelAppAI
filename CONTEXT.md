# Travel planning

Shared language for planning and agreeing on a journey before booking.

## Language

**Traveller**: A person participating in a trip, potentially departing from a different origin than other participants.
_Avoid_: Using account or user as a synonym when discussing trip participation.

**Trip**: The overall journey shared by its travellers, including their dates, constraints, preferences, and itinerary.

**Trip budget**: An optional total spending ceiling for the current trip. Planning uses
comparable observed prices to fit selections within it and keeps unknown costs explicit.
It is not a payment authorization, guaranteed final total, or permission to invent a
price.

**Journey leg**: One intercity movement with its own origin, destination, date, mode, timing evidence, and feasibility result. The outward leg and the journey after a destination are independent.
_Avoid_: Assuming the return destination or copying the outward mode onto a later leg.

**Trip end intent**: The resolved choice to return to the origin, end at the current destination, or continue to another destination. It defaults to return to origin when the traveller says nothing, while an explicit end or onward request overrides that default.

**Transit stay**: An overnight rest stop used while completing a multi-day journey leg. It is distinct from the main destination stay and needs its own dated availability evidence before booking.

**Itinerary**: The day-by-day sequence of travel, transfers, stays, meals, and activities within a trip.
_Avoid_: Booking confirmation.

**Meal stop**: A breakfast, lunch, or dinner block in the itinerary with a place, planning time, duration, and the transfer needed to reach it. A restaurant match does not itself verify its menu or dietary handling.

**Dining preference**: A traveller's stated preference for vegetarian food, pure-vegetarian restaurants only, non-vegetarian food, or both. Allergies, intolerances, and religious restrictions are separate constraints; cuisines or foods to try are dining interests.
_Avoid_: Treating vegetarian preference as proof that kitchen separation is required.

**Transfer**: Movement connecting itinerary steps, such as home to airport or hotel to activity.

**Transport offer**: A supplier-backed option for moving travellers between places, with provider identity, availability, price, timing, and booking evidence. It remains distinct from the itinerary item created when travellers select it.
_Avoid_: Route estimate, booking confirmation.

**Option candidate**: A discovered, linked, or manually entered possibility that may still lack information required for itinerary selection. A candidate becomes selectable only after the facts required for the proposed use have been validated.
_Avoid_: Supplier offer, itinerary selection, booking confirmation.

**Supplier offer**: A normalized, provider-backed option with explicit supplier identity, environment, availability, price, freshness, and booking semantics. Sandbox offers remain supplier-shaped test evidence and are never presented as live inventory.

**Option provenance**: The recorded origin of an option's facts: supplier, route evidence, place evidence, user-provided link, or manual entry. Provenance is preserved when the option is selected or locked.

**Option verification**: The independently recorded confidence in an option's identity, location, schedule, price, availability, and requirements. Verification in one dimension does not imply verification in another.

**Route evidence**: A provider observation about a possible path, distance, duration, or public-transit schedule without evidence of purchasable inventory.
_Avoid_: Transport offer, confirmed ticket.

**Travel mode**: The physical mode used by a transport journey or segment: flight, train, bus, cab, self-drive, ferry, ship, or cruise. A mode does not by itself imply that inventory, availability, or booking exists.

**Travel recommendation**: The planner's selected journey option when the traveller has
not constrained the mode. Without a trip budget it prioritizes usable time; with a trip
budget it uses comparable known costs. It remains editable and does not replace provider
evidence.

**Water travel mode**: A ferry is primarily a local or point-to-point connection; a ship is scheduled water transport not more specifically classified; a cruise is a journey sold as a cruise. A sightseeing or casino cruise that returns to its starting area is an activity, with any ferry used to reach it represented as a separate transfer.

**Custom activity**: An activity supplied by a traveller when the desired option is absent from the available catalog. Its details are user-provided rather than automatically supplier-verified.

**Booking handoff**: Directing a traveller to an external supplier to complete a booking themselves.
_Avoid_: Confirmed booking.

**Finalized plan**: An itinerary accepted for use in arranging the trip; acceptance does not establish that its items have been booked.
_Avoid_: Booked trip.

**Organizer**: The person responsible for choosing shared itinerary selections and finalizing the trip after traveller approval.
_Avoid_: Treating every traveller as having finalization authority.

**Option vote**: A traveller's preference concerning a proposed itinerary option or constraint change. It is distinct from approval of the whole trip.

**Trip approval**: Acceptance of a specific version of the whole trip by a traveller or their explicitly assigned representative. Material changes require renewed approval.
_Avoid_: Option vote, booking confirmation.

**Shared cost**: A cost attributable to a specified group of travellers, such as a room or a shared transfer. Its participants need not include the whole trip group.

**Timing estimate**: An expected duration or time used for planning whose actual value may vary.
_Avoid_: Confirmed schedule.

**Feasibility review**: Resolution of missing or conflicting information needed to assess whether itinerary steps and their connecting transfers can work together.

**Representative**: An adult explicitly assigned to make trip approvals for a dependant or another represented traveller. The responsibility is visible to the group.

**Anonymous contribution**: A vote or suggestion whose author is hidden from other travellers and the organizer. A later visibility change does not reveal its author.

**Cost allocation**: The planned share of a cost assigned to each participating traveller, using equal division or explicit amounts or percentages.
_Avoid_: Payment record, expense settlement.

**Departure point**: The agreed location where a traveller's planned journey begins, such as a transport hub, public meeting point, or authorized pickup address.
_Avoid_: Assuming every departure point is a home address.

**Rendezvous**: An agreed time and place where travellers arriving separately meet to begin the shared part of their itinerary.

**Activity participants**: The travellers taking part in a particular activity, which may be a subset of the trip's travellers.

**Date scenario**: A candidate set of trip dates with its associated travel, stays, activities, transfers and cost implications. Comparing scenarios does not itself change the shared itinerary.

**Travel window**: The permitted period within which candidate trip dates may be explored, subject to traveller availability and trip duration.

**Provisional seasonal guidance**: A suggested future date range based on general destination knowledge when the traveller has not supplied exact dates. It remains outside the Trip Brief until selected and is not evidence of current weather, prices, availability, events, opening, or access.
_Avoid_: Forecast, observed availability, confirmed best time.

**Observed evidence**: A time-stamped fact returned by a configured provider for the place, route, dates, and travellers being evaluated. Its scope remains limited to the fields and validity period the provider actually returned.
_Avoid_: Extending one observation into unrelated claims, such as treating a route estimate as cab availability.
