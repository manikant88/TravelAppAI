# Google Places fields for itinerary cards

Research date: 2026-09-04  
Scope: Places API (New) web service, using Google documentation only.

## Decision summary

- Continue showing `rating` and `userRatingCount` on hotel and activity cards when Google returns them. These are current Google Maps place-level values, although Google explicitly says reviews are not verified; it detects and removes fake content when identified. Label them “Google rating” rather than “verified reviews.”
- Do **not** label `priceRange` as a dated hotel room quote, “from” room price, or supplier comparison. It is only documented as the price range associated with a place. A Places request has no check-in, number-of-nights, occupancy, room, rate-plan, cancellation, tax, or supplier-offer input.
- Do **not** reproduce the Skyscanner/Agoda/official-site price options visible in consumer Google Maps from Places API. No supplier-offer collection exists in the documented `Place` resource. Dated lodging prices belong to Google's separate Hotel Prices / Hotel Center partner system, which is designed for lodging partners to **send their own inventory and prices to Google**, not for an arbitrary travel-planning app to read Google's consumer comparison results.
- An “About” block can use returned Places content such as `editorialSummary`, `generativeSummary`, `reviewSummary`, selected attributes, parking/payment/accessibility options, and individual reviews. Availability varies by place and region. Render only fields actually returned; absence means unknown.
- Google Places does not expose the full hotel amenity list shown in the consumer UI (for example Wi-Fi, outdoor pool, laundry, room service, fitness centre and airport shuttle) through the documented `Place` resource. Google defines those richer facts in a separate Google Lodging Format used by hotel-content partners. Do not infer or scrape them into the card.

## 1. Price range is not a hotel availability quote

The Places `PriceRange` object contains `startPrice` and an optional `endPrice`, and Google defines it only as “the price range associated with a Place.” `priceLevel` is similarly a broad inexpensive-to-very-expensive category. `priceRange` is an Enterprise field for Place Details, Text Search, and Nearby Search. [Place REST resource: `PriceRange`](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#pricerange) · [Place data fields and SKUs](https://developers.google.com/maps/documentation/places/web-service/data-fields)

This is not enough to present a dated hotel rate. The inference is supported by the API shapes: Places has no lodging-itinerary parameters, while Google’s Hotel Prices documentation defines a hotel price as the lowest double-occupancy price for a particular check-in date and number of nights. That separate product handles room/rate-plan inventory, occupancy, taxes, conditional rates and live pricing. [Hotel Prices pricing model](https://developers.google.com/hotels/hotel-prices/dev-guide/updating-prices) · [Hotel Prices overview](https://developers.google.com/hotels/hotel-prices)

Safe product labels for a returned Places `priceRange` include “Typical place price range” or “Google Maps price range,” depending on card context. For hotels, omit it from the booking-price area unless product research establishes its meaning for that specific place type. Keep “Room price not checked” until a lodging inventory supplier returns a quote for the requested dates and travellers.

## 2. Google Maps hotel comparison offers are not exposed by Places

The complete documented `Place` resource includes `priceLevel` and `priceRange`, but no check-in/check-out quote, room availability, rate plan, cancellation terms, taxes, supplier name, supplier deeplink, or list of offers. `googleMapsLinks` only supplies links for the place, directions, reviews, photos and writing a review. [Place REST resource](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places) · [`GoogleMapsLinks`](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#googlemapslinks)

Google’s Hotel Prices APIs are partner-facing. Price Feeds lets a lodging partner provide its own customized prices to Google, and Travel Partner API manages data belonging to that Hotel Center account. This does not provide a public read API for the multi-vendor offers rendered by Google Maps/Search. [Hotel API authorization and Price Feeds](https://developers.google.com/hotels/hotel-prices/dev-guide/api-auth) · [Travel Partner API](https://developers.google.com/hotels/hotel-prices/api-reference/rest)

Therefore, a supplier-price list requires a separate hotel shopping/affiliate API and its own attribution and booking terms. Do not scrape the Google Maps consumer panel.

## 3. Useful real fields for cards

### Reliable core place facts

- `displayName`, `formattedAddress`, `location`, `primaryType`, `googleMapsUri` / `googleMapsLinks`
- `rating` and `userRatingCount`
- `photos` with `authorAttributions`
- `regularOpeningHours` / `currentOpeningHours` where appropriate
- `priceLevel` and `priceRange`, subject to the price caveat above

`rating`, `userRatingCount`, `priceLevel`, `priceRange`, opening hours and website are Enterprise-tier fields. [Place data field table](https://developers.google.com/maps/documentation/places/web-service/data-fields)

### About and review content

- `editorialSummary`: Google’s textual overview plus language code. The summary must be presented as-is and cannot be modified. It is Enterprise + Atmosphere. [Place REST resource: `editorialSummary`](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#Place.FIELDS.editorial_summary)
- `generativeSummary`: a brief AI-generated place overview with `overview`, `overviewFlagContentUri`, and localized `disclosureText`. It is Enterprise + Atmosphere, available only for supported place types/languages/regions, and not guaranteed for every place. In India, English is supported, but lodging/hotel types are not in the documented supported place-type categories, so do not depend on this field for stay cards. [AI-powered place summaries](https://developers.google.com/maps/documentation/places/web-service/place-summaries)
- `reviewSummary`: an AI-generated summary based solely on reviews, with text, report URL, disclosure text and reviews URL. It is Enterprise + Atmosphere, region/language limited, and not guaranteed. India is supported in English. [AI-powered review summaries](https://developers.google.com/maps/documentation/places/web-service/review-summaries)
- `reviews`: up to five reviews sorted by relevance, with author attribution and source/report links. This is Enterprise + Atmosphere. [Places v1 RPC reference: `reviews`](https://developers.google.com/maps/documentation/places/web-service/reference/rpc/google.maps.places.v1#place)

### Structured attributes

Places can return the following structured facts, where available:

- `accessibilityOptions`: wheelchair-accessible parking, entrance, restroom and seating. This field is **Pro**, not Enterprise + Atmosphere.
- `parkingOptions`: free/paid lot, street or garage parking, plus valet parking.
- `paymentOptions`: credit card, debit card, cash-only and NFC acceptance.
- Boolean attributes including `allowsDogs`, `goodForChildren`, `goodForGroups`, `restroom`, `outdoorSeating`, `reservable`, food/drink services and related venue attributes.

Except for `accessibilityOptions`, those structured amenities/attributes are Enterprise + Atmosphere. They are generic Places facts and are not a full hotel amenity record. [Places API new fields and attributes](https://developers.google.com/maps/documentation/places/web-service/op-overview#new-fields) · [Place REST resource structures](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places) · [Place data field table](https://developers.google.com/maps/documentation/places/web-service/data-fields)

The richer hotel facts visible in Google’s consumer “About” tab exist in the separate Google Lodging Format (services, policies, pools, wellness, transport, connectivity, housekeeping and more). That is a content submission schema for lodging partners, not a Places response field. [Google Lodging Format](https://developers.google.com/hotels/hotel-content/proto-reference/lodging-proto)

## 4. Field masks, cost and display requirements

Every Place Details, Text Search and Nearby Search request must include a field mask. Billing uses the highest-priced requested field: mixing Essentials/Pro with Enterprise or Enterprise + Atmosphere bills the entire successful request at that highest tier. Avoid `*` in production and request expensive content only for shortlisted/displayed places. [Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing#field-masks) · [Google Maps Platform SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details)

A practical staged request strategy is:

1. Search with only the fields needed to rank candidates.
2. Fetch Place Details for the small set of cards actually displayed.
3. Request `editorialSummary`, `generativeSummary`, `reviewSummary`, `reviews`, parking/payment options and other Atmosphere fields only when that content is visible or the user expands “About.”

Display requirements that affect the UI:

- Clearly attribute Google Maps content and keep the attribution visible in the same visual container; visually distinguish it from non-Google content.
- Credit photo and review authors. Every photo/review must provide access to its individual source on Google Maps. A thumbnail may omit photo-author text only when the user can open a larger version that shows full attribution.
- When showing reviews, describe the ordering/filtering; default order is relevance. Google recommends showing relative publication time and explaining its review policy.
- Show `editorialSummary` unchanged.
- Show the full AI summary, then place the exact localized `disclosureText` immediately below it without modification. Provide the required “About this summary” and report links. A review summary must be headed **Review summary** and also link to `reviewSummary.reviewsUri`.

See [Places API policies and attributions](https://developers.google.com/maps/documentation/places/web-service/policies).

## Recommended implementation boundary

Use Places now for verified location identity, photos, address, rating/count, opening information, Google summaries and the structured facts it actually returns. Label those sections “Google Maps” and preserve attribution metadata in the stored live plan. Keep booking price/availability explicitly unchecked. Add real dated hotel pricing later through a lodging shopping supplier; store each quote with its dates, occupancy, room/rate-plan, taxes/fees, cancellation terms, currency, provider and checked-at time.
