import { describe, expect, it, vi } from "vitest";
import type {
  FactBundle,
  PlannerBudgetState,
  PlannerToolCall,
} from "@/agent/contracts";
import {
  assembleProposedPlan,
  PlanAssemblyError,
  type PlanAssemblerInput,
  type ProposePlanAction,
} from "@/agent/assembler";
import type { ExecutedToolCall } from "@/agent/executor";
import type { PlannableTripRequest } from "@/domain/model";
import type { ResolvedOffer } from "@/domain/trip";
import type {
  ActivityOffer,
  StayOffer,
  TransferOffer,
  TransportOffer,
} from "@/inventory/contracts";

const outbound: TransportOffer = {
  id: "offer:transport:outbound",
  serviceId: "service:outbound",
  mode: "flight",
  from: "city:delhi",
  to: "airport:udr",
  departureAt: "2026-10-10T07:00:00+05:30",
  arrivalAt: "2026-10-10T08:20:00+05:30",
  durationMinutes: 80,
  stops: 0,
  operator: "Example Air",
  segments: [
    {
      from: "city:delhi",
      to: "airport:udr",
      departureAt: "2026-10-10T07:00:00+05:30",
      arrivalAt: "2026-10-10T08:20:00+05:30",
      operator: "Example Air",
    },
  ],
  price: { amount: 5_000, currency: "INR", unit: "per_traveller" },
};

const returning: TransportOffer = {
  ...outbound,
  id: "offer:transport:return",
  serviceId: "service:return",
  from: "airport:udr",
  to: "city:delhi",
  departureAt: "2026-10-12T18:00:00+05:30",
  arrivalAt: "2026-10-12T19:20:00+05:30",
  price: { amount: 4_500, currency: "INR", unit: "per_traveller" },
  segments: [
    {
      from: "airport:udr",
      to: "city:delhi",
      departureAt: "2026-10-12T18:00:00+05:30",
      arrivalAt: "2026-10-12T19:20:00+05:30",
      operator: "Example Air",
    },
  ],
};

const arrivalTransfer: TransferOffer = {
  id: "offer:transfer:arrival",
  transferId: "transfer:arrival",
  from: "airport:udr",
  to: "neighborhood:udaipur-old-city",
  mode: "car",
  durationMinutes: 45,
  capacity: 3,
  price: { amount: 1_200, currency: "INR", unit: "per_vehicle" },
};

const departureTransfer: TransferOffer = {
  ...arrivalTransfer,
  id: "offer:transfer:departure",
  transferId: "transfer:departure",
  from: "neighborhood:udaipur-old-city",
  to: "airport:udr",
};

const stay: StayOffer = {
  id: "offer:stay:old-city",
  roomOfferId: "room:old-city",
  propertyId: "property:old-city",
  locationId: "neighborhood:udaipur-old-city",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  rooms: 1,
  propertyFacts: {
    name: "Old City House",
    rating: 4.5,
    reviewCount: 120,
    amenities: ["wifi"],
    accessibility: [],
    tags: [],
    imageAssetKey: "old-city-house",
  },
  roomFacts: { roomLabel: "Double", maxOccupancy: 2, mealPlan: "breakfast", refundable: true },
  price: { amount: 3_000, currency: "INR", unit: "per_room_per_night" },
};

const activity: ActivityOffer = {
  id: "offer:activity:palace",
  activityId: "activity:palace",
  sessionId: "session:palace",
  locationId: "neighborhood:udaipur-old-city",
  startsAt: "2026-10-11T10:00:00+05:30",
  endsAt: "2026-10-11T12:00:00+05:30",
  capacity: 20,
  activityFacts: {
    name: "Palace walk",
    tags: ["heritage"],
    mobility: "low",
    childFriendly: true,
    seniorFriendly: true,
    imageAssetKey: "palace",
  },
  price: { amount: 500, currency: "INR", unit: "per_participant" },
};

const offers: ResolvedOffer[] = [
  outbound,
  returning,
  arrivalTransfer,
  departureTransfer,
  stay,
  activity,
];
const offerMap = new Map(offers.map((offer) => [offer.id, offer]));

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "city:udaipur" },
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  travellers: [
    { id: "traveller:1", type: "adult" },
    { id: "traveller:2", type: "adult" },
  ],
  preferences: { interests: ["heritage"], pace: "balanced" },
  constraints: [],
};

const locationGraph = [
  { id: "country:in" },
  { id: "city:delhi", parentId: "country:in" },
  { id: "city:udaipur", parentId: "country:in" },
  { id: "airport:udr", parentId: "city:udaipur" },
  { id: "neighborhood:udaipur-old-city", parentId: "city:udaipur" },
];

const calls: Array<{ call: PlannerToolCall; offer: ResolvedOffer }> = [
  {
    call: {
      id: "call:outbound",
      tool: "search_transport",
      purpose: "Find outbound travel",
      from: "city:delhi",
      to: "city:udaipur",
      tripDayNumber: 1,
    },
    offer: outbound,
  },
  {
    call: {
      id: "call:return",
      tool: "search_transport",
      purpose: "Find return travel",
      from: "city:udaipur",
      to: "city:delhi",
      tripDayNumber: 3,
    },
    offer: returning,
  },
  {
    call: {
      id: "call:arrival-transfer",
      tool: "search_transfers",
      purpose: "Connect airport to stay",
      from: "airport:udr",
      to: "neighborhood:udaipur-old-city",
    },
    offer: arrivalTransfer,
  },
  {
    call: {
      id: "call:departure-transfer",
      tool: "search_transfers",
      purpose: "Connect stay to airport",
      from: "neighborhood:udaipur-old-city",
      to: "airport:udr",
    },
    offer: departureTransfer,
  },
  {
    call: {
      id: "call:stay",
      tool: "search_stays",
      purpose: "Cover both nights",
      locationId: "neighborhood:udaipur-old-city",
      checkInDayNumber: 1,
      nights: 2,
    },
    offer: stay,
  },
  {
    call: {
      id: "call:activity",
      tool: "search_activities",
      purpose: "Find a heritage activity",
      locationId: "neighborhood:udaipur-old-city",
      tripDayNumbers: [2],
      themes: ["heritage"],
    },
    offer: activity,
  },
];

function subjectType(offer: ResolvedOffer) {
  if ("serviceId" in offer) return "transport" as const;
  if ("transferId" in offer) return "transfer" as const;
  if ("roomOfferId" in offer) return "stay" as const;
  return "activity" as const;
}

function executions(version = "travel-seed-v1"): ExecutedToolCall[] {
  return calls.map(({ call, offer }, index) => ({
    callId: call.id,
    call,
    inventoryVersion: version,
    observation: {
      queryId: `query:${index}`,
      toolName: call.tool,
      coverage: { status: "available" },
      candidates: [
        {
          candidateId: offer.id,
          facts: [
            {
              id: `fact:${index}`,
              subjectType: subjectType(offer),
              subjectId: offer.id,
              dimension: "price",
              label: "Grounded price fact",
              value: offer.price.amount,
            },
          ],
        },
      ],
      rejectedSummary: [],
    },
  }));
}

const factBundles: FactBundle[] = [
  {
    facts: [],
    allowedComparisonDimensions: ["price"],
    allowedFollowUpActions: [],
  },
];

const budget: PlannerBudgetState = {
  evidenceRoundsUsed: 1,
  repairRoundsUsed: 0,
  searchCallsUsed: 6,
  optionalClarificationUsed: false,
  priorCallSignatures: new Set(),
};

function action(candidateIds = offers.map((offer) => offer.id)): ProposePlanAction {
  return {
    type: "propose_plan",
    marketId: "city:udaipur",
    stopIds: ["neighborhood:udaipur-old-city"],
    nightAllocation: [2],
    choices: candidateIds.map((candidateId, index) => ({
      decisionId: `decision:${index}`,
      candidateId,
      supportingFactIds: [`fact:${offers.findIndex((offer) => offer.id === candidateId)}`],
      comparisonDimensions: ["price"],
    })),
  };
}

function input(overrides: Partial<PlanAssemblerInput> = {}): PlanAssemblerInput {
  return {
    tripId: "trip:udaipur",
    action: action(),
    request,
    executedCalls: executions(),
    factBundles,
    budget,
    locationGraph,
    knownMarketIds: new Set(["city:udaipur"]),
    supportedThemes: new Set(["heritage"]),
    expectedInventoryVersion: "travel-seed-v1",
    async resolveOffer(offerId) {
      const offer = offerMap.get(offerId);
      if (!offer) throw new Error("Offer not found");
      return offer;
    },
    ...overrides,
  };
}

describe("deterministic proposed-plan assembler", () => {
  it("creates canonical selections and a valid projected trip from grounded choices", async () => {
    const resolver = vi.fn(input().resolveOffer);
    const result = await assembleProposedPlan(input({ resolveOffer: resolver }));

    expect(result.status).toBe("valid");
    expect(result.trip).toMatchObject({
      id: "trip:udaipur",
      inventoryVersion: "travel-seed-v1",
      version: 0,
      route: {
        marketId: "city:udaipur",
        stops: [
          {
            locationId: "neighborhood:udaipur-old-city",
            checkIn: "2026-10-10",
            checkOut: "2026-10-12",
          },
        ],
      },
    });
    expect(result.trip.selectedTravel).toHaveLength(4);
    expect(result.trip.selectedStays).toHaveLength(1);
    expect(result.trip.selectedActivities).toHaveLength(1);
    expect(
      [
        ...result.trip.selectedTravel,
        ...result.trip.selectedStays,
        ...result.trip.selectedActivities,
      ].every((selection) => selection.locked === false),
    ).toBe(true);
    expect(result.projection.budget.total).toEqual({ amount: 28_400, currency: "INR" });
    expect(result.projection.validation).toEqual({ valid: true, issues: [] });
    expect(resolver).toHaveBeenCalledTimes(6);
  });

  it("produces stable selection IDs independent of model choice ordering", async () => {
    const first = await assembleProposedPlan(input());
    const reversedAction = action([...offers].reverse().map((offer) => offer.id));
    const second = await assembleProposedPlan(input({ action: reversedAction }));

    expect(second.trip.selectedTravel).toEqual(first.trip.selectedTravel);
    expect(second.trip.selectedStays).toEqual(first.trip.selectedStays);
    expect(second.trip.selectedActivities).toEqual(first.trip.selectedActivities);
  });

  it("returns a structured invalid result for deterministic repair instead of committing", async () => {
    const withoutDepartureTransfer = offers
      .filter((offer) => offer.id !== departureTransfer.id)
      .map((offer) => offer.id);
    const result = await assembleProposedPlan(
      input({ action: action(withoutDepartureTransfer) }),
    );

    expect(result.status).toBe("invalid");
    expect(result.projection.validation.valid).toBe(false);
    expect(result.projection.validation.issues).toContainEqual(
      expect.objectContaining({ code: "TRANSFER_CONFLICT", severity: "error" }),
    );
  });

  it("rejects mixed inventory versions and stale offer resolution", async () => {
    const mixed = executions();
    mixed[0] = { ...mixed[0], inventoryVersion: "travel-seed-v2" };
    await expect(assembleProposedPlan(input({ executedCalls: mixed }))).rejects.toMatchObject({
      code: "INVENTORY_VERSION_MISMATCH",
    });

    await expect(
      assembleProposedPlan(
        input({
          async resolveOffer(offerId) {
            if (offerId === stay.id) throw new Error("Offer inventory version is stale");
            return offerMap.get(offerId)!;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "OFFER_RESOLUTION_FAILED",
      details: { candidateId: stay.id },
    });
  });

  it("rejects duplicate candidates, ungrounded choices, and resolver type tampering", async () => {
    const duplicateAction = action();
    duplicateAction.choices.push({
      ...duplicateAction.choices[0],
      decisionId: "decision:duplicate",
    });
    await expect(
      assembleProposedPlan(input({ action: duplicateAction })),
    ).rejects.toMatchObject({ code: "DUPLICATE_CANDIDATE" });

    const ungrounded = action();
    ungrounded.choices[0] = {
      ...ungrounded.choices[0],
      supportingFactIds: ["fact:missing"],
    };
    await expect(assembleProposedPlan(input({ action: ungrounded }))).rejects.toMatchObject({
      code: "INVALID_ACTION",
    });

    await expect(
      assembleProposedPlan(
        input({
          async resolveOffer(offerId) {
            if (offerId === outbound.id) return { ...stay, id: outbound.id };
            return offerMap.get(offerId)!;
          },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PlanAssemblyError>>({
        code: "OFFER_TYPE_MISMATCH",
        details: { candidateId: outbound.id },
      }),
    );

    const inconsistent = executions();
    inconsistent[0] = {
      ...inconsistent[0],
      callId: "call:not-the-source-call",
    };
    await expect(
      assembleProposedPlan(input({ executedCalls: inconsistent })),
    ).rejects.toMatchObject({ code: "INVALID_ASSEMBLY_CONTEXT" });
  });
});
