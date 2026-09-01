import { describe, expect, it } from "vitest";
import { contextualizedMessage } from "@/agent/conversation-routing";
import {
  buildConversationContext,
  deriveActiveInteraction,
} from "@/agent/conversation-context";
import type { TripRequest } from "@/domain/model";

describe("committed conversation context", () => {
  it("combines a day qualifier with the latest actionable user request", () => {
    expect(contextualizedMessage("for day 2", [
      { role: "user", text: "make this cheaper" },
      { role: "assistant", text: "Please include its day or exact card name." },
    ])).toBe("make this cheaper for day 2");
  });

  it("does not rewrite a complete new request", () => {
    expect(contextualizedMessage("What's the weather like in Goa?", [
      { role: "user", text: "make this cheaper" },
    ])).toBe("What's the weather like in Goa?");
  });
});

describe("durable active interaction context", () => {
  const request: TripRequest = {
    destination: { kind: "specified", locationId: "city:manali" },
    startDate: "2026-12-01",
    endDate: "2026-12-04",
    travellers: [{ id: "traveller:1", type: "adult" }],
    preferences: {},
    constraints: [],
  };

  it("retains the awaited field and exact actions separately from presentation", () => {
    const activeInteraction = deriveActiveInteraction(request, {
      message: "Where will you be travelling from?",
      events: [{
        id: "event:origin",
        type: "fact_missing",
        status: "active",
        label: "Starting city needed",
        target: { type: "trip_field", field: "origin" },
      }],
      actions: [{
        id: "action:delhi",
        type: "set_location",
        field: "origin",
        locationId: "city:delhi",
        label: "Delhi",
      }],
    });

    expect(activeInteraction).toMatchObject({
      mode: "build",
      task: "complete_trip_brief",
      awaitingFields: ["origin"],
      availableActions: [{ locationId: "city:delhi" }],
    });
    expect(buildConversationContext(
      Array.from({ length: 10 }, (_, index) => ({ role: "user" as const, text: `turn ${index}` })),
      activeInteraction,
    ).history).toHaveLength(8);
  });

  it("marks an open destination as exploration instead of committed planning", () => {
    const activeInteraction = deriveActiveInteraction(
      { ...request, destination: { kind: "open" } },
      { message: "Let's explore", events: [], actions: [] },
    );
    expect(activeInteraction).toMatchObject({
      mode: "explore",
      task: "discover_destinations",
    });
  });

  it("keeps a flexible date window in exploration until exact dates are chosen", () => {
    const activeInteraction = deriveActiveInteraction(
      {
        ...request,
        startDate: undefined,
        endDate: undefined,
        dateWindow: {
          kind: "flexible_window",
          earliestStart: "2026-11-01",
          latestEnd: "2026-11-30",
          durationDays: 4,
          label: "November 2026",
        },
      },
      { message: "Choose dates", events: [], actions: [] },
    );
    expect(activeInteraction.mode).toBe("explore");
  });
});
