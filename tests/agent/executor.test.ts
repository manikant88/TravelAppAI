import { describe, expect, it, vi } from "vitest";
import type { PlannerBudgetState, ToolPlan } from "@/agent/contracts";
import {
  executeToolPlan,
  PlannerToolExecutorError,
  type InventoryToolServices,
  type ToolExecutorContext,
} from "@/agent/executor";
import type { PlannableTripRequest } from "@/domain/model";
import type {
  ActivityOffer,
  SearchResponse,
  StayOffer,
  TransferOffer,
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
    coverage: results.length > 0 ? { status: "available" } : { status: "no_availability" },
    generatedAt,
  };
}

const transportOffer: TransportOffer = {
  id: "offer:transport:1",
  serviceId: "service:1",
  mode: "flight",
  from: "city:delhi",
  to: "city:udaipur",
  departureAt: "2026-10-11T08:30:00+05:30",
  arrivalAt: "2026-10-11T09:50:00+05:30",
  durationMinutes: 80,
  stops: 0,
  operator: "Example Air",
  segments: [
    {
      from: "city:delhi",
      to: "city:udaipur",
      departureAt: "2026-10-11T08:30:00+05:30",
      arrivalAt: "2026-10-11T09:50:00+05:30",
      operator: "Example Air",
    },
  ],
  price: { amount: 5_000, currency: "INR", unit: "per_traveller" },
};

const stayOffer: StayOffer = {
  id: "offer:stay:1",
  roomOfferId: "room:1",
  propertyId: "property:1",
  locationId: "neighborhood:udaipur-old-city",
  checkIn: "2026-10-10",
  checkOut: "2026-10-13",
  rooms: 2,
  propertyFacts: {
    name: "Old City House",
    rating: 4.4,
    reviewCount: 100,
    amenities: ["wifi", "breakfast"],
    accessibility: [],
    tags: [],
    imageAssetKey: "old-city",
  },
  roomFacts: { roomLabel: "Double", maxOccupancy: 2, mealPlan: "breakfast", refundable: true },
  price: { amount: 3_000, currency: "INR", unit: "per_room_per_night" },
};

function activityOffer(date: string, suffix: string): ActivityOffer {
  return {
    id: `offer:activity:${suffix}`,
    activityId: `activity:${suffix}`,
    sessionId: `session:${suffix}`,
    locationId: "neighborhood:udaipur-old-city",
    startsAt: `${date}T10:00:00+05:30`,
    endsAt: `${date}T12:00:00+05:30`,
    capacity: 20,
    activityFacts: {
      name: `Activity ${suffix}`,
      tags: ["culture", "heritage"],
      mobility: "low",
      childFriendly: true,
      seniorFriendly: true,
      imageAssetKey: `activity-${suffix}`,
    },
    price: { amount: 500, currency: "INR", unit: "per_participant" },
  };
}

const transferOffer: TransferOffer = {
  id: "offer:transfer:1",
  transferId: "transfer:1",
  from: "airport:udr",
  to: "neighborhood:udaipur-old-city",
  mode: "car",
  durationMinutes: 45,
  capacity: 3,
  price: { amount: 1_200, currency: "INR", unit: "per_vehicle" },
};

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "city:udaipur" },
  startDate: "2026-10-10",
  endDate: "2026-10-13",
  travellers: [
    { id: "traveller:1", type: "adult" },
    { id: "traveller:2", type: "adult" },
    { id: "traveller:3", type: "adult" },
    { id: "traveller:4", type: "senior" },
  ],
  preferences: { pace: "balanced", interests: ["heritage"] },
  constraints: [
    {
      id: "constraint:travel",
      category: "travel",
      priority: "hard",
      value: { earliestDeparture: "08:00", allowedModes: ["flight"] },
    },
    {
      id: "constraint:stay",
      category: "stay",
      priority: "hard",
      value: { requiredRooms: 2, requiredAmenities: ["wifi"] },
    },
    {
      id: "constraint:activity",
      category: "activity",
      priority: "hard",
      value: { maxMobility: "low", seniorFriendly: true },
    },
    {
      id: "constraint:budget",
      category: "budget",
      priority: "hard",
      value: { maxTotal: { amount: 80_000, currency: "INR" } },
    },
  ],
};

const budget: PlannerBudgetState = {
  evidenceRoundsUsed: 0,
  repairRoundsUsed: 0,
  searchCallsUsed: 0,
  optionalClarificationUsed: false,
  priorCallSignatures: new Set(),
};

function context(overrides: Partial<ToolExecutorContext> = {}): ToolExecutorContext {
  return {
    request,
    knownLocationIds: new Set([
      "city:delhi",
      "city:udaipur",
      "airport:udr",
      "neighborhood:udaipur-old-city",
    ]),
    knownMarketIds: new Set(["city:udaipur"]),
    knownSelectionIds: new Set(),
    supportedThemes: new Set(["culture"]),
    budget,
    ...overrides,
  };
}

function services() {
  const activityRequests: Parameters<InventoryToolServices["searchActivities"]>[0][] = [];
  const inventory: InventoryToolServices = {
    searchTransport: vi.fn(async () => response("query:transport", [transportOffer])),
    searchStays: vi.fn(async () => response("query:stay", [stayOffer])),
    searchActivities: vi.fn(async (activityRequest) => {
      activityRequests.push(activityRequest);
      return response(
        `query:activity:${activityRequest.startDate}`,
        [activityOffer(activityRequest.startDate, activityRequest.startDate)],
      );
    }),
    searchTransfers: vi.fn(async () => response("query:transfer", [transferOffer])),
  };
  return { inventory, activityRequests };
}

const plan: ToolPlan = {
  operationalSummary: "Retrieve the exact inventory needed for the route",
  calls: [
    {
      id: "call:transport",
      tool: "search_transport",
      purpose: "Find travel on the second trip day",
      from: "city:delhi",
      to: "city:udaipur",
      tripDayNumber: 2,
    },
    {
      id: "call:stay",
      tool: "search_stays",
      purpose: "Cover all three nights",
      locationId: "neighborhood:udaipur-old-city",
      checkInDayNumber: 1,
      nights: 3,
    },
    {
      id: "call:activities",
      tool: "search_activities",
      purpose: "Find activities on non-contiguous days",
      locationId: "neighborhood:udaipur-old-city",
      tripDayNumbers: [1, 3],
      themes: ["culture"],
    },
    {
      id: "call:transfer",
      tool: "search_transfers",
      purpose: "Connect the airport to the stay",
      from: "airport:udr",
      to: "neighborhood:udaipur-old-city",
    },
  ],
};

describe("typed internal planner tool executor", () => {
  it("derives exact inventory requests and passes only category-relevant constraints", async () => {
    const { inventory, activityRequests } = services();
    const batch = await executeToolPlan(plan, context(), inventory);

    expect(inventory.searchTransport).toHaveBeenCalledWith({
      from: "city:delhi",
      to: "city:udaipur",
      date: "2026-10-11",
      travellers: request.travellers,
      constraints: [request.constraints[0]],
    });
    expect(inventory.searchStays).toHaveBeenCalledWith({
      locationId: "neighborhood:udaipur-old-city",
      checkIn: "2026-10-10",
      checkOut: "2026-10-13",
      travellers: request.travellers,
      constraints: [request.constraints[1]],
    });
    expect(activityRequests.map((item) => item.startDate)).toEqual([
      "2026-10-10",
      "2026-10-12",
    ]);
    expect(activityRequests.every((item) => item.startDate === item.endDate)).toBe(true);
    expect(activityRequests.every((item) => item.interests.join(",") === "culture,heritage")).toBe(true);
    expect(activityRequests.every((item) => item.constraints[0]?.id === "constraint:activity")).toBe(true);
    expect(inventory.searchTransfers).toHaveBeenCalledWith({
      from: "airport:udr",
      to: "neighborhood:udaipur-old-city",
      travellers: request.travellers,
    });
    expect(batch.results.map((result) => result.callId)).toEqual(plan.calls.map((call) => call.id));
  });

  it("produces bounded grounded facts with code-calculated totals and room requirements", async () => {
    const { inventory } = services();
    const batch = await executeToolPlan(plan, context(), inventory);
    const observations = new Map(
      batch.results.map((result) => [result.observation.toolName, result.observation]),
    );

    const transportFacts = observations.get("search_transport")?.candidates[0].facts;
    expect(transportFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "unit_price", value: 5_000 }),
        expect.objectContaining({ dimension: "total_price", value: 20_000 }),
        expect.objectContaining({ dimension: "duration", value: 80 }),
      ]),
    );
    const stayFacts = observations.get("search_stays")?.candidates[0].facts;
    expect(stayFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "rooms", value: 2 }),
        expect.objectContaining({ dimension: "nights", value: 3 }),
        expect.objectContaining({ dimension: "total_price", value: 18_000 }),
      ]),
    );
    const transferFacts = observations.get("search_transfers")?.candidates[0].facts;
    expect(transferFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "required_vehicles", value: 2 }),
        expect.objectContaining({ dimension: "total_price", value: 2_400 }),
      ]),
    );
    expect(observations.get("search_activities")?.candidates).toHaveLength(2);
  });

  it("returns the explicit next workflow budget without hidden executor state", async () => {
    const { inventory } = services();
    const batch = await executeToolPlan(plan, context(), inventory);

    expect(batch.nextBudget).toMatchObject({
      evidenceRoundsUsed: 1,
      repairRoundsUsed: 0,
      searchCallsUsed: 4,
      optionalClarificationUsed: false,
    });
    expect(batch.nextBudget.priorCallSignatures.size).toBe(4);
  });

  it("rejects invalid plans before any inventory service runs", async () => {
    const { inventory } = services();
    const invalid: ToolPlan = {
      operationalSummary: "Search outside the trip",
      calls: [
        {
          id: "call:invalid",
          tool: "search_transport",
          purpose: "Invalid day",
          from: "city:delhi",
          to: "city:udaipur",
          tripDayNumber: 5,
        },
      ],
    };

    await expect(executeToolPlan(invalid, context(), inventory)).rejects.toMatchObject({
      code: "INVALID_TOOL_PLAN",
    });
    expect(inventory.searchTransport).not.toHaveBeenCalled();
  });

  it("keeps discovery explicitly unavailable until its later inventory slice", async () => {
    const { inventory } = services();
    const discovery: ToolPlan = {
      operationalSummary: "Discover possible destinations",
      calls: [
        {
          id: "call:discover",
          tool: "discover_destinations",
          purpose: "Find matching markets",
          candidateMarketIds: ["city:udaipur"],
        },
      ],
    };

    await expect(executeToolPlan(discovery, context(), inventory)).rejects.toEqual(
      expect.objectContaining<Partial<PlannerToolExecutorError>>({
        code: "TOOL_NOT_IMPLEMENTED",
        details: { callId: "call:discover", tool: "discover_destinations" },
      }),
    );
  });
});
