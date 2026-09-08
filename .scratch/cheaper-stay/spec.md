# Cheaper stay with whole-trip comparison and safe application

Status: draft
Blocked by: none for specification; production supplier access for live verification
Created: 4 September 2026

## Problem Statement

An organizer wants a less expensive stay without losing the trip's agreed dates, room arrangements, comfort needs or activities. A lower room price may increase transfer costs, remove included meals or make the schedule infeasible. The organizer needs a grounded comparison and a safe way to select an alternative while other travellers continue using the trip.

## Solution

“Find a cheaper stay” starts a bounded comparison and does not replace anything. Show a small set of valid alternatives with whole-trip and per-traveller cost changes, transfer-time effects, changed inclusions, source freshness, and preserved selections. The organizer selects an exact alternative, reviews the resulting change, and confirms application. Application code revalidates against current state and writes the complete update atomically. A previously approved plan requires renewed approval after the material change.

This spec implements one journey in the agreed customer product. It does not redefine the entire launch scope. Product rules are agreed; the technical design below is proposed for implementation review.

### Worked example and acceptance oracle

All names, dates and amounts in this example are fictional test inputs, not supplier claims.

Five adults spend three nights in Jaipur, occupying room groups of two and three. They arrive from two origins and have fixed travel and activities. The stay is unbooked. Dates, rooms, participation, dietary/accessibility needs and hard budgets must be preserved. The current trip is version 12.

All amounts below cover the whole five-person group for the same three-night period. Hotel totals include required taxes/fees in this fixture; transfer costs are labelled estimates with the same basis across options. Other trip costs are unchanged.

| Option | Stay total | Affected transfers | Meal adjustment | Comparable total | Estimated saving |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current | INR 30,000 | INR 3,000 | INR 0 | INR 33,000 | — |
| A | INR 24,000 | INR 7,000 | INR 0 | INR 31,000 | INR 2,000 |
| B | INR 26,000 | INR 3,500 | INR 0 | INR 29,500 | INR 3,500 |

The fixture gives A 120 additional transfer minutes across the stay and B 20 additional minutes. Both retain the room groups and required inclusions. B provides more estimated saving despite a higher hotel price. These minutes are itinerary elapsed time, not the sum of every traveller's minutes.

For B, room-group totals change from INR 12,000/18,000 to INR 10,000/16,000. With equal division within each room group and all five sharing the affected transfers, each traveller in the first room saves INR 900; each in the second saves approximately INR 566.67, with one minor-unit rounding adjustment. Code preserves exact totals and uses the agreed allocation method. A traveller's individual budget is checked separately from the group total.

Example flow:

1. Organizer asks for cheaper stays. The app authenticates, resolves the target stay and saves task T against version 12. It preserves the current itinerary.
2. AI requests relevant stay searches. Code enforces dates, room-group occupancy, constraints and scope before calling the provider.
3. For promising valid options, the app calculates affected arrival, departure and activity transfers. It accounts for lost meal inclusions or other changed costs where relevant.
4. Code computes comparison facts. AI recommends B from those facts, explains why and shows A as an alternative if useful. The organizer may leave and return while the task runs.
5. Organizer selects B. The app refreshes its terms where supported and builds a preview that includes the stay, dependent transfers, allocations, budget and timeline effects.
6. Organizer confirms the exact preview. The app checks current membership, permissions, version, cancellation, offer conditions and validity, then saves version 13 once.
7. Every view reads version 13. If version 12 had trip approvals, they remain historical and do not approve version 13. The new plan requires approval covering all travellers before finalization. No booking or cancellation has occurred.

## User Stories

1. As an organizer, I want a search request to preserve my selected stay, so I can compare safely.
2. As an organizer, I want an ambiguous stay target clarified, so the correct stay is evaluated.
3. As a traveller, I want my room group and hard constraints respected, so a cheaper option still works for me.
4. As an organizer, I want total stay prices with inclusions and missing charges visible, so comparisons are meaningful.
5. As a traveller, I want my own cost allocation shown, so group savings do not conceal a personal budget increase.
6. As an organizer, I want transfer cost and time changes included, so I can assess the whole trip.
7. As a traveller, I want alternatives and trade-offs explained from evidence, so I can understand the recommendation.
8. As an organizer, I want fixed activities and transport preserved, so a stay search does not redesign my trip.
9. As an organizer, I want to cancel or leave a search without losing the current plan.
10. As a traveller, I want provider failures distinguished from no availability, so I can judge incomplete results.
11. As an organizer, I want changed prices or terms shown before application, so an old click cannot authorize new conditions.
12. As a traveller, I want newer preferences protected from stale AI results.
13. As an organizer, I want duplicate requests to apply only once, so retries cannot create repeated changes.
14. As a traveller, I want material changes to require renewed trip approval.
15. As an ordinary group member, I want to explore and suggest alternatives without changing shared selections.
16. As a traveller, I want private information excluded from group explanations and logs.
17. As an organizer, I want unavailable or incomplete supplier data clearly labelled rather than invented.
18. As an organizer, I want a selected option's supplier handoff available where supported, without implying it is booked.

## Implementation Decisions

### Existing foundation and necessary changes

Preserve the existing conversation boundary, scoped modification intent, typed inventory interfaces, deterministic trip projection and proposal preview/application domain functions. Existing version checks are useful, but compare supplied state: the current proposal service accepts a client-supplied trip and proposal and returns a new trip. It is not an authenticated, durable database transaction.

The customer implementation must load authoritative state on the server from a trip identifier. Clients supply intent, selection identifiers and expected versions, never authoritative totals, permissions or entire replacement trips. Extend the stay model to describe explicit room groups and rate terms; do not assume the existing single room-facts object represents heterogeneous room assignments.

### Public application operations

Operation names are proposed logical contracts, not fixed endpoint paths.

| Operation | Request | Response and authority |
| --- | --- | --- |
| Request stay alternatives | Trip ID, target stay ID or clarification context, text/structured intent, client request ID | Task ID, base trip version, scope and status; organizer can request shared comparison, members can request permitted personal exploration |
| Read task | Task ID and event cursor | Authorized progress, grounded options, partial-result warnings and terminal status |
| Cancel task | Task ID and request ID | Idempotent cancellation outcome; no reversal of committed edits |
| Preview selected alternative | Task ID, option ID, expected trip version | Server-created proposal ID, exact changed/preserved selections, allocations, freshness and validity |
| Apply preview | Proposal ID, expected trip version, idempotency key | New trip version/projection or typed rejection; organizer-only shared mutation |
| Read trip | Trip ID | Authorized canonical version, projection and approval state |

Authentication derives the actor from the verified session. Guessing a task, proposal or option ID grants no access. Reads respect personal-exploration scope and private traveller fields.

### AI tools and deterministic responsibilities

| Boundary | Inputs and output | Owner |
| --- | --- | --- |
| Load permitted trip context | Current state, target stay, permitted constraints, room groups, route dependencies and comparison objective | App builds minimized model context |
| Search stay alternatives | Location area, dates, explicit occupancy, confirmed constraints, bounded page/result limits; returns normalized offers and capability/freshness data | AI may request; app validates and executes |
| Evaluate affected transfers | Candidate location, affected itinerary endpoints, modes, participant groups and time windows; returns durations, distances and sourced costs/estimates | App identifies dependency scope and calls routing/cost providers |
| Compare valid candidates | Normalized inclusions, cost allocations and validated timeline effects; returns fact identifiers, deltas, unknowns and validity | Code calculates; AI ranks and explains supported trade-offs |
| Revalidate selected offer | Provider reference, occupancy/dates and last known terms; returns refreshed terms, unavailable or refresh-unsupported | App invokes before preview/application as needed |
| Build/apply proposal | Validated choice, current authority and exact version | App only; never unrestricted model write access |

One coordinating planner can request focused searches and a bounded refinement. Independent lookups may run concurrently. No automatic flight/date/activity replacement is permitted by this search. Every tool response is untrusted data: validate schemas and IDs, and never obey instructions embedded in supplier descriptions. The model cannot invent prices, accessibility facts, transfer times or approval state.

Derive candidate room totals and route costs before ranking. Do not truncate to the first few provider-ranked results and describe them as the market's best. Report evaluated coverage honestly. Retain a small displayed shortlist after validation.

### Cost and feasibility rules

Compare the same dates, occupancy, currency and known inclusions. Preserve all unchanged trip costs. Recalculate every affected connection, including distinct arrival groups, return legs, activity subsets and transfer vehicle capacity. Include taxes, required fees and meal-inclusion differences where known, avoiding double counting already-included transfers or meals.

Store currency amounts in minor units and round allocations deterministically so shares sum exactly. Currency conversion is not introduced by this slice; incompatible currency results need an explicit unsupported status. A route duration alone is not a fare source. Unknown costs stay unknown and block any definitive cheaper claim when they can reverse the comparison. Estimated savings remain labelled estimated.

Require budget, occupancy, locks, accessibility and schedule checks. A candidate with unknown accessibility cannot be represented as satisfying a hard accessibility requirement. Search may preserve incomplete suggestions, but application cannot introduce unresolved hard-constraint or connection failures. Existing unrelated draft gaps stay visible and prevent finalization; targeted repair must not require an otherwise completely valid draft.

### Durable state

| Record | Minimum responsibility |
| --- | --- |
| Trip and membership | Canonical version, organizer/representative roles, traveller details and permissions |
| Stay selection and room groups | Dates, supplier/property/rate references, participants, inclusions, locks and booked/unbooked knowledge |
| Task | Actor, intent, target, base version, scope, status, progress sequence, timestamps, deadline, call/cost counters and cancellation state |
| Candidate evidence | Option identity, provenance, source-observation/retrieval times, expiry, permitted facts, completeness and comparison outputs |
| Proposal | Base version, exact intended change, material terms, preserved selections, validation and expiry |
| Cost allocation | Original currency/amount, estimate status, participants and shares |
| Approval | Reviewed version, approving identity, represented travellers and timestamp |
| Mutation record | Idempotency key, actor, proposal, before/after versions and outcome |

Evidence retention is provider-specific. Store app-owned decisions and permitted provider references; retain price observations/content only where terms allow. Retrieval time must not masquerade as observation time. If permitted evidence has expired or been removed, show that limitation and refresh rather than retaining prohibited data for convenience.

### Task lifecycle and limits

Proposed states: queued, running, awaiting-input, completed, cancelled and failed. Completion means comparison results are available, not that the stay changed. Awaiting-input pauses active work until an authorized response; distinguish usable partial results from a successful exhaustive search.

Persist progress independently of the browser connection. Worker retries use a lease/checkpoint and idempotency to avoid duplicate effects. Check cancellation before new calls and before publishing actionable output. In-flight provider calls may finish after cancellation; do not claim all charges can be reversed.

Before implementation is accepted, configure and test finite deadlines, maximum calls/candidates, retry budgets and retention periods using measured provider behavior. No unlimited default is allowed. Exceeding the budget yields honest partial results or a recoverable failure. This task does not enroll the user in proactive monitoring.

### Atomic application and approvals

Revalidation occurs outside a long-running database transaction. Then a short transaction rechecks the latest version, membership/authority, proposal terms, cancellation where applicable, and locks. It writes selections, dependent transfers, allocations, projection inputs, approval-state change and audit outcome together, or writes nothing. External refresh cannot guarantee the supplier will hold a price; display observation time and booking uncertainty.

Use compare-and-swap on the expected version. On relevant changes, regenerate a preview and obtain fresh confirmation. For this slice, any version mismatch conservatively requires a new preview; automatic merging is deferred. Repeating the same apply idempotency key returns the original outcome; reusing it for different content is rejected. Old proposals cannot be replayed against newer state.

A selected alternative is not consent to an increased price, changed cancellation terms or changed room assignment discovered afterward. Material drift requires a new preview even if the revised price is still cheaper. A previously approved version stays historical; a changed version is unapproved until everyone is covered again. No supplier booking, cancellation or payment occurs.

Already-booked or booking-status-unknown stays may be explored but cannot be advertised as switchable savings without cancellation/refund implications. The primary acceptance example requires an explicitly unbooked stay. No automatic cancellation is part of this slice.

### Failure outcomes

Distinguish access denied, ambiguous target, constraint conflict, no result in searched coverage, provider unavailable, partial evidence, expired offer, materially changed terms, stale trip, cancelled task and duplicate application. Return actionable recovery without exposing private fields. If language generation fails, use factual templated results; if facts are absent, do not fabricate an alternative.

## Testing Decisions

Proposed primary test seam: the public application operations from requesting alternatives through reading the persisted result. This extends the existing modification and proposal behavior tests. It is ready for user review, not yet approved as a test implementation plan.

Test observable outcomes, not prompt wording, internal call ordering or private methods. Use controlled provider/model adapters for repeatable scenario facts, including malicious/invalid outputs, and a real isolated test database for transaction and persistence cases. Authentic supplier contract checks are a separate access-dependent gate. No automated browser tests unless explicitly requested.

Required acceptance cases:

1. The worked example produces A's INR 2,000 and B's INR 3,500 estimated savings and correct per-person totals; searching leaves version 12 unchanged.
2. Selecting/confirming B creates version 13 once; unrelated travel, activities and dates remain unchanged.
3. Wrong occupancy, unsupported hard accessibility, adverse personal budget allocation or infeasible transfers prevent application.
4. Unknown transfer fares or missing required fees remain explicit and cannot produce a definitive savings claim.
5. Changed price/terms, expired offer, revoked organizer access and concurrent edits reject the old preview with no partial writes.
6. Two concurrent applies and duplicate retries yield at most one update for the expected version. A transaction failure leaves the previous trip intact.
7. Leaving and returning resumes readable progress/results. Cancellation prevents subsequent application by the cancelled operation; an already committed update remains visible.
8. Cross-trip/task access, forwarded identifiers and member attempts to mutate shared state are denied.
9. Material changes invalidate current approval coverage; historical approvals remain attached to their reviewed version.
10. Timeouts, budget exhaustion, no results and model failure produce distinct recoverable outcomes, preserving the saved trip.
11. Invalid model IDs, invented numbers and supplier instruction text cannot escape validation or cause writes.
12. Already-booked and unknown-status stays disclose missing switching costs and cannot produce misleading net savings.

Before release, measure actual latency, provider calls/cost per comparison, invalid-result rate, and correctness of saved outcomes. Do not claim numerical performance targets without a measured baseline.

## Out of Scope

In-app booking/payments/cancellations; complete supplier selection; date/destination replacement; changing unrelated transport or activity choices; redesigning the full voting experience; expense settlement; automatic recurring monitoring; specialist AI agents; automatic conflict merging; native apps; production accounts or paid subscriptions.

## Further Notes

Dependencies include server-side trip ownership, durable task execution, participant-level costing, supplier search/revalidation permissions and routing with cost provenance. These are explicit implementation needs, not capabilities inferred from the existing prototype.

Vendor choices, numeric execution limits and the proposed testing seam need review before coding. Supplier entitlements and retention rules require evidence before live rollout. This draft can be decomposed into small implementation tickets once accepted. No triage label is required by the configured local tracker.
