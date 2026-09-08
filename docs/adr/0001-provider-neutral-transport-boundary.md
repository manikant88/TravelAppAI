---
status: accepted
---

# Keep supplier schemas outside trip state

Transport providers expose incompatible inventory, pricing, timing and booking schemas. Provider adapters therefore validate and translate responses into versioned canonical transport offers before planning or editable trip state can reference them; non-inventory route observations remain route evidence. This preserves provider provenance and provider-specific raw evidence without coupling itinerary editing, validation, voting, maps or budgets to Google Routes, TBO or another supplier.

Water travel uses explicit `ferry`, `ship` and `cruise` modes. A casino or sightseeing cruise that returns to its starting area is normally an activity, while its connecting ferry is a transfer; a point-to-point cruise may be a transport offer.
