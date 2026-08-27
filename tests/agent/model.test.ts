import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import type { StructuredResponseRunner } from "@/agent/model";
import { createOpenAIPlannerModel } from "@/agent/model";
import type { PlannerDecisionInput } from "@/agent/coordinator";
import type { PlannableTripRequest } from "@/domain/model";

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "city:udaipur" },
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  travellers: [{ id: "traveller:1", type: "adult" }],
  preferences: { pace: "balanced", interests: ["heritage"] },
  constraints: [],
};

const hypothesis = {
  goalSummary: "A balanced Udaipur trip",
  destinationMode: "specified" as const,
  candidateMarketIds: ["city:udaipur"],
  proposedStopIds: ["city:udaipur"],
  nightAllocation: [2],
  preferenceOrder: ["price" as const, "timing" as const],
  preserveSelectionIds: [],
  toolPlan: {
    operationalSummary: "Retrieve the core trip inventory",
    calls: [
      {
        id: "call:outbound",
        tool: "search_transport" as const,
        purpose: "Find outbound travel",
        from: "city:delhi",
        to: "city:udaipur",
        tripDayNumber: 1,
      },
    ],
  },
};

describe("schema-constrained OpenAI planner model", () => {
  it("uses the planning hypothesis schema and canonical request only", async () => {
    const requests: Array<{ schemaName: string; input: string }> = [];
    const runner: StructuredResponseRunner = {
      async run(call) {
        expect(() => zodTextFormat(call.schema, call.schemaName)).not.toThrow();
        requests.push({ schemaName: call.schemaName, input: call.input });
        return hypothesis;
      },
    };
    const model = createOpenAIPlannerModel({ model: "test-model", runner });

    const catalogScope = {
      locationGraph: [{ id: "city:udaipur" }],
      marketIds: ["city:udaipur"],
      supportedThemes: ["heritage"],
    };
    await expect(
      model.createPlanningHypothesis({ request, catalogScope }),
    ).resolves.toEqual(hypothesis);
    expect(requests[0]?.schemaName).toBe("travel_planning_hypothesis");
    expect(JSON.parse(requests[0]?.input ?? "{}")).toEqual({
      canonicalRequest: request,
      catalogScope,
    });
  });

  it("wraps the action union in a strict root object and serializes budget sets", async () => {
    const requests: Array<{ schemaName: string; input: string }> = [];
    const runner: StructuredResponseRunner = {
      async run(call) {
        expect(() => zodTextFormat(call.schema, call.schemaName)).not.toThrow();
        requests.push({ schemaName: call.schemaName, input: call.input });
        return { action: { type: "clarify", topic: "budget" } };
      },
    };
    const model = createOpenAIPlannerModel({ model: "test-model", runner });
    const input: PlannerDecisionInput = {
      phase: "after_evidence_round_1",
      request,
      hypothesis,
      observations: [],
      factBundles: [],
      budget: {
        evidenceRoundsUsed: 1,
        repairRoundsUsed: 0,
        searchCallsUsed: 1,
        optionalClarificationUsed: false,
        priorCallSignatures: new Set(["signature:b", "signature:a"]),
      },
    };

    await expect(model.chooseNextAction(input)).resolves.toEqual({
      type: "clarify",
      topic: "budget",
    });
    expect(requests[0]?.schemaName).toBe("travel_planner_next_action");
    expect(JSON.parse(requests[0]?.input ?? "{}").budget.priorCallSignatures).toEqual([
      "signature:a",
      "signature:b",
    ]);
  });

  it("rejects structured output that still violates domain refinements", async () => {
    const runner: StructuredResponseRunner = {
      async run() {
        return { ...hypothesis, nightAllocation: [] };
      },
    };
    const model = createOpenAIPlannerModel({ model: "test-model", runner });

    await expect(
      model.createPlanningHypothesis({
        request,
        catalogScope: {
          locationGraph: [{ id: "city:udaipur" }],
          marketIds: ["city:udaipur"],
          supportedThemes: ["heritage"],
        },
      }),
    ).rejects.toThrow(
      "Every proposed stop requires one night allocation",
    );
  });
});
