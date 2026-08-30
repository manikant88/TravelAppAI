# Razorpay Design Exercise — Presentation Outline

## Communication job

By the end, the reviewer should believe this is a thoughtful, working AI planning prototype—not a chatbot wrapped around travel cards—because it turns a natural-language brief into a grounded, editable itinerary while preserving user intent and making trade-offs visible.

## Honest assessment

### What is strongest

- **Prototype depth:** the product covers discovery, destination comparison, itinerary assembly, stays, travel, activities, budget, day-by-day review, and scoped changes.
- **Grounded behavior:** snapshot inventory makes the demo repeatable. Deterministic code owns dates, prices, availability, route arithmetic, validation, and mutations.
- **AI used where it helps:** language interpretation, intent clarification, explanations, and communication are bounded; the model is not allowed to invent inventory or mutate the itinerary directly.
- **Control and trust:** users can inspect a persistent itinerary, preserve accepted selections, request local changes, see affected areas highlighted, and recover from constraints in conversation.
- **Craft:** the workspace combines chat with a structured plan, destination comparison cards, image loading states, responsive editors, day navigation, totals, and motion.

### What is weakest or riskiest

- **User research evidence is the largest rubric risk (20%).** The product docs contain a useful qualitative synthesis, but the deck must not imply that it came from participants unless you have actual notes. Add 5–6 genuine conversations, or label these as hypotheses and show exactly how you would validate them.
- **Exploration/divergence is not yet visible.** Show two or three real alternatives you considered and the trade-off that led to the workspace direction. Do not fabricate a design process that did not happen.
- **AI can still look like decoration.** In the demo, emphasize a real intent change: “make the stay cheaper but preserve travel,” or “add two activities on day 3.” Show what stays fixed, what changes, and why.
- **Communication needs to feel as strong as the execution.** The architecture is bounded and reliable, but generic copy, delayed feedback, or old approval language can make the experience feel mechanical. Use the latest interaction behavior in the demo and acknowledge this as an area still being refined.
- **This is not live booking.** Inventory is synthetic snapshot data and the prototype stops at a reviewable handoff. Frame that as a deliberate reliability boundary, not as live availability or bookable pricing.

## Recommended deck: 9 slides

### 1. A living trip plan that adapts without forgetting what matters

**On slide**

> Planning a multi-day trip is a coordination problem, not a search problem.

Show one clean hero screenshot of the workspace: conversation on the left, structured itinerary on the right.

**Talk track**

“I designed a Cleartrip-inspired workspace where conversation is the input, but the trip itself is a persistent, reviewable artifact.”

### 2. The real job is making the pieces work together

**On slide**

- Dates affect usable days
- Travel affects hotel and activity timing
- Budget spans categories
- Preferences and mobility affect the whole route

**Talk track**

“Existing travel products help users find individual pieces. The difficult work is coordinating the pieces without making the user restart every time something changes.”

Use the primary archetype: a constraint-heavy planner coordinating a family, couple, or group trip.

### 3. Research became product principles

**On slide**

Use only verified research. Replace the placeholders below with your real notes:

| What I heard | Design response |
|---|---|
| “I don’t want to re-check the whole trip after one change.” | Local, scoped edits with preserved selections |
| [real observation] | [resulting decision] |
| [real observation] | [resulting decision] |

Footer: **[N] conversations · [dates/method] · [one representative quote]**

**Talk track**

“The key pattern was not ‘people want an AI chatbot.’ It was that they want help with coordination while retaining control over consequential choices.”

If you did not conduct interviews, say: “These are hypotheses from the brief and prototype testing, and I would validate them next.”

### 4. Three directions, one deliberate choice

**On slide**

1. **Chat-only planner** — natural, but hard to review a multi-day plan.
2. **Traditional search and form flow** — familiar, but pushes coordination back to the user.
3. **Conversation + living workspace** — natural input with structured review and control.

Highlight direction 3 and state the trade-off: more interface complexity, much better reviewability and trust.

**Talk track**

“The workspace direction won because it gives the AI room to act while giving the user a stable object to inspect and edit.”

### 5. AI interprets; the system stays in control

**On slide**

```text
Natural-language brief
        ↓
Intent + missing facts
        ↓
Grounded snapshot inventory
        ↓
Deterministic plan, pricing, and validation
        ↓
Editable itinerary + explanation
```

Call out: **Code owns truth. AI helps with language, intent, and bounded recommendations.**

**Talk track**

“The model never writes SQL, invents an offer, or constructs the canonical trip. That boundary is what makes the demo repeatable and explainable.”

### 6. The experience is a loop, not a one-shot answer

**On slide**

1. Describe the trip naturally
2. Resolve missing facts with grounded choices
3. Compare valid destinations
4. Review the assembled itinerary
5. Ask for a scoped change
6. Inspect what changed and what was preserved

Use a short storyboard or six screenshots; keep each caption to one sentence.

**Talk track**

Walk through one scenario end to end: “Plan a 5-day Goa trip under ₹80,000,” then “find a cheaper stay but preserve my travel selections.”

### 7. Trust is designed into the interaction

**On slide**

- Progress messages explain the current operation without exposing hidden chain-of-thought.
- Affected fields, days, cards, and totals receive a focused visual state.
- Chat explains the result in plain language and offers grounded next actions.
- Errors stay in the conversation with recovery options.
- Initial planning motion establishes activity; later edits use shorter, contextual progress.

**Talk track**

“The goal is not to pretend the system is thinking like a person. It is to make the work legible: what is being checked, what changed, and what the user can do next.”

### 8. Control survives real trade-offs

**On slide**

Show a before/after modification:

- Request: **“Find a cheaper stay, preserve my travel.”**
- Preserved: dates, route, locked travel selection
- Changed: stay offer
- Recomputed: stay subtotal and trip total
- If impossible: explain why and offer the nearest valid alternatives

Also show the “add two activities on day 3” scenario, including the selected activities and the updated day total.

**Talk track**

“A local request should create a local change. The user should not have to re-approve unrelated parts of the trip.”

### 9. What I built, what I would improve next

**On slide**

**Built for the exercise**

- Snapshot-backed, repeatable demo inventory
- Multi-day itinerary with travel, stays, activities, totals, and images
- Destination comparison and guided missing-fact resolution
- Scoped modifications, locks, validation, progress, focus states, and recovery

**Deliberate boundaries**

- Synthetic inventory; not live bookable supply
- Reviewable handoff; no payment or booking flow
- AI is bounded to interpretation and communication

**Next**

- Validate assumptions with real participants
- Complete communication coverage for every final response
- Add live supplier adapters behind the same deterministic domain boundary

**Closing line**

“The product is not an AI that takes over travel planning. It is a trip workspace that lets AI do the coordination work while the user remains oriented and in control.”

## Suggested 4-minute demo script

1. Start with a natural brief containing origin, destination, dates, travellers, budget, and preferences.
2. Show the initial planning progress and the first grounded itinerary.
3. Change one local constraint: “find a cheaper stay but preserve my travel selections.”
4. Point to the focus state, chat explanation, changed stay, preserved travel, and updated total.
5. Ask: “Add two activities on day 3: one outdoor adventure and one food/market experience.”
6. Show the day focus, activity selection, updated day, and updated total.
7. Trigger one constrained or missing-fact case and show the conversational recovery path.

## Claims to avoid

- Do not claim user research, participant counts, or quotes unless you have the evidence.
- Do not claim live prices, live availability, or a completed booking.
- Do not say the LLM controls inventory or directly mutates the itinerary.
- Do not describe internal proposal mechanics as extra user-facing workspace states.
- Do not overclaim autonomy; say “bounded, deterministic execution with AI-assisted interpretation and communication.”

## Submission checklist

- [ ] Replace all research placeholders with real notes, or label them as hypotheses.
- [ ] Capture one clean initial-plan screenshot and two modification screenshots.
- [ ] Record the demo with the browser console hidden.
- [ ] Show one successful path and one recovery path.
- [ ] Ensure the deck names the synthetic snapshot boundary clearly.
- [ ] Keep the final deck to 9 slides plus an optional appendix for architecture/tests.
