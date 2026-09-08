# Maps, places, and local routing feasibility

Research date: 4 September 2026. Public-documentation assessment, not an authenticated coverage test or final vendor selection.

## Recommendation

Evaluate Google Maps JavaScript + Places (New) + Routes first as one coherent mapping stack. Mappls is the India-focused comparison candidate if Google coverage or commercial constraints fail the pilot tests. Mapbox is a viable map/routing alternative, but would require its own POI, persistence, and coverage assessment; do not combine Google content with a different map without checking the applicable permissions.

## Verified facts and implications

- Google supports public-transit routing, with no intermediate transit waypoints. Requests can look up to 100 days forward; future schedules may change. Transit fares are returned only if known for all steps. This supplies route guidance, not reserved-seat inventory. It cannot establish Indian Railways booking availability or a complete bus ticket price. [Transit documentation](https://developers.google.com/maps/documentation/routes/transit-route)
- Routes traffic options offer different accuracy/latency trade-offs. Test the selected mode and timing against actual pickup/arrival scenarios; a route duration does not include airport check-in, group boarding, rest breaks, or activity duration. Those buffers are application planning policy. [Traffic options](https://developers.google.com/maps/documentation/routes/traffic-opt)
- Places data fields include location, business status and opening hours; requested fields determine the billing SKU. Current opening hours trigger Enterprise-tier Place Details. This is not a reason to omit essential hours; retrieve richer detail for shortlisted places and measure usage. Opening hours do not prove ticket availability or an appropriate visit duration. [Field table](https://developers.google.com/maps/documentation/places/web-service/data-fields)
- Google Places and Routes impose storage and attribution restrictions. Place IDs may be retained; map-displayed results must follow Google map requirements. Saved itineraries need a deliberate distinction between app-owned selections and licensed provider content, including expiry and refresh rules. Do not assume entire provider responses or derived route facts may be stored indefinitely. [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [Routes policies](https://developers.google.com/maps/documentation/routes/policies)
- Mappls advertises maps, geocoding/search and routing APIs and a free-start path. A verified pilot production quote, permitted persistent storage and exact endpoint quotas remain to be obtained. Treat its coverage marketing as vendor claims, not evidence that our selected journey works. [Mappls APIs](https://about.mappls.com/api/)
- Mapbox pricing distinguishes temporary and permanent geocoding. Persistence is a product selection issue, not merely a cache optimization. No practical India comparison was performed. [Mapbox pricing](https://www.mapbox.com/pricing)

## Pricing and request assumptions

For eligible India billing/usage, Google's published monthly free caps include 70,000 Dynamic Maps events and 70,000 Compute Routes Essentials events. Subsequent listed rates are USD 2.10 and USD 1.50 per 1,000 respectively. Places fields and traffic-aware route SKUs can price differently. [India price list](https://developers.google.com/maps/billing-and-pricing/pricing-india), [eligibility](https://developers.google.com/maps/billing-and-pricing/india)

Illustrative sizing only: 100 groups × 5 draft iterations × 30 adjacent connections = 15,000 route calculations before retries/alternatives/refreshes. A 30-by-30 matrix instead produces 900 elements per evaluation, so repeated whole-matrix optimization can dominate the bill. Instrument actual billed events and restrict recomputation to affected connections where valid. [Matrix documentation](https://developers.google.com/maps/documentation/routes/compute_route_matrix)

Keep the INR 2,000 maps allowance provisional until realistic calls are measured. Free allowances are not evidence that all maps/places usage is free.

## Required authenticated checks

Use Jaipur, a bounded Goa area, and Kochi as proposed coverage probes, not approved launch markets. Test airport/station-to-stay, stay-to-activity, activity-to-meal and return transfers. Include same-name places, distinct Goa airports, unknown hours, closure, distant custom activity, separate arrival groups and incomplete transit results. Verify coordinates, mode, duration, opening information, attribution, request cost and missing-data behavior. Compare sampled results to first-party venue/transport information and manual route review.

No credentials used, billable queries run, accounts created, or browser automation performed.
