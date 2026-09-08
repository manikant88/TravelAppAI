---
status: accepted
---

# Separate candidates, offers, selections, and bookings

Travel sources provide facts with materially different authority. Google can identify a
place or describe a route without proving purchasable inventory; a user can provide a link
without proving its price is current; and a sandbox supplier can exercise an offer workflow
without providing live availability. Treating all of these as offers would allow partial
evidence to acquire stronger meaning merely by entering the itinerary.

The application therefore keeps four concepts distinct:

- an **option candidate** is incomplete evidence that may be displayed while its required
  identity, location, schedule, price, availability, or requirements remain unresolved;
- a **supplier offer** is a normalized provider response with explicit environment,
  availability, freshness, price, and booking semantics;
- a **selection** is the itinerary's reference to an accepted option and may be locked
  against replanning;
- a **booking** is a separately confirmed commercial outcome and is never implied by
  selection, locking, plan approval, or an external handoff.

Evidence readiness is evaluated for the intended action. An itinerary proposal requires
usable identity, location, and schedule evidence. Plan finalization additionally requires
price and activity/property requirements to be resolved sufficiently for feasibility and
budget review. A booking handoff additionally requires availability evidence. Estimated
schedule and price facts remain explicitly estimated.

Provider-specific payloads stay behind adapters. Canonical supplier offers may identify
their environment as live, sandbox, or snapshot; only live offers may be presented as live
inventory. Place evidence, route evidence, user links, and manual entry use their own
provenance kinds and do not become supplier offers.
