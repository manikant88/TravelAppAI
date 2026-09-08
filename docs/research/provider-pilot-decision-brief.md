# Provider feasibility and pilot decision brief

4 September 2026. Research recommendation, not approved vendors or authenticated evidence of live inventory.

## Outcome

The INR 15,000 target remains a useful small-pilot infrastructure envelope, but comprehensive live Indian flight/rail/bus/hotel inventory is not yet established within it. Separate content access, live search, revalidation, and booking redirects in every provider evaluation. Ordinary affiliate links do not imply inventory API rights.

Detailed primary-source findings:

- [Transport](transport-provider-feasibility.md)
- [Stays and activities](stay-activity-provider-feasibility.md)
- [Maps and places](maps-provider-feasibility.md)
- [Budget assumptions](pilot-operating-budget.md)

## Proposed provider order

1. Google Maps/Places/Routes: first mapping and local feasibility candidate; evaluate storage/display terms alongside functionality. Mappls is the comparison candidate.
2. Viator: first activity-content and external-handoff candidate, with Basic versus Full Access capabilities kept distinct. Complement paid experiences with place discovery and traveller-authored activities.
3. Agoda Online Affiliate/MSE and Booking.com Demand: investigate approved hotel search-and-redirect access. Select neither until production eligibility, rate freshness, room occupancy, taxes, cancellation terms and handoff rights are established.
4. Indian transport: resolve partner access before committing to live multi-mode recommendations. A booking-oriented B2B API is not automatically suitable for a consumer referral product. Direct rail access may require substantial commercial commitments; aggregator access needs its own evidence.

## Initial destination probes

Recommend testing Jaipur first, then a geographically bounded Goa area, then Kochi. This order is a product judgment intended to test heritage sightseeing, dispersed beach activities and another distinct city experience. It is not a claim of verified transport or hotel availability. Customer launch destinations remain conditional on provider acceptance and coverage checks.

For each destination, test at least two origin groups with different transport modes, arrival rendezvous, two room groups, one optional activity, a meal estimate, and an uncertain custom activity. Use several dates and occupancy combinations rather than one happy-path query.

## Acceptance gates for each integration

- Production credentials and permitted use fit the external-booking model.
- Documented setup costs, deposits, minimum commitments and expected usage fit the budget or receive a deliberate revision.
- Date, traveller, room and activity combinations yield usable results with source, timestamp and capability status.
- Total payable price or clearly identified missing charges, currency, occupancy and availability can be represented without inventing values.
- Refresh and handoff preserve the intended product/date/party where supported; generic redirects are labelled accurately.
- Storage, attribution and display rules can coexist with saved trips and approval history.
- Timeout, no-result, expired offer, changed price and revoked access produce honest states, never synthetic customer offers.

Public documentation meets none of the authenticated-result gates by itself. No provider is certified by this research.

## Proposed implementation sequence

1. Resolve access and perform a small authenticated capability evaluation once credentials are available. Keep evidence and measured cost per request.
2. Specify app-owned trip persistence, participant permissions, versioned approval and provider-data lifecycle. Existing `src/inventory/contracts.ts` has typed coverage and generation time, but needs explicit provider/source, freshness, revalidation and handoff concepts. Its existing presence is not evidence of compatibility with a particular supplier.
3. Build one complete saved day: place selection, local route, timeline, group cost, invitation, review, approval and reopening. Use genuinely sourced data; keep unsupported offers visibly unresolved.
4. Add an approved stay/experience provider with current pricing and booking handoff, then expand transport capabilities as access permits.
5. Exercise multi-origin, room groups, optional activities, changed offers and approval invalidation before customer launch. Preserve the repository's restriction on automated browser tests unless the user requests them.

This sequence is an engineering recommendation, not an instruction to implement during discovery. Reconcile affected baseline contracts before code changes; retain useful deterministic validation.

## Decision if live transport access is unavailable

The customer promise includes transport recommendations. Do not silently narrow it. Present the user with two explicit paths: obtain an approved supplier partnership before launch, or authorize an initial planning product that accepts traveller-provided transport details and links out for search. The latter can be useful but has a materially different live-inventory promise.

## Next external information needed

For shortlisted providers, obtain written production eligibility, referral-model permission, India coverage (including low-cost airlines and rail if applicable), one-time and recurring costs, certification steps, cache/retention terms and revalidation support. No accounts, purchases or outreach have been authorized or performed by this research.
