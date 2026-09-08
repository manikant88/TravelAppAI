# Stay22 and StayingAPI review

Researched 4 September 2026. These are distinct providers; `stayapi.com` is a third, different service and is not the provider of the supplied GitHub repository. Public documentation only; no signup, authenticated calls, outreach or purchases.

## Assessment

**Stay22 is currently a possible affiliate-handoff layer, not a newly accessible inventory API. StayingAPI is an accessible-looking accommodation data experiment, but not verified licensed supplier inventory or a production recommendation yet.** Neither resolves India coverage, exact group-room pricing and source-content rights without further evidence.

## Stay22

The current official Direct Travel API page says early access ended, new signups are paused, and previous reference documentation is down while the next version is developed. Older articles describing a freely accessible inventory API should not drive our implementation. [Current API status](https://dev.stay22.com/docs/api)

Allez remains a free affiliate redirect endpoint. It constructs supplier landing links with affiliate tracking, including Booking.com, Expedia, Agoda and others. Its Roam routing explicitly optimizes for conversion; that is not evidence of the cheapest or best-fit option for our travellers. Keep any future link monetization separate from itinerary ranking, and validate destination, dates, occupancy and exact-property preservation. It does not return hotel search data into our planning domain. [Allez documentation](https://dev.stay22.com/docs/allez)

Stay22 Maps is an iframe displaying nearby stays with affiliate click-through. It is a useful separate browsing widget, but the documented embed does not establish data-access rights or a way to import verified offers into our saved-trip budget. It also does not replace our itinerary/transfer map. [Maps documentation](https://dev.stay22.com/docs/maps)

The affiliate terms grant rights for specified products/platforms and monetization/engagement use, with separate third-party terms where applicable. They do not by themselves establish unrestricted raw inventory redistribution or AI processing. Commission details are governed by the applicable order form. Our proposed saved-plan use and any direct-data entitlement remain to be confirmed. [Affiliate terms](https://www.stay22.com/terms)

**Recommendation:** Keep on the handoff shortlist, conditional on partner acceptance and appropriate product terms. Do not schedule a direct inventory integration until applications reopen and actual access is granted. No authenticated India availability was checked.

## StayingAPI / stayingapi/travel-api

The supplied repository is a resource hub of endpoint references, examples and workflows, not the hosted API implementation or maintained SDK. It describes REST/MCP access across Airbnb, Booking.com, Vrbo and Google Hotels; sandbox keys serve deterministic fixtures. The repository is not evidence that the underlying accommodation catalog is open source or licensed to our product. [Repository](https://github.com/stayingapi/travel-api)

Its terms explicitly describe data derived from publicly reachable, non-authenticated pages, a resale/normalization service unaffiliated with those source platforms. They put responsibility for redisplay, attribution, source-platform terms and third-party rights on the customer. This is a material provenance distinction from a contracted demand-side feed; do not describe the result as approved Booking.com or Airbnb API inventory. Source links and image URLs are supplied, but they do not establish unrestricted rights. [Terms, effective 2 July 2026](https://stayingapi.com/terms)

### Cost and documentation discrepancies

The homepage advertises 300 one-time free credits valid 90 days; Starter $19/month for 1,900 credits; Pro $99/month for 9,900 credits; Scale $499/month for 49,900 credits. It also mixes a 22-credit price-comparison example with a 30-credit summary. These are advertised USD prices, not verified charges or INR estimates. [Homepage pricing](https://stayingapi.com/)

The signup page instead says **100 free credits**. Treat the live free allocation as unresolved until the provider reconciles it; do not promise 300. The standalone `/pricing` page could not be retrieved by the browser tool. [Signup page](https://stayingapi.com/signup)

Search is billed per returned result: Airbnb 2 credits, other platforms 1, minimum 5 per platform. Default fan-out queries all enabled platforms; `limit` is per platform. An illustrative four-platform search yielding 10 results each therefore costs 50 credits (20 + 10 + 10 + 10), before details or refreshes. Starter would support 38 such full searches if nothing else consumed credits. This is arithmetic from published tariffs, not measured capacity. [Search billing](https://stayingapi.com/docs/endpoints/search)

### Accuracy and experience implications

- Search prices are best-effort and can be absent even when the successful search leg is billed. The documented search cache lasts 30 minutes. Live cache misses are asynchronous scraping jobs that may take tens of seconds or several minutes, including 240+ seconds. This needs a deliberate background/retry experience and cannot be assumed to satisfy interactive latency goals. [Search behavior](https://stayingapi.com/docs/endpoints/search)
- Listing detail has a 24-hour cache; embedded price has a one-hour cache. Thus API retrieval time is not necessarily source-observation time. Existing last-checked semantics must distinguish the two. [Listing docs](https://stayingapi.com/docs/endpoints/listing)
- Price comparison documents 30 credits in Google mode or summed direct legs. Google mode can return just one offer; do not present that as a multi-provider comparison. Direct mode requires known IDs for the same property. Fee detail varies by platform and currency mismatches are excluded from summary calculations. Equivalent room, cancellation and meal terms still require validation before claiming savings. [Price comparison docs](https://stayingapi.com/docs/endpoints/price-compare)
- Search supports dates, adults, children, child ages and rooms, but public schema support is not evidence of correct room allocation, full taxes or exact handoff behavior in Jaipur, Goa or Kochi. No Indian sample was authenticated or checked against supplier checkout.

**Recommendation:** Allow a limited technical evaluation only after clarifying downstream commercial display, retention and AI-use rights. Keep production selection open. Confirm actual free credits, metering and end-to-end latency; compare a small Indian sample including two rooms, child ages, taxes and cancellation terms. Use source-observed freshness and partial-result flags, never fill missing prices from the model. A canonical listing URL is not an affiliate agreement, guaranteed dated offer or booking confirmation.

No evidence here warrants changing the INR 15,000 target yet. Starter's sticker price alone does not prove sufficient pilot capacity; Pro would be a material budget allocation requiring measured benefit and review.
