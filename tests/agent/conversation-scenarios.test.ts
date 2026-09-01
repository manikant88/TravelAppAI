import { describe, expect, it } from "vitest";
import {
  conversationIntentSchema,
  conversationRequestSchema,
} from "@/agent/conversation-contracts";
import { interactionPresentationSchema } from "@/agent/interaction-contracts";
import {
  classifyCommittedConversation,
  contextualizedMessage,
} from "@/agent/conversation-routing";
import {
  requestedTripExtension,
  resolvePresentedActionId,
  verifiedDraftFacts,
} from "@/agent/conversation-orchestrator.server";

const trip = {
  request: { origin: "city:delhi", startDate: "2026-10-10", endDate: "2026-10-13" },
  route: { marketId: "city:goa", stops: [{ locationId: "city:goa" }] },
};

describe("conversation scenario evaluation baseline", () => {
  it.each([
    ["Make the whole trip possible within ₹1.5 lakh", "modify_trip"],
    ["Could we use a quieter hotel instead?", "modify_trip"],
    ["Why does day 2 cost more?", "explain_trip"],
    ["What is Goa usually like in October?", "travel_context"],
    ["Suggest something relaxed near the hotel", "activity_suggestion"],
    ["Thank you", "conversational"],
    ["Write a sorting algorithm", "unsupported"],
  ] as const)("keeps a deterministic fallback for: %s", (message, expected) => {
    expect(classifyCommittedConversation(message, trip)).toBe(expected);
  });

  it("carries a clarification over a short follow-up without rewriting a complete request", () => {
    expect(contextualizedMessage("for day 3", [
      { role: "user", text: "Add a relaxed activity" },
      { role: "assistant", text: "Which day should I use?" },
    ])).toBe("Add a relaxed activity for day 3");
  });

  it("rejects model routing outside the bounded intent vocabulary", () => {
    expect(conversationIntentSchema.safeParse({ intent: "book_flight", actionId: null }).success).toBe(false);
  });

  it("resolves an ordinal only against the currently presented actions", () => {
    const actions = [
      { id: "action:first", type: "keep_current" as const, label: "Keep the current schedule" },
      { id: "action:second", type: "apply_proposal" as const, proposalId: "proposal:two", label: "Add the evening market" },
    ];
    expect(resolvePresentedActionId("the second one", actions)).toBe("action:second");
    expect(resolvePresentedActionId("the third one", actions)).toBeUndefined();
  });

  it("accepts only a supplied typed action reference from model routing", () => {
    expect(conversationIntentSchema.safeParse({
      intent: "select_presented_action",
      actionId: "action:second",
    }).success).toBe(true);
  });

  it.each([
    ["Extend the trip by one day", 1],
    ["Add two more days", 2],
    ["Include 3 days", 3],
  ] as const)("extracts a bounded trip extension from: %s", (message, expected) => {
    expect(requestedTripExtension(message)).toBe(expected);
  });

  it("requires a client turn id and bounds the supplied conversation history", () => {
    const base = {
      phase: "draft" as const,
      clientTurnId: "turn:test",
      message: "Delhi",
      currentRequest: { travellers: [], preferences: {}, constraints: [] },
      context: { history: [] },
    };
    expect(conversationRequestSchema.safeParse(base).success).toBe(true);
    expect(conversationRequestSchema.safeParse({ ...base, clientTurnId: "" }).success).toBe(false);
    expect(conversationRequestSchema.safeParse({
      ...base,
      context: {
        history: Array.from({ length: 9 }, (_, index) => ({ role: "user", text: `turn ${index}` })),
      },
    }).success).toBe(false);
  });

  it("gives the draft copywriter canonical locations rather than unverified prompt claims", () => {
    const base = {
      request: { travellers: [{ id: "traveller:1", type: "adult" as const }], preferences: {}, constraints: [] },
      resolvedLocations: {},
      appliedFields: ["travellers" as const],
      missingRequired: ["origin" as const, "destination_intent" as const, "dates" as const],
      suggestedDateRanges: [],
      issues: [],
      message: "Complete the remaining details.",
    };

    expect(verifiedDraftFacts(base)).toEqual(["Verified travellers: 1 adult"]);
    expect(verifiedDraftFacts({
      ...base,
      request: {
        ...base.request,
        destination: { kind: "specified" as const, locationId: "city:tokyo" },
      },
      resolvedLocations: { destination: { id: "city:tokyo", label: "Tokyo" } },
      appliedFields: ["destination" as const, "travellers" as const],
      missingRequired: ["origin" as const, "dates" as const],
    })).toContain("Verified destination: Tokyo");
  });

  it("keeps pre-reason date recommendation actions readable during a rolling UI update", () => {
    expect(interactionPresentationSchema.safeParse({
      message: "How many days should the trip be?",
      events: [],
      actions: [{
        id: "dates:legacy",
        type: "request_date_recommendation",
        label: "Recommend dates in this window",
      }],
    }).success).toBe(true);
  });
});
