# Stay and activity provider feasibility

Researched 4 September 2026 against public first-party sources. Planning assumptions: India domestic pilot, 50–100 groups/month, INR 15,000 monthly operating target, external booking handoffs. No accounts created, contracts accepted, paid services purchased, or authenticated API requests performed. Recommendations below are proposals, not accepted implementation contracts.

## Recommendation

Prioritize **Viator Basic for an activity integration experiment**, with Full access required before promising real-time availability checks. For accommodation, **investigate Agoda's Online Affiliates/MSE model first and Booking.com Demand as an alternative**. Both need access validation before implementation commitment. Expedia Travel Redirect is conceptually well matched but currently closed to new API applications; GetYourGuide's published API thresholds are far beyond this pilot. Rapid is a future booking-platform option, not the initial handoff choice.

The principal uncertainty is access and permitted usage, rather than a published per-call price. Do not treat affiliate enrollment as permission to ingest arbitrary inventory, and do not treat public website coverage as our API entitlement.

## Providers

| Provider | What the official sources establish | Pilot implication |
| --- | --- | --- |
| Booking.com Demand | Requires Managed Affiliate Partner status, signed contract, account-manager-provided Partner Centre access, token and affiliate ID. Supports search/look/redirect. | Strong functional fit if accepted; access time, commercial terms and minimum performance requirements remain unverified. |
| Agoda Demand | Online Affiliates/MSE uses Search API for rate/availability display. Partnership credentials and certification precede live use. | Most relevant alternative hotel application to investigate. Free affiliate signup does not establish free Demand API access or acceptance. |
| Expedia Travel Redirect | Designed for inventory search followed by Expedia/Hotels.com/Vrbo checkout. Getting-started page says new API applications are paused. | Do not put this on the pilot's critical path. |
| Expedia Rapid | Requires partnership, approved integration, launch requirements and site review; development keys remain restricted until production approval. | End-to-end booking integration is unnecessary for our agreed boundary. Commercial price is not verified. |
| Viator Affiliate | Basic is self-service; Full requires approval/certification. Both redirect for checkout. Signup and additional API access have no fee according to its FAQ. | Most accessible activity experiment. Basic does not include real-time availability; Full does. Verify current account-level entitlements. |
| GetYourGuide Partner API | Basic requires 100,000 monthly website visits or 50,000 app downloads. Reading access requires 1 million monthly visits and 300 monthly bookings for existing Basic partners. | Exclude API integration from pilot assumptions. Affiliate links/widgets are a separate possibility, not a substitute for inventory access. |

Sources: [Booking prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites), [Booking integration types](https://developers.booking.com/demand/docs/development-guide/application-flows), [Agoda getting started](https://developer.agoda.com/demand/docs/getting-started), [Agoda affiliate FAQ](https://partners.agoda.com/en-us/faq.html), [Expedia Redirect overview](https://developers.expediagroup.com/xap-apis/api), [Redirect application pause](https://developers.expediagroup.com/xap-apis/api/start-guide/getting-started), [Rapid setup](https://developers.expediagroup.com/rapid/setup), [Viator access levels](https://partnerresources.viator.com/travel-commerce/levels-of-access/), [Viator fees and checkout FAQ](https://partnerresources.viator.com/travel-commerce/affiliate/), [GetYourGuide requirements, updated 14 August 2026](https://partner.getyourguide.support/hc/en-us/articles/13981133907613-API-integration-and-requirements).

No public per-call tariff or startup minimum was verified for Booking Demand, Agoda Demand, Rapid or GetYourGuide API. This means **unknown**, not zero. Viator's no-fee statement does not eliminate engineering, data storage, AI, or support costs. Keep the supplier allowance provisional until access terms are established.

## Handoffs, content and freshness

- **Booking:** Its redirect flow explicitly supports current pricing/availability and a booking URL. Static content may be stored; its guide says not to cache prices or availability. This conflicts with any generic design that stores supplier offer responses indefinitely in saved trips. Before choosing it, confirm whether historical user-plan price observations may be retained and how they must be displayed; do not assume a last-checked label grants storage permission. [Integration and caching rules](https://developers.booking.com/demand/docs/development-guide/application-flows)
- **Agoda:** Search responses can include `landingUrl` with `metaSearch` in `extra`. Content API recommends weekly full refresh and daily partial updates. The FAQ warns that website and API inventory/prices should not be compared as identical; public website results cannot prove our assigned feed coverage. Exact dynamic-data retention and handoff preservation of dates, room allocations, ages and rate plan need validation. [Search schema](https://developer.agoda.com/demand/docs/json-search-api), [Content refresh](https://developer.agoda.com/demand/docs/content-api), [FAQ](https://developer.agoda.com/demand/docs/faq)
- **Viator:** Store/refresh data according to the selected access model; Basic lacks modified-since ingestion endpoints. Product details and schedules are distinct from a present-moment availability check for a particular date and passenger mix. The guide says single-product details should be fetched for a selected product as the customer moves to its display page, so validate the proposed AI candidate-enrichment workflow rather than assuming unlimited background detail fetching. Default search ranking is influenced by what Viator is paid: our recommendation should apply traveller constraints and explain its own fit criteria. No exact cache TTL is adopted from older unofficial API mirrors. [Current data-management guide](https://partnerresources.viator.com/travel-commerce/managing-product-availability-data/)
- **GetYourGuide:** API credentials are discretionary, with separate API conditions. The partner terms address storage/display rights and restrict redistributing platform content. Do not assume affiliate links convey rights to copy content into the planner or send it to another service. [Partner terms](https://www.getyourguide.com/c/partner-terms-and-conditions/)

For every shortlisted provider, confirm permission for server-side AI processing, derived explanations, map display, image use, shared saved trips, historical observations, content deletion and termination. These are unresolved integration questions, not findings that any specific provider prohibits the whole product. Avoid scraping as a replacement for declined API access.

## Destination evidence and proposed order

Public catalogs support investigating all three destinations, but **none has verified production API coverage for this app**. No dates, room configurations, passenger mixes or checkout prices were tested.

| Candidate | Observed first-party catalog evidence | Proposed validation role |
| --- | --- | --- |
| Jaipur | Booking hotel listings; Viator heritage, food and walking tours. | First activity/planning slice: selected short activities make duration, meeting-point and participant checks concrete. This ordering is an engineering inference, not a proven demand ranking. |
| Goa | Booking Goa region listings; Viator full-day tours. | Second candidate to validate regional hotel placement and transfer implications. A Goa-region match is insufficient for nearby-location guarantees. |
| Kochi | Booking Cochin listings; Viator Kochi sightseeing and backwater products. | Third candidate to check city activities versus excursions, included transport and pickup limitations. |

Evidence: [Jaipur hotels](https://www.booking.com/city/in/jaipur.en-gb.html?keep_landing=1), [Jaipur activities](https://www.viator.com/Jaipur-tours/Walking-Tours/d4627-g16-c56), [Goa hotels](https://www.booking.com/region/in/goa.html), [Goa activities](https://www.viator.com/en-AU/Goa-tours/Full-day-Tours/d4594-g12-c94), [Cochin hotels](https://www.booking.com/city/in/cochin.html), [Kochi activities](https://www.viator.com/Kochi-tours/Tours-and-Sightseeing/d952-g12).

Do not equate an activity marketplace with all tourist spots: independent sightseeing, restaurants, free time and custom activities need separate place/official-site/user-provided evidence. This is a proposed product-data boundary.

## Next evidence required before committing

1. Establish partner eligibility, allowed AI/planner use, API entitlements, rate limits, commercial minima and production review for Agoda/Booking and Viator. No outreach has been sent.
2. With approved credentials, test Jaipur, Goa and Kochi for representative dates, five adults in two rooms, families with child ages, subset activities, cancellations, tax inclusion, meal inclusion and pickup areas.
3. Verify each returned booking handoff preserves the intended product and search context; account for supplier re-selection where it does not.
4. Measure requests, latency, retries and absent data for one complete saved-trip journey. Confirm retained evidence is permitted and cannot be mistaken for current offers.
5. Keep unverified costs and missing feasibility explicit. If no suitable hotel inventory access is granted, re-scope openly with the founder; an affiliate link alone cannot substantiate a date-specific hotel budget.
