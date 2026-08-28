import { describe, expect, it, vi } from "vitest";
import type {
  AgentNextAction,
  PlanningHypothesis,
  ToolPlan,
} from "@/agent/contracts";
import {
  coordinateSpecifiedDestinationPlan,
  type PlannerDecisionInput,
  type SpecifiedPlanCoordinatorInput,
  type SpecifiedDestinationPlannerModel,
} from "@/agent/coordinator";
import type { InventoryToolServices } from "@/agent/executor";
import type { PlannableTripRequest } from "@/domain/model";
import type { ResolvedOffer } from "@/domain/trip";
import type {
  ActivityOffer,
  SearchResponse,
  StayOffer,
  TransportOffer,
} from "@/inventory/contracts";

const generatedAt = "2026-08-27T00:00:00.000Z";

function response<T>(queryId: string, results: T[]): SearchResponse<T> {
  return {
    queryId,
    inventoryVersion: "travel-seed-v1",
    results,
    resultCount: results.length,
    appliedFilters: [],
    coverage: results.length ? { status: "available" } : { status: "no_availability" },
    generatedAt,
  };
}

const outbound: TransportOffer = {
  id: "offer:transport:outbound",
  serviceId: "service:outbound",
  mode: "flight",
  from: "city:delhi",
  to: "city:udaipur",
  departureAt: "2026-10-10T08:00:00+05:30",
  arrivalAt: "2026-10-10T09:20:00+05:30",
  durationMinutes: 80,
  stops: 0,
  operator: "Example Air",
  segments: [
    {
      from: "city:delhi",
      to: "city:udaipur",
      departureAt: "2026-10-10T08:00:00+05:30",
      arrivalAt: "2026-10-10T09:20:00+05:30",
      operator: "Example Air",
    },
  ],
  price: { amount: 5_000, currency: "INR", unit: "per_traveller" },
};

const returning: TransportOffer = {
  ...outbound,
  id: "offer:transport:return",
  serviceId: "service:return",
  from: "city:udaipur",
  to: "city:delhi",
  departureAt: "2026-10-12T18:00:00+05:30",
  arrivalAt: "2026-10-12T19:20:00+05:30",
  price: { amount: 4_500, currency: "INR", unit: "per_traveller" },
  segments: [
    {
      from: "city:udaipur",
      to: "city:delhi",
      departureAt: "2026-10-12T18:00:00+05:30",
      arrivalAt: "2026-10-12T19:20:00+05:30",
      operator: "Example Air",
    },
  ],
};

const stay: StayOffer = {
  id: "offer:stay:udaipur",
  roomOfferId: "room:udaipur",
  propertyId: "property:udaipur",
  locationId: "city:udaipur",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  rooms: 1,
  propertyFacts: {
    name: "Udaipur House",
    rating: 4.4,
    reviewCount: 100,
    amenities: ["wifi"],
    accessibility: [],
    tags: [],
    imageAssetKey: "udaipur-house",
  },
  roomFacts: { roomLabel: "Double", maxOccupancy: 2, mealPlan: "breakfast", refundable: true },
  price: { amount: 3_000, currency: "INR", unit: "per_room_per_night" },
};

const activity: ActivityOffer = {
  id: "offer:activity:udaipur-heritage",
  activityId: "activity:udaipur-heritage",
  sessionId: "session:udaipur-heritage",
  locationId: "city:udaipur",
  startsAt: "2026-10-11T11:00:00+05:30",
  endsAt: "2026-10-11T13:00:00+05:30",
  capacity: 20,
  activityFacts: {
    name: "Udaipur heritage story",
    tags: ["heritage"],
    mobility: "low",
    childFriendly: true,
    seniorFriendly: true,
    imageAssetKey: "udaipur-heritage",
  },
  price: { amount: 500, currency: "INR", unit: "per_participant" },
};

const offers = new Map<string, ResolvedOffer>([
  [outbound.id, outbound],
  [returning.id, returning],
  [stay.id, stay],
  [activity.id, activity],
]);

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "city:udaipur" },
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  travellers: [
    { id: "traveller:1", type: "adult" },
    { id: "traveller:2", type: "adult" },
  ],
  preferences: { pace: "balanced", interests: ["heritage"] },
  constraints: [],
};

const outboundCall = {
  id: "call:outbound",
  tool: "search_transport" as const,
  purpose: "Find outbound travel",
  from: "city:delhi",
  to: "city:udaipur",
  tripDayNumber: 1,
};
const returnCall = {
  id: "call:return",
  tool: "search_transport" as const,
  purpose: "Find return travel",
  from: "city:udaipur",
  to: "city:delhi",
  tripDayNumber: 3,
};
const stayCall = {
  id: "call:stay",
  tool: "search_stays" as const,
  purpose: "Cover both nights",
  locationId: "city:udaipur",
  checkInDayNumber: 1,
  nights: 2,
};
const activityCall = {
  id: "call:activity",
  tool: "search_activities" as const,
  purpose: "Plan the full interior day",
  locationId: "city:udaipur",
  tripDayNumbers: [2],
  themes: ["heritage"],
};

function toolPlan(calls: ToolPlan["calls"]): ToolPlan {
  return { operationalSummary: "Retrieve a coherent Udaipur trip", calls };
}

function hypothesis(calls: ToolPlan["calls"]): PlanningHypothesis {
  return {
    goalSummary: "A balanced Udaipur trip",
    destinationMode: "specified",
    candidateMarketIds: ["city:udaipur"],
    proposedStopIds: ["city:udaipur"],
    nightAllocation: [2],
    preferenceOrder: ["price", "timing"],
    preserveSelectionIds: [],
    toolPlan: toolPlan(calls),
  };
}

function proposal(input: PlannerDecisionInput): AgentNextAction {
  const candidates = input.observations.flatMap((observation) => observation.candidates);
  const allowedDimensions = new Set(
    input.factBundles.flatMap((bundle) => bundle.allowedComparisonDimensions),
  );
  return {
    type: "propose_plan",
    marketId: "city:udaipur",
    stopIds: ["city:udaipur"],
    nightAllocation: [2],
    choices: candidates.map((candidate, index) => {
      const comparisonFact = candidate.facts.find((fact) =>
        allowedDimensions.has(fact.dimension),
      );
      if (!comparisonFact) throw new Error("Candidate has no allowed comparison fact");
      return {
        decisionId: `decision:${index}:${candidate.candidateId}`,
        candidateId: candidate.candidateId,
        supportingFactIds: [comparisonFact.id],
        comparisonDimensions: [comparisonFact.dimension],
      };
    }),
  };
}

function services(): InventoryToolServices {
  return {
    searchTransport: vi.fn(async (search) =>
      search.from === "city:delhi"
        ? response("query:outbound", [outbound])
        : response("query:return", [returning]),
    ),
    searchStays: vi.fn(async () => response("query:stay", [stay])),
    searchActivities: vi.fn(async () => response("query:activities", [activity])),
    searchTransfers: vi.fn(async () => response("query:transfers", [])),
  };
}

function model(
  plan: PlanningHypothesis,
  choose: (input: PlannerDecisionInput) => unknown,
): SpecifiedDestinationPlannerModel {
  return {
    createPlanningHypothesis: vi.fn(async () => plan),
    chooseNextAction: vi.fn(async (input) => choose(input)),
  };
}

function coordinatorInput(
  planner: SpecifiedDestinationPlannerModel,
  inventoryServices = services(),
): SpecifiedPlanCoordinatorInput {
  return {
    tripId: "trip:udaipur",
    request,
    locationGraph: [
      { id: "country:in" },
      { id: "city:delhi", parentId: "country:in" },
      { id: "city:udaipur", parentId: "country:in" },
    ],
    knownMarketIds: new Set(["city:udaipur"]),
    supportedThemes: new Set(["heritage"]),
    expectedInventoryVersion: "travel-seed-v1",
    model: planner,
    inventoryServices,
    async resolveOffer(offerId) {
      const offer = offers.get(offerId);
      if (!offer) throw new Error("Offer not found");
      return offer;
    },
  };
}

describe("bounded specified-destination PLAN coordinator", () => {
  it("completes after one evidence round and one valid assembly", async () => {
    const planner = model(
      hypothesis([outboundCall, returnCall, stayCall, activityCall]),
      (input) => proposal(input),
    );
    const result = await coordinateSpecifiedDestinationPlan(coordinatorInput(planner));

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.projection.validation.valid).toBe(true);
    expect(result.projection.budget.total).toEqual({ amount: 26_000, currency: "INR" });
    expect(result.trace.finalBudget).toMatchObject({
      evidenceRoundsUsed: 1,
      repairRoundsUsed: 0,
      searchCallsUsed: 4,
    });
    expect(result.trace.validationAttempts).toHaveLength(1);
  });

  it("allows one materially different second evidence round", async () => {
    const planner = model(
      hypothesis([outboundCall, stayCall, activityCall]),
      (input) => {
        if (input.phase === "after_evidence_round_1") {
          return { type: "search_more", toolPlan: toolPlan([returnCall]) };
        }
        return proposal(input);
      },
    );
    const result = await coordinateSpecifiedDestinationPlan(coordinatorInput(planner));

    expect(result.status).toBe("completed");
    expect(result.trace.finalBudget).toMatchObject({
      evidenceRoundsUsed: 2,
      repairRoundsUsed: 0,
      searchCallsUsed: 4,
    });
    expect(result.trace.actions.map((action) => action.type)).toEqual([
      "search_more",
      "propose_plan",
    ]);
  });

  it("uses structured validation feedback and at most one repair search", async () => {
    const phases: string[] = [];
    const planner = model(
      hypothesis([outboundCall, stayCall, activityCall]),
      (input) => {
        phases.push(input.phase);
        if (input.phase === "after_evidence_round_1") return proposal(input);
        if (input.phase === "repair_after_validation") {
          expect(input.validationFeedback?.validation.valid).toBe(false);
          expect(
            input.validationFeedback?.factBundle.facts.some(
              (fact) => fact.value === "ROUTE_GAP",
            ),
          ).toBe(true);
          return { type: "search_more", toolPlan: toolPlan([returnCall]) };
        }
        return proposal(input);
      },
    );
    const result = await coordinateSpecifiedDestinationPlan(coordinatorInput(planner));

    expect(result.status).toBe("completed");
    expect(phases).toEqual([
      "after_evidence_round_1",
      "repair_after_validation",
      "repair_after_search",
    ]);
    expect(result.trace.finalBudget).toMatchObject({
      evidenceRoundsUsed: 1,
      repairRoundsUsed: 1,
      searchCallsUsed: 4,
    });
    expect(result.trace.validationAttempts).toHaveLength(2);
    expect(result.trace.validationAttempts[0].valid).toBe(false);
    expect(result.trace.validationAttempts[1].valid).toBe(true);
  });

  it("stops after a second invalid assembly without another model loop", async () => {
    const planner = model(
      hypothesis([outboundCall, stayCall, activityCall]),
      (input) => proposal(input),
    );
    const result = await coordinateSpecifiedDestinationPlan(coordinatorInput(planner));

    expect(result.status).toBe("invalid_after_repair");
    expect(result.trace.validationAttempts).toHaveLength(2);
    expect(result.trace.finalBudget.repairRoundsUsed).toBe(1);
    expect(planner.chooseNextAction).toHaveBeenCalledTimes(2);
  });

  it("rejects repeated searches and supports a terminal optional clarification", async () => {
    const repeated = model(
      hypothesis([outboundCall, stayCall, activityCall]),
      () => ({ type: "search_more", toolPlan: toolPlan([outboundCall]) }),
    );
    await expect(
      coordinateSpecifiedDestinationPlan(coordinatorInput(repeated)),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT" });

    const clarification = model(
      hypothesis([outboundCall, returnCall, stayCall, activityCall]),
      () => ({ type: "clarify", topic: "pace" }),
    );
    const result = await coordinateSpecifiedDestinationPlan(coordinatorInput(clarification));
    expect(result.status).toBe("needs_optional_clarification");
    expect(result.trace.finalBudget.optionalClarificationUsed).toBe(true);
  });
});
