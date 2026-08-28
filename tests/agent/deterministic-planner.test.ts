import { describe, expect, it } from "vitest";
import { createDeterministicPlannerModel } from "@/agent/deterministic-planner";
import { runSpecifiedPlanApi } from "@/agent/plan-api";
import { createSnapshotInventoryRepository } from "@/inventory/snapshot-repository";

const request = {
  tripId: "trip:fallback-goa",
  request: {
    origin: "city:delhi",
    destination: { kind: "specified" as const, locationId: "city:goa" },
    startDate: "2026-09-10",
    endDate: "2026-09-14",
    travellers: [{ id: "traveller:1", type: "adult" as const }],
    preferences: { pace: "balanced" as const, interests: ["beaches", "food"] },
    constraints: [],
  },
};

describe("deterministic PLAN fallback", () => {
  it("assembles a valid dated trip from the bundled inventory without a model service", async () => {
    const result = await runSpecifiedPlanApi(
      request,
      {
        model: createDeterministicPlannerModel(),
        modelMode: "deterministic_fallback",
        repository: createSnapshotInventoryRepository(),
      },
    );

    expect(result.type).toBe("trip_ready");
    if (result.type !== "trip_ready") return;
    expect(result.planningMode).toBe("deterministic_fallback");
    expect(result.projection.validation.valid).toBe(true);
    expect(result.trip.selectedTravel).toHaveLength(2);
    expect(result.trip.selectedStays).toHaveLength(1);
    expect(result.trip.selectedActivities.length).toBeGreaterThan(0);
  });

  it("re-runs the bounded workflow with deterministic selection when the primary model fails", async () => {
    const result = await runSpecifiedPlanApi(request, {
      model: {
        async createPlanningHypothesis() { throw new Error("model unavailable"); },
        async chooseNextAction() { throw new Error("model unavailable"); },
      },
      fallbackModel: createDeterministicPlannerModel(),
      repository: createSnapshotInventoryRepository(),
    });

    expect(result.type).toBe("trip_ready");
    if (result.type === "trip_ready") expect(result.planningMode).toBe("deterministic_fallback");
  });
});
