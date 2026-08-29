import { describe, expect, it } from "vitest";
import { classifyCommittedConversation } from "@/agent/conversation-routing";
const trip = {
  request: { origin: "city:delhi", startDate: "2026-08-29", endDate: "2026-08-31" },
  route: { marketId: "city:puducherry", stops: [{ locationId: "city:puducherry" }] },
};

describe("committed conversation routing", () => {
  it("routes itinerary facts to deterministic explanation", () => {
    expect(classifyCommittedConversation("What time does my flight arrive?", trip)).toBe("explain_trip");
    expect(classifyCommittedConversation("Why was this stay selected?", trip)).toBe("explain_trip");
  });

  it("routes contextual place questions away from the deterministic trip summary", () => {
    expect(classifyCommittedConversation("what's weather like in puducherry", trip)).toBe("travel_context");
    expect(classifyCommittedConversation("Tell me about Puducherry", trip)).toBe("travel_context");
  });

  it("keeps mutations and grounded suggestions explicit", () => {
    expect(classifyCommittedConversation("Remove the day 2 activity", trip)).toBe("modify_trip");
    expect(classifyCommittedConversation("Suggest more activities near the hotel", trip)).toBe("activity_suggestion");
  });

  it("rejects unrelated requests", () => {
    expect(classifyCommittedConversation("Write a sorting algorithm", trip)).toBe("unsupported");
  });
});
