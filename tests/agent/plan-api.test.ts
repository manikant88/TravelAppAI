import { describe, expect, it, vi } from "vitest";
import type { SpecifiedDestinationPlannerModel } from "@/agent/coordinator";
import {
  runSpecifiedPlanApi,
  type SpecifiedPlanApiDependencies,
} from "@/agent/plan-api";
import type { PlannableTripRequest, TripState } from "@/domain/model";
import type { TripProjection } from "@/domain/trip";
import type { createInventoryRepository } from "@/inventory/repository";

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "city:udaipur" },
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  travellers: [{ id: "traveller:1", type: "adult" }],
  preferences: { pace: "balanced", interests: ["heritage"] },
  constraints: [],
};

const projection: TripProjection = {
  hydratedSelections: [],
  budget: {
    total: { amount: 0, currency: "INR" },
    breakdown: {
      travel: { amount: 0, currency: "INR" },
      stays: { amount: 0, currency: "INR" },
      activities: { amount: 0, currency: "INR" },
    },
  },
  itinerary: [],
  validation: { valid: true, issues: [] },
  badgesByCandidateId: {},
};

const trip: TripState = {
  id: "trip:udaipur",
  inventoryVersion: "travel-seed-v1",
  request,
  route: {
    marketId: "city:udaipur",
    stops: [
      {
        locationId: "city:udaipur",
        checkIn: "2026-10-10",
        checkOut: "2026-10-12",
      },
    ],
  },
  selectedTravel: [],
  selectedStays: [],
  selectedActivities: [],
  version: 1,
};

const unusedModel: SpecifiedDestinationPlannerModel = {
  async createPlanningHypothesis() {
    throw new Error("Unexpected model call");
  },
  async chooseNextAction() {
    throw new Error("Unexpected model call");
  },
};

function repository() {
  return {
    getPlannerCatalog: vi.fn(async () => ({
      inventoryVersion: "travel-seed-v1",
      locationGraph: [
        { id: "city:delhi", timezone: "Asia/Kolkata" },
        { id: "city:udaipur", timezone: "Asia/Kolkata" },
      ],
      marketIds: ["city:udaipur"],
      supportedThemes: ["heritage"],
    })),
  } as unknown as ReturnType<typeof createInventoryRepository>;
}

describe("specified PLAN API service", () => {
  it("loads canonical catalog scope and maps a valid coordinator result", async () => {
    const coordinator = vi.fn(async () => ({
      status: "completed" as const,
      trip,
      projection,
      trace: {
        hypothesis: {} as never,
        actions: [],
        executedCalls: [],
        validationAttempts: [projection.validation],
        finalBudget: {
          evidenceRoundsUsed: 1,
          repairRoundsUsed: 0,
          searchCallsUsed: 3,
          optionalClarificationUsed: false,
          priorCallSignatures: new Set<string>(),
        },
      },
    }));
    const dependencies: SpecifiedPlanApiDependencies = {
      model: unusedModel,
      repository: repository(),
      coordinator,
    };

    const result = await runSpecifiedPlanApi(
      { tripId: "trip:udaipur", request },
      dependencies,
    );

    expect(result.type).toBe("trip_ready");
    expect(coordinator).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: "trip:udaipur",
        request,
        expectedInventoryVersion: "travel-seed-v1",
      }),
    );
    if (result.type === "trip_ready") {
      expect(result.actionSummary).toEqual([
        "Used 3 grounded inventory searches",
        "Validated the assembled trip 1 time",
      ]);
    }
  });

  it("rejects open destinations and unknown locations before model planning", async () => {
    await expect(
      runSpecifiedPlanApi(
        {
          tripId: "trip:open",
          request: { ...request, destination: { kind: "open" } },
        },
        { model: unusedModel, repository: repository() },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });

    await expect(
      runSpecifiedPlanApi(
        { tripId: "trip:unknown", request: { ...request, origin: "city:unknown" } },
        { model: unusedModel, repository: repository() },
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_LOCATION", status: 400 });
  });

  it("does not expose an invalid trip after the single repair is exhausted", async () => {
    const invalidProjection: TripProjection = {
      ...projection,
      validation: {
        valid: false,
        issues: [
          {
            id: "issue:route",
            code: "ROUTE_GAP",
            severity: "error",
            message: "Return transport is missing",
          },
        ],
      },
    };
    const coordinator = vi.fn(async () => ({
      status: "invalid_after_repair" as const,
      trip,
      projection: invalidProjection,
      trace: {} as never,
    }));

    const result = await runSpecifiedPlanApi(
      { tripId: "trip:udaipur", request },
      { model: unusedModel, repository: repository(), coordinator },
    );

    expect(result).toMatchObject({
      type: "conflict",
      reason: "invalid_after_repair",
      validation: invalidProjection.validation,
    });
    expect(result).not.toHaveProperty("trip");
  });
});
