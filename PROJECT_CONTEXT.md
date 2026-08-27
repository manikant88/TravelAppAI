# PROJECT_CONTEXT.md

## Project

**Cleartrip AI Trip Workspace** — a desktop-web take-home prototype for Razorpay's Design Builder exercise.

## Purpose of this document

This file is the product and design source of truth. It defines the problem, research-backed product thesis, experience principles, supported travel world, scope, and intended boundaries.

Read this file before `IMPLEMENTATION_SPEC.md`. If implementation reveals a conflict, update the documents deliberately rather than creating undocumented behavior.

---

## 1. Exercise framing

The exercise asks for an AI-powered planning experience for an existing travel platform such as Cleartrip or MakeMyTrip. It must go beyond search and filtering: users should be able to describe a trip naturally, delegate meaningful planning work, inspect the resulting plan, modify it, preserve approved decisions, and understand trade-offs.

The submission should demonstrate:

- research-informed product judgment;
- a meaningfully agentic interaction rather than a chatbot wrapper;
- a coherent multi-part trip rather than independent recommendations;
- transparency, approval, and user control;
- a consistent, polished interface;
- a working, testable prototype.

The prototype favors **depth of planning behavior over production breadth**, but it must not be built around a single scripted itinerary. It operates over a bounded, destination-agnostic travel world containing 10 Indian and 10 international destination markets.

Adding a destination should require inventory records, not destination-specific prompts, schemas, UI, or planning branches.

---

## 2. Chosen platform

**Cleartrip-inspired desktop web.**

Why:

- Cleartrip provides a calmer visual base for an AI planning workspace.
- Desktop supports conversation and a persistent structured trip side by side.
- MakeMyTrip holiday packages remain a useful reference for grouping travel, stays, activities, itinerary, and budget into one reviewable artifact.

The prototype does **not** use private Cleartrip or MakeMyTrip inventory endpoints. It uses a first-party simulated inventory service backed by a pre-seeded, read-only relational database.

All inventory is synthetic. The UI must describe prices and availability as prototype data and must never imply that an itinerary is bookable or that a price is live.

---

## 3. Product thesis

> **A trip is a structured artifact. The AI is the planner and editor of that artifact.**

The chat is not the trip. Conversation is the natural-language control surface for a persistent workspace containing:

- travellers;
- constraints and preferences;
- route and stops;
- travel selections;
- stays;
- activities;
- transfers;
- explicit locks on approved selections.

The UI renders different views of the same trip state.

Two supporting principles define the architecture:

> **Inventory is data; planning is intelligence.**

> **A useful agent forms a plan, gathers relevant evidence, adapts to that evidence, and proposes actions within bounded authority.**

The product is not differentiated merely because an LLM can generate an itinerary. Its value is that it understands dependencies, remembers constraints, scopes modifications, preserves accepted decisions, and explains consequential trade-offs.

Short framing:

> **A living trip plan that adapts without forgetting what matters.**

---

## 4. Primary behavioral archetype

### Constraint-heavy planner

A person coordinating a multi-day trip where dates, budget, timing, comfort, interests, mobility, and travel effort interact.

A family planner is the primary example, but the behavioral need also applies to couples, friend groups, and solo travellers with strong constraints.

### Core job to be done

> When I am planning a multi-day trip with interacting needs, help me find a combination that works together and preserve decisions I have already made, so I do not have to re-evaluate the entire trip whenever something changes.

---

## 5. Research synthesis

Do not fabricate participant counts, percentages, or quotes. The following findings are qualitative until the user's research notes establish otherwise.

### Finding 1 — Coordination is harder than discovery

Users can find individual flights, hotels, and attractions. The harder work is making them coherent:

- flight timing affects usable days;
- hotel location affects daily transfer effort;
- budget trade-offs span categories;
- mobility needs affect both pacing and activity choice;
- a multi-stop route must account for relocation time.

**Implication:** plan the trip as a connected system, not as independent searches.

### Finding 2 — Hard constraints and soft preferences are different

Examples include:

- no departure before 8am;
- fixed dates;
- maximum trip budget;
- limited walking;
- beachfront preference;
- relaxed pace.

**Implication:** hard constraints must be explicit and may never be silently violated. Soft preferences guide contextual recommendations among valid choices.

### Finding 3 — Users delegate analysis but retain consequential control

Users are willing to delegate discovery, comparison, shortlisting, routing, and itinerary assembly. They want stronger control over selected travel, selected stays, material budget changes, and booking.

**Implication:** the agent may plan assertively, but consequential state changes are proposals until approved.

### Finding 4 — Local requests should cause local changes

“Find a cheaper hotel” should not replace flights, dates, or unrelated activities unless a real dependency makes preservation impossible.

**Implication:** every modification has explicit affected and preserved selections. Locks are enforced in domain code.

### Finding 5 — Explanations matter around trade-offs

Users need concise evidence when:

- the recommendation is not the cheapest;
- a constraint cannot be met;
- a local change affects transfer time or schedule;
- the trip exceeds budget;
- the strategy changes after a search.

**Implication:** explain evidence and consequences, not hidden chain-of-thought.

### Finding 6 — Conversation is good for intent; structure is good for review

A multi-day plan is difficult to review inside a transcript.

**Implication:** conversation edits a persistent structured workspace.

### Finding 7 — Shared trips may include partial participation

Different travellers may skip different activities.

**Implication:** relevant selections and itinerary events retain `travellerIds`. Traveller-specific UI, split itineraries, late joins/leaves, and collaboration remain outside P0.

---

## 6. Chosen product direction

### AI Trip Workspace

**Mental model:** collaboratively edit a living trip.

Conversation captures goals and modifications. The workspace persistently renders:

- Itinerary;
- Travel;
- Stays;
- Activities;
- compact traveller context;
- budget.

This direction balances delegation and control better than either a chat-only planner or an opaque “autopilot package.”

The primary risk is becoming traditional travel search plus a chatbot. The agent must therefore make operational planning decisions: what it needs to search, whether it needs clarification, how to structure the route, how to adapt after poor results, and what to preserve during modification.

---

## 7. What “agentic” means here

An agentic action has five properties:

1. It is directed toward an explicit user goal.
2. The model chooses a permitted next action rather than following the same endpoint sequence every time.
3. The action gathers or uses grounded evidence.
4. The model can revise its approach when the evidence invalidates an assumption.
5. Code validates every action and owns all consequential state changes.

The single travel-planner model may:

- extract structured intent from natural language;
- decide which optional clarification would materially improve the plan;
- distinguish a specified, broad-scope, or open-ended destination request;
- form a planning hypothesis;
- choose bounded, typed inventory searches;
- decide between a single-stop and supported multi-stop strategy;
- allocate nights at a high level;
- contextually recommend among hard-valid candidates;
- choose whether to search once more, clarify, propose, or report infeasibility;
- interpret and scope modification requests;
- explain recommendations from supplied fact bundles;
- make one bounded repair after deterministic validation feedback.

The following are **not** sufficient evidence of agency:

- calling every endpoint in a fixed sequence;
- sending the full database to the model;
- filling a pre-authored itinerary template;
- choosing a result already selected by an opaque code score;
- branching on destination names;
- producing fluent but ungrounded travel claims.

The workflow is bounded. There is no open-ended autonomous loop, browser control, or arbitrary tool use.

---

## 8. Design principles

### 1. Ask only what changes the plan

Do not turn the conversation into a long form. Required factual gaps are handled deterministically. The model may prioritize at most one optional clarification when it materially affects strategy, and the user may skip it.

### 2. Make constraints explicit

Constraints use `hard`, `strong`, or `flexible` priority. Hard constraints are never silently violated.

### 3. Build one persistent trip

Conversation, category views, and itinerary all operate on the same canonical trip state.

### 4. Preserve decisions by default

Unrelated and locked selections remain unchanged unless the user explicitly approves a proposal that changes their lock state.

### 5. Search only when useful

The agent chooses searches based on the goal. An explanation needs no new search; a hotel change should not automatically re-search flights.

### 6. Adapt to evidence

The agent may change its hypothesis after search observations or structured validation feedback, within the fixed round budget.

### 7. Recommendations require observations

Every destination, travel, stay, activity, transfer, price, duration, and comparative claim must trace to inventory/API facts supplied in the current workflow.

### 8. Explain trade-offs, not chain-of-thought

Show what changed, what stayed, what it costs or saves, and which fact or constraint drove the decision. Do not expose hidden reasoning.

### 9. Consequential changes require approval

Travel, stay, lock, constraint, and meaningful budget changes are represented as typed proposals before commitment.

### 10. Data expansion must not require product branches

Adding a supported market changes seed data and tests, not agent schemas, trip state, UI contracts, or destination-specific functions.

---

## 9. AI and code responsibility boundary

### The model owns

- natural-language intent extraction;
- useful optional clarification priority;
- planning hypothesis and high-level route strategy;
- selection of permitted search tools and typed parameters;
- contextual recommendation using soft preferences;
- interpretation and scoping of modifications;
- grounded summaries and explanations;
- one optional evidence-driven refinement;
- one optional repair after deterministic trip validation.

### Code owns

- required-field validation;
- location resolution against supported IDs;
- inventory and availability;
- API execution;
- hard-constraint filtering;
- objective fact calculation;
- prices and arithmetic;
- dates, nights, durations, and transfer feasibility;
- candidate ID validity;
- route and itinerary assembly;
- locks and preservation;
- proposal construction and application;
- state versioning;
- final validation;
- component-family selection;
- all state mutation.

The model may never invent or override inventory, availability, price, dates, duration, transfer time, hard-constraint results, lock state, or validation results.

---

## 10. Supported travel world

P0 contains a fixed seed manifest:

- 10 Indian destination markets spanning north, south, east, and west;
- 10 international destination markets across multiple world regions;
- a small set of Indian origin hubs;
- city, airport, region, country, and neighborhood relationships;
- scheduled transport, properties and room offers, activities and sessions, and transfers.

All runtime inventory is read-only and synthetic. Searches are deterministic for the same inventory version and normalized request.

Inventory depth may vary, but every declared market must meet a documented base coverage contract. Some markets may contain enough connected child locations for multi-stop planning. That capability is derived from inventory relationships, not a destination-name branch.

An unsupported place is not a model failure. The product should honestly distinguish:

- unsupported catalog coverage;
- supported market with no transport from the chosen origin;
- no availability for the dates;
- available inventory eliminated by hard constraints.

---

## 11. Entry and destination intent

The initial interface combines lightweight structured input with natural language:

- From;
- Destination or “Help me choose”;
- Dates;
- Travellers;
- prompt box.

Structured fields may be inferred from natural language.

The experience supports three destination modes:

### Specified destination

> Plan four days in Goa from Bengaluru.

### Broad scope

> Plan a week in Thailand with beaches and one city stop.

The supplied location may be a country or region. The agent resolves concrete supported stops from inventory.

### Open-ended discovery

> Find us a relaxed beach trip from Mumbai in October under ₹1.2 lakh.

The agent discovers supported markets using stored tags plus actual transport and stay facts. It does not use unsupported world knowledge as inventory truth.

Because destination choice is consequential, the UI shows the recommended market with alternatives before running the detailed itinerary plan. Selecting one converts the draft to a specified destination and starts the same PLAN workflow used by a directly entered destination.

---

## 12. Clarification and Trip Brief

Required validation happens before planning. Minimum requirements are:

- origin;
- destination intent, including an explicit open-ended intent;
- usable dates;
- at least one traveller.

Required clarifications use deterministic chips or fields. Show one high-value question at a time and no more than four visible choices.

After required fields are present, the model may select one optional topic such as budget, pace, or mobility. The user may skip it.

The Trip Brief displays the structured interpretation:

- origin and destination intent;
- dates;
- traveller count;
- budget target or maximum;
- hard constraints;
- strong and flexible preferences;
- assumptions that materially affect strategy.

Avoid a redundant confirmation step unless ambiguity is consequential.

---

## 13. Bounded planning experience

The planning experience follows actual work:

1. validate required information;
2. form a planning hypothesis;
3. execute the first typed inventory-search round;
4. inspect grounded observations;
5. optionally clarify, refine the search once, propose a strategy, or report infeasibility;
6. assemble the trip deterministically;
7. validate the complete trip;
8. optionally perform one targeted repair;
9. commit only a validated `TripState`.

Visible progress must correspond to real workflow events, for example:

- “Finding beach destinations reachable within your budget”;
- “Comparing transport and stay availability”;
- “Checking transfers between proposed stops”;
- “Re-searching stays while preserving your flights”;
- “Validating schedule and total cost.”

Do not simulate Day 1 completion before globally validating the route. Do not show decorative timed progress that is disconnected from actual work.

---

## 14. Primary workspace

### Left panel

- editable Trip Brief;
- conversation;
- grounded explanations;
- contextual actions;
- composer.

### Right panel

- `Itinerary`;
- `Travel`;
- `Stays`;
- `Activities`;
- persistent total, target, and budget delta.

### Itinerary

The itinerary is a chronological projection of selected travel, stays, activities, and transfers. It is not an independent source of truth.

Changes initiated from chat, an itinerary event, or a category card resolve to the same modification workflow.

### Traveller scope

There is no Travellers tab, joins/leaves flow, split itinerary, or participant-specific editing in P0. Relevant selections retain `travellerIds` for future extensibility.

---

## 15. Modification and preservation model

Example:

> Find a quieter hotel, but keep our flights and the beachfront stay in Goa.

Expected behavior:

1. interpret the affected selection and goal;
2. resolve explicit and default preservation;
3. preserve all locked selections;
4. decide which inventory searches are necessary;
5. retrieve current valid alternatives;
6. calculate budget, transfer, and schedule effects;
7. construct a typed proposal;
8. show changed, affected, and preserved items;
9. wait for approval;
10. apply against the expected trip version.

If a target is ambiguous, code asks for selection clarification rather than allowing the model to guess.

Locks are minimal but core to P0. A lock exists explicitly in domain state and changes only through a typed, user-approved operation.

---

## 16. Conflict and recovery model

When the goal cannot be satisfied:

- do not silently relax a hard constraint;
- do not break locks;
- do not claim success;
- distinguish missing inventory from conflicting constraints;
- calculate the best valid facts in code;
- present one to three grounded compromise paths.

The agent should recommend the smallest useful relaxation, such as:

- increase the maximum budget by a known amount;
- allow an earlier departure;
- replace an unlocked travel or stay selection;
- remove or replace an activity.

Any alternative that unlocks an approved selection must contain an explicit lock-changing operation.

---

## 17. Adaptive UI philosophy

> **Schema-constrained adaptive composition; deterministic rendering.**

Code selects the interaction family from the domain outcome:

- alternatives → `OptionComparison`;
- proposed state change → `ChangeProposal`;
- unsatisfied constraints → `ConstraintConflict`.

Within the chosen contract, the model may provide:

- recommended candidate;
- relevant comparison dimensions;
- concise grounded summary;
- suggested follow-up actions.

The model may not invent components, JSX, props, layouts, styles, facts, or state mutations. Every comparative claim references a domain-produced fact. Invalid or unavailable model output uses deterministic semantic copy inside the same code-selected component family.

Stable product UI remains stable. Adaptive composition appears only around an immediate decision.

---

## 18. Design-system philosophy

Use a small purpose-built Cleartrip-inspired design system rather than a large generic component dependency.

Target:

- approximately seven core primitives;
- approximately six persistent travel components;
- three adaptive decision components;
- shared loading, unavailable, selected, recommended, locked, warning, and error states.

Do not turn the exercise into a standalone design-system project.

---

## 19. Demonstration matrix

The final walkthrough should prove behavior, not destination scripting.

### Flow A — Open-ended discovery

> Find a relaxed beach trip from Mumbai in October for four adults under ₹1.2 lakh. Avoid early flights.

Show grounded destination discovery, selective tool use, and a recommendation based on actual transport and stay observations.

### Flow B — Specified destination

> Plan four days in Udaipur from Delhi for two adults. Prioritize heritage experiences and a central stay.

Show the same planner producing a coherent trip without discovery.

### Flow C — Multi-stop planning

> Plan a seven-day Thailand trip from Bengaluru with a city stop and a quieter beach stop.

Show inventory-derived stops, night allocation, travel legs, transfers, and whole-trip validation. Thailand is a demonstration request, not a special architecture.

### Flow D — Scoped modification

> Find a cheaper hotel for the second stop, but keep the flights and first hotel.

Show targeted search, exact delta, transfer impact, preserved IDs, and approval before commit.

### Flow E — Constraint conflict

After explicitly locking consequential selections:

> Get the trip under ₹1.4 lakh.

Show an honest conflict with grounded, typed compromise proposals.

### Flow F — Data-only extensibility

Run the base planning flow against another seeded market and verify that no agent, domain, API, or UI branch changes.

---

## 20. P0 scope

P0 must include:

- structured and natural-language intake;
- deterministic required-field clarification;
- one optional model-prioritized clarification;
- specified, broad-scope, and open-ended destination intent;
- pre-seeded read-only relational inventory;
- 10 Indian and 10 international markets;
- normalized location discovery;
- transport, stay, activity, and transfer searches through typed API contracts;
- one bounded travel-planner model;
- model-chosen typed tool plans;
- bounded evidence refinement and validation repair;
- hard-constraint filtering and grounded facts;
- contextual model recommendation among valid candidates;
- single-stop and inventory-supported multi-stop plans;
- canonical versioned `TripState`;
- explicit selection locks;
- derived itinerary and budget;
- Itinerary, Travel, Stays, and Activities views;
- scoped modification and proposal approval;
- constraint conflict and recovery;
- grounded explanations;
- three schema-constrained adaptive interaction families;
- loading, no-result, unsupported-coverage, API-failure, and invalid-model states;
- database migrations, deterministic seed, contract tests, and deployment checks;
- Vercel deployment.

---

## 21. P1 and P2

### P1 — after P0 is stable

- inline “Why this?” affordance;
- undo the last trip version;
- richer proposal diff animation;
- expanded comparison details;
- improved loading and empty-state polish.

### P2 — only if time remains

- participant-specific activity participation;
- alternate activities for a subset of travellers;
- lightweight map visualization using stored coordinates;
- richer motion.

---

## 22. Explicitly out of scope

Do not build during P0:

- authentication;
- real booking, ticketing, or payment;
- loyalty;
- private or live travel supplier APIs;
- inventory administration UI;
- runtime inventory writes;
- supplier synchronization;
- real dynamic airline pricing;
- detailed room allocation;
- live weather;
- visa or legal advice;
- currency conversion;
- real maps or routing;
- group voting or collaboration;
- full mobile experience;
- traveller joins/leaves;
- split itineraries;
- RAG or vector search;
- MCP;
- multiple agents;
- unbounded autonomous loops;
- arbitrary generated JSX;
- destinations outside the declared seed manifest.

---

## 23. Data integrity and trust

Synthetic inventory must be internally coherent and clearly labeled.

Requirements:

- every selected item has a stable inventory or dated-offer ID;
- all prices declare currency and pricing unit;
- all date/time values declare location timezone semantics;
- all transfers reference normalized location IDs;
- every comparative claim resolves to supplied fact IDs;
- the same normalized search and inventory version produce the same candidates;
- a database failure never becomes an invented fallback itinerary;
- local image assets or stable asset keys are preferred over fragile scraped URLs.

The product may provide deterministic copy fallback, but the primary planning path must visibly use the travel-planner model. Reliability must not be simulated by secretly replacing the agent with a scripted destination flow.

---

## 24. What success looks like

A reviewer should be able to see that:

1. Users can begin naturally without completing a long form.
2. The agent takes different useful actions for different goals.
3. Open-ended intent can become a grounded destination recommendation.
4. Search evidence can alter an initial hypothesis.
5. Every selection comes from API-backed inventory.
6. The resulting trip is coherent across travel, stays, activities, transfers, dates, and budget.
7. A local request does not unexpectedly rewrite the trip.
8. Locks and hard constraints are enforced outside the model.
9. Conflict alternatives are concrete and honest.
10. The workspace makes AI decisions inspectable and reversible.
11. The UI is consistent and intentionally designed.
12. Adding a seeded destination does not require destination-specific product code.

---

## 25. Implementation rules

When implementing:

- treat these two documents as the source of truth;
- keep inventory deterministic and read-only at runtime;
- keep inventory database state separate from client-session trip/proposal state;
- never import seed data into UI or agent modules;
- route all inventory access through typed inventory services;
- let public REST handlers and agent tools share that service rather than making the server call its own HTTP routes;
- preserve meaningful model planning and bounded tool choice;
- do not let the model own inventory, calculations, constraints, locks, validation, component selection, or state mutation;
- avoid opaque universal recommendation scores;
- do not duplicate itinerary, budget, badges, proposal previews, or inventory facts as canonical state;
- use stable normalized IDs across database, API, domain, and UI contracts;
- prefer explicit vertical slices over speculative abstractions;
- report a specification conflict before inventing a materially different architecture.
