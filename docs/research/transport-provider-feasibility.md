# India transport provider feasibility

Research updated: 5 September 2026. Public first-party provider, developer and partner documentation only. No account was created, provider contacted, subscription purchased or authenticated inventory request made. Provider inventory totals are advertised coverage, not route-level proof. This note informs discovery; it does not select a provider.

## Decision

Use a staged provider stack. The India pilot should start with honest supplier handoffs and route estimates, then add live structured inventory only after each provider grants the required display, retention and handoff rights. A booking API is not automatically licensed for a product that displays an offer and sends the customer elsewhere to book it.

The best candidate to qualify first for Indian domestic flights is **TBO Air**, while **Travelport** is the strongest documented enterprise fallback with a trial path. **Duffel** is the easiest flight API to test but its published airline list does not show Air India or IndiGo, so it cannot be assumed to cover the core domestic market. Direct IRCTC enquiry integration is outside the pilot budget. For buses, qualify **redBus SeatSeller** commercially. For local transfers, use traffic-aware route estimates plus **Uber deep links**; do not label an estimated road cost as a live cab fare.

## Flight options

| Provider | Onboarding and test access | Data and commercial model | India-pilot assessment |
| --- | --- | --- | --- |
| **TBO Air** | Its official API guide says teams may begin integration while a commercial agreement is being signed and provides search, fare quote, booking and ticketing endpoints. Pricing and test credential terms are not public. [API guide](https://searchapi.tboair.com/), [endpoint catalog](https://searchapi.tboair.com/Help) | TBO advertises all leading domestic LCC and full-service carriers, real-time fares, GDS/LCC content and agent booking. It is a B2B travel distribution/booking product, including net fares and post-booking operations. [TBO Air](https://www.tbo.com/tbo-air), [platform](https://www.tbo.com/tbo-Platform) | **First commercial qualification.** Strongest advertised India fit. Confirm consumer display rights, search-to-book limits, whether a displayed offer may hand off outside TBO, refresh rules, fees/deposits, production SLA and exact carrier/route coverage. Marketing claims are not authenticated coverage evidence. |
| **Travelport JSON / Universal API** | JSON APIs provision organization-specific credentials and content. Universal API offers a 30-day pre-production trial; development requires a contract, certification precedes production, and pre-production is explicitly not an accuracy/performance indicator. [JSON authentication](https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/GeneralProject/Oauth.htm), [trial and production path](https://support.travelport.com/webhelp/uapi/Content/Getting_Started/Easy_Overview/Getting_Credentials.htm) | Search/book distribution with organization/PCC-specific GDS and NDC content. Contract pricing is not public. API rights terminate with the developer contract. [Terms](https://www.travelport.com/legal-policies/api-sdk-policies-terms-of-use) | **Enterprise fallback and comparison benchmark.** A real trial path exists, but onboarding, certification and opaque commercial terms add friction. Confirm Indian LCC/NDC access for the assigned PCC; global platform scope does not prove IndiGo/Air India results for this account. |
| **Duffel** | Self-serve account and test token; test mode is safe, but its reliable synthetic carrier has unrealistic schedules/prices and airline sandboxes can fail. [Getting started](https://duffel.com/docs/guides/getting-started-with-flights), [test mode](https://duffel.com/docs/api/overview/test-mode) | Offers include itinerary, price/currency, conditions and `expires_at` (typically about 30 minutes), with repricing before order. Public pay-as-you-go pricing lists USD 3 per confirmed order, 1% managed-content fee and excess-search charging above 1500:1. [Offers](https://duffel.com/docs/api/offers/get-offers), [pricing](https://duffel.com/pricing) | **Useful engineering spike, insufficient assumed India coverage.** Its current published airline list shows neither Air India nor IndiGo. It is built to create Duffel orders, not documented as external booking handoff inventory. Do not use it as the domestic source unless authenticated live tests and contract rights close both gaps. [Published airlines](https://duffel.com/flights/airlines) |
| **Amadeus** | The official developer portal announces that Self-Service was decommissioned on 17 July 2026 and directs ongoing API access to Enterprise. The old self-service onboarding URL now resolves to the portal. [Official portal](https://developers.amadeus.com/), [old onboarding URL](https://developers.amadeus.com/get-started/get-started-with-self-service-apis-335) | Enterprise access is commercial. Public pricing, pilot eligibility and assigned India content were not found in the reviewed official material. | **Do not design around old Self-Service tutorials or keys.** Enterprise remains a future procurement option, subject to commercial access, content proof and handoff rights; it is not a low-friction pilot dependency. |

Skyscanner remains the clearest flight-search/handoff model, but its official Travel API criteria require an established business with more than 100,000 monthly traffic and exclude low-traffic startups. Its affiliate programme separately requires more than 5,000 monthly unique visitors; unaffiliated widgets are available but do not give structured offer data. Treat it as a traction-stage option. [API criteria](https://skyscannerpartnersupport.zendesk.com/hc/en-us/articles/10881149122717-What-is-the-acceptance-criteria-for-the-Travel-API), [affiliate criteria](https://www.partners.skyscanner.net/product/affiliates)

## Indian rail

IRCTC's 2025 TIES policy supplies availability, fare, trains-between-stations, schedules, boarding stations and PNR enquiry, and explicitly permits **no ticket booking**. For a startup/MSME website it lists INR 5 lakh one-time integration, INR 2.5 lakh annual minimum, INR 5 lakh security deposit and an RDS balance requirement; usage is INR 0.25 plus tax per enquiry subject to the annual minimum. Startup status requires DPIIT recognition. The policy also forbids sharing/transmitting the API/service to a third party. [TIES policy](https://contents.irctc.co.in/en/TIES_Policy.pdf)

That annual minimum alone is about INR 20,833/month before tax, already beyond the INR 15,000 target before setup, deposit or other services. Direct TIES is therefore **not a pilot option**.

IRCTC's March 2026 official list identifies authorized B2C providers including MakeMyTrip, Paytm, Amazon, ixigo, EaseMyTrip, redBus/redRail and others; it also lists B2B principals including TBO. This establishes authorization status, not an API or redistribution right for Travel App AI. [Authorized principal service providers](https://contents.irctc.co.in/en/IRCTC%20Authorised%20Principal%20Service%20Providers.pdf)

**Pilot rail approach:** store user-selected train/station/time details and send customers to IRCTC or a currently listed authorized B2C provider to search/book again. Do not show “live availability” or a fare unless sourced through a separately authorized agreement. Later, qualify one listed B2C provider for deep-link parameters or an allowed referral integration; require written proof covering display, refresh, attribution and booking handoff.

## Bus

redBus directs travel agents to SeatSeller. Its developer-published listing describes KYC-based B2B booking and advertises 160,000 routes and 3,500+ operators; an official SeatSeller page provides a distinct API support channel. [redBus onboarding](https://onboardvendor.redbus.in/), [SeatSeller listing](https://play.google.com/store/apps/details?id=psl.seatseller.android), [API support](https://ss-campaigns.s3.ap-southeast-1.amazonaws.com/seatseller/images/ICONS/Contact-us/contact-us.html)

This is credible evidence of an agent platform and API support, but public official material reviewed does not specify API fees, sandbox access, rate limits, fare/seat-expiry fields, caching, external handoff rights or route-level coverage. redTribe is an influencer programme, not an inventory API. [redTribe](https://www.redbus.in/content/redtribe/)

**Pilot bus approach:** qualify SeatSeller after flights. Until approved, provide a labelled redBus search handoff and let the traveller record the selected service. Never turn advertised network totals into a coverage guarantee.

## Cabs, transfers and ground timing

Use two separate capabilities:

1. **Planning estimate:** Mappls Distance Matrix returns road distance and duration; India-only variants can apply live traffic or choose traffic-aware routes. It uses licensed keys and can return quota/whitelist errors. This supports transfer feasibility and buffers, not cab inventory or fare. [Mappls Distance Matrix](https://developer.mappls.com/documentation/sdk/rest-apis/mappls-distance-matrix-api/readme/)
2. **Booking handoff:** Uber documents universal/mobile-web deep links that prefill pickup and destination. Its price and time estimate endpoints require approval; price estimates are ranges and do not prove real-time product availability, while the time endpoint supplies current ETAs. Uber also prohibits using its API for competitive price comparison. [Deep links](https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction), [price estimates](https://developer.uber.com/docs/riders/references/api/v1.2/estimates-price-get), [time estimates](https://developer.uber.com/docs/riders/references/api/v1.2/estimates-time-get)

TBO advertises B2B car rentals and transfers, but its public API page reviewed is strongest on hotel APIs and does not document transfer endpoints or handoff rights. Consider it later for pre-booked airport transfers only after exact India inventory and API terms are demonstrated. [TBO platform](https://www.tbo.com/tbo-Platform), [TBO APIs](https://www.tbo.com/tbo-api)

## Staged stack

### Stage 0 — honest pilot

- Mappls traffic-aware durations for feasibility, with an explicit estimate timestamp and buffer.
- Supplier search/deep links for booking; customers revalidate price and availability on the supplier.
- Customer-entered transport selections remain labelled unverified until details are confirmed.
- No cross-provider claim that results are exhaustive or universally cheapest.

### Stage 1 — structured flight search

- Qualify TBO Air first and Travelport in parallel as the fallback procurement path.
- Run an optional Duffel sandbox spike only to validate the internal offer/expiry/repricing model.
- Integrate one live provider only after written permission for this search-and-handoff use case.

### Stage 2 — bus and rail partnerships

- Qualify SeatSeller for bus search and handoff.
- Qualify one provider on IRCTC's current B2C list for rail referral/deep links; avoid direct TIES at pilot economics.
- Keep manual/provider-page handoffs when an integration cannot prove current coverage.

### Stage 3 — richer transfers

- Seek Uber estimate approval only if measured users need live cab fare/ETA inside the itinerary.
- Evaluate TBO or a specialist transfer supplier for scheduled airport transfers after the first destinations are known.

## Contract and production proof gate

Before choosing any live inventory provider, obtain written answers for: India point-of-sale and named carrier/operator coverage; search-only and external-handoff rights; displayed price composition and currency; taxes, baggage and cancellation fields; offer expiry/repricing; retention/caching and AI-processing rules; attribution/deep-link continuity; test credentials; monthly minima, deposits and per-search/order fees; rate limits; support and uptime SLA; and exit/data-deletion terms.

Then run authenticated tests on candidate launch routes with multiple origins and traveller groups. Measure empty-result rate, exact-price drift on refresh/handoff, response latency, stale-offer behavior, terminal/station/boarding-point precision and supplier outage recovery. No reviewed public page establishes these production results for Travel App AI.
