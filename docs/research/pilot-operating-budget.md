# Pilot operating budget

Researched and accepted as a planning envelope on 4 September 2026. This is not authorization to purchase services or a vendor quote. The canonical budget decision is in `PROJECT_CONTEXT.md`; allocations below remain estimates pending provider validation and measured usage.

## Planning envelope

Target INR 15,000/month, with a reviewed stretch ceiling of INR 25,000/month. Assume an invite-only pilot with 50–100 planning groups per month, roughly 200–500 travellers, 3–5 domestic destinations, and one developer seat. This volume is a modeling assumption, not measured capacity or accepted launch coverage.

Suggested monthly allowances (not vendor prices):

| Category | INR |
| --- | ---: |
| Hosting, database, storage, restore capability | 4,000 |
| AI planning, explanations, evaluation and retries | 4,000 |
| Maps, places and routing | 2,000 |
| Identity, transactional email, monitoring | 1,000 |
| Travel supplier usage, provisional pending access and quotes | 1,000 |
| Tax, exchange-rate and usage reserve | 3,000 |
| Total | 15,000 |

Supplier licensing, minimum commitments, onboarding costs and paid access can exceed this envelope. Evaluate them separately before claiming coverage. Excludes engineering labour, marketing, legal work, customer support labour, coding-assistant subscriptions, and customers' bookings. INR amounts are rounded budget allocations, not currency conversions of vendor quotes.

## Public price anchors

- Vercel lists Pro at USD 20/month with USD 20 included usage credit, plus usage and applicable taxes. [Pricing](https://vercel.com/pricing)
- Neon lists Launch compute at USD 0.106/CU-hour and storage at USD 0.35/GB-month. Actual runtime, size and restore settings determine the bill. [Pricing](https://neon.com/pricing)
- The app's existing GPT-5 mini model lists USD 0.25/million input tokens and USD 2/million output tokens. This is a cost reference, not a decision that this model meets the new product's quality needs. [Model pricing](https://developers.openai.com/api/docs/models/gpt-5-mini)
- Google Maps India pricing lists Compute Routes Essentials with a 70,000 monthly free usage cap and USD 1.50/1,000 billable events in the next tier. Places and other routing SKUs have separate allowances and rates; route matrices can multiply billable events. India pricing depends on eligibility, not simply planning trips inside India. [Rates](https://developers.google.com/maps/billing-and-pricing/pricing-india), [eligibility](https://developers.google.com/maps/billing-and-pricing/india)
- Resend lists 3,000 emails/month free with a 100/day limit. Invite or approval bursts may require a paid plan even at low monthly totals. [Pricing](https://resend.com/pricing?volume=50000)

## Protect quality while controlling cost

Prioritize grounded supplier information, routing, clear uncertainty, persistence, authorization, recovery, and evaluation against realistic multi-traveller scenarios. Choose models through measured quality and latency, reserving stronger reasoning for cases where it improves results. Never save cost by inventing offers, hiding stale data, skipping feasibility checks, or substituting synthetic inventory into customer results.

Defer native apps, voice, generated travel imagery, paid SMS/WhatsApp, broad destination expansion, and enterprise analytics unless evidence makes them necessary.

Instrument cost per active group and per approved itinerary, broken down by AI and provider calls. Review spend at INR 10,000 and before exceeding INR 15,000. The INR 25,000 ceiling is a proposed escalation point, not configured billing enforcement. Limit new pilot enrollment or optional work before disrupting saved-trip access and approvals. Check vendor-specific limits before promising a hard spending cap.

Raise the envelope for a verified coverage requirement, measured quality/latency improvement, or customer growth. A higher model bill alone cannot establish supplier accuracy. Re-estimate after observing the first 20–30 groups and obtaining supplier terms.
