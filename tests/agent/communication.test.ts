import { describe, expect, it } from "vitest";
import { applyCommunication, composeCommunication } from "@/agent/communication";
import type { CommunicationContext, InteractionPresentation } from "@/agent/interaction-contracts";

const context: CommunicationContext = {
  intent: "clarify",
  fallbackMessage: "Where are you leaving from?",
  facts: ["Origin is missing"],
  events: [{
    id: "event:origin",
    type: "fact_missing",
    status: "active",
    label: "Starting city needed",
    target: { type: "trip_field", field: "origin" },
  }],
  availableActions: [{
    id: "action:delhi",
    type: "set_location",
    field: "origin",
    locationId: "city:delhi",
    label: "Delhi",
  }],
};

describe("interaction communication", () => {
  it("uses deterministic copy when no model is configured", async () => {
    await expect(composeCommunication(context)).resolves.toEqual({
      message: context.fallbackMessage,
      actionLabels: [{ actionId: "action:delhi", label: "Delhi" }],
    });
  });

  it("rejects model-created actions and falls back", async () => {
    const result = await composeCommunication(context, {
      async compose() {
        return { message: "Invented", actionLabels: [{ actionId: "action:invented", label: "Do it" }] };
      },
    });
    expect(result.message).toBe(context.fallbackMessage);
    expect(result.actionLabels[0]?.actionId).toBe("action:delhi");
  });

  it("can rewrite labels without changing executable payloads", () => {
    const presentation: InteractionPresentation = {
      message: context.fallbackMessage,
      events: context.events,
      actions: context.availableActions,
    };
    const result = applyCommunication(presentation, {
      message: "Where should we start your trip?",
      actionLabels: [{ actionId: "action:delhi", label: "Start in Delhi" }],
    });
    expect(result.actions[0]).toMatchObject({
      type: "set_location",
      locationId: "city:delhi",
      label: "Start in Delhi",
    });
  });

  it("allows a complete grounded planning summary through the rewrite pass", async () => {
    const fallbackMessage = "I assembled two travel selections, the selected stay, and two schedule-valid activities into a connected itinerary. Both selected activities match the requested themes; nothing is scheduled before arrival, before check-in, or too close to departure. The validated trip total remains within the supplied budget.";
    expect(fallbackMessage.length).toBeGreaterThan(240);
    let modelCalled = false;
    const result = await composeCommunication(
      { ...context, fallbackMessage, facts: [fallbackMessage] },
      {
        async compose() {
          modelCalled = true;
          return { message: "Your trip is ready — the travel, stay, and activities now fit together comfortably within the supplied budget.", actionLabels: [] };
        },
      },
    );

    expect(modelCalled).toBe(true);
    expect(result.message).toContain("Your trip is ready");
  });
});
