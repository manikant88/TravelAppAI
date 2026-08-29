import { describe, expect, it, vi } from "vitest";
import type { PlannerDecisionInput, SpecifiedDestinationPlannerModel } from "@/agent/coordinator";
import { coordinateSpecifiedDestinationPlan } from "@/agent/coordinator";
import type { PlanningHypothesis, ToolPlan } from "@/agent/contracts";
import type { InventoryToolServices } from "@/agent/executor";
import type { PlannableTripRequest } from "@/domain/model";
import type { ResolvedOffer } from "@/domain/trip";
import type {
  ActivityOffer,
  SearchResponse,
  StayOffer,
  TransferOffer,
  TransportOffer,
} from "@/inventory/contracts";

const generatedAt = "2026-08-27T00:00:00.000Z";
const price = (amount: number, unit: "per_traveller" | "per_room_per_night" | "per_vehicle" | "per_participant") =>
  ({ amount, currency: "INR" as const, unit });

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
  id: "offer:transport:del-hkt",
  serviceId: "service:del-hkt",
  mode: "flight",
  from: "city:delhi",
  to: "airport:hkt",
  departureAt: "2026-10-10T08:00:00+05:30",
  arrivalAt: "2026-10-10T13:30:00+07:00",
  durationMinutes: 240,
  stops: 0,
  operator: "Example Air",
  segments: [{ from: "city:delhi", to: "airport:hkt", departureAt: "2026-10-10T08:00:00+05:30", arrivalAt: "2026-10-10T13:30:00+07:00", operator: "Example Air" }],
  price: price(18_000, "per_traveller"),
};

const returning: TransportOffer = {
  ...outbound,
  id: "offer:transport:kbv-del",
  serviceId: "service:kbv-del",
  from: "airport:kbv",
  to: "city:delhi",
  departureAt: "2026-10-14T16:00:00+07:00",
  arrivalAt: "2026-10-14T19:30:00+05:30",
  segments: [{ from: "airport:kbv", to: "city:delhi", departureAt: "2026-10-14T16:00:00+07:00", arrivalAt: "2026-10-14T19:30:00+05:30", operator: "Example Air" }],
};

function stay(id: string, locationId: string, checkIn: string, checkOut: string): StayOffer {
  return {
    id,
    roomOfferId: id.replace("offer:stay", "room"),
    propertyId: id.replace("offer:stay", "property"),
    locationId,
    checkIn,
    checkOut,
    rooms: 1,
    propertyFacts: { name: `${locationId} stay`, rating: 4.4, reviewCount: 120, amenities: ["wifi"], accessibility: [], tags: [], imageAssetKey: id },
    roomFacts: { roomLabel: "Double", maxOccupancy: 2, mealPlan: "breakfast", refundable: true },
    price: price(6_000, "per_room_per_night"),
  };
}

const phuketStay = stay("offer:stay:phuket", "city:phuket", "2026-10-10", "2026-10-12");
const krabiStay = stay("offer:stay:krabi", "city:krabi", "2026-10-12", "2026-10-14");
const interstop: TransferOffer = {
  id: "offer:transfer:phuket-krabi",
  transferId: "transfer:phuket-krabi",
  from: "city:phuket",
  to: "city:krabi",
  mode: "van",
  durationMinutes: 180,
  capacity: 4,
  price: price(4_500, "per_vehicle"),
};

function activity(id: string, locationId: string, startsAt: string): ActivityOffer {
  return {
    id,
    activityId: id.replace("offer:", "activity:"),
    sessionId: id.replace("offer:", "session:"),
    locationId,
    startsAt,
    endsAt: startsAt.replace("10:00:00", "12:00:00"),
    capacity: 20,
    activityFacts: {
      name: `${locationId} coastal experience`,
      tags: ["beaches"],
      mobility: "low",
      childFriendly: true,
      seniorFriendly: true,
      imageAssetKey: id,
    },
    price: price(1_000, "per_participant"),
  };
}

const phuketActivity = activity(
  "offer:phuket-activity",
  "city:phuket",
  "2026-10-11T10:00:00+07:00",
);
const krabiActivity = activity(
  "offer:krabi-activity",
  "city:krabi",
  "2026-10-13T10:00:00+07:00",
);

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "region:thailand-andaman" },
  startDate: "2026-10-10",
  endDate: "2026-10-14",
  travellers: [{ id: "traveller:1", type: "adult" }, { id: "traveller:2", type: "adult" }],
  preferences: { pace: "balanced", interests: ["beaches"] },
  constraints: [],
};

const calls: ToolPlan["calls"] = [
  { id: "call:outbound", tool: "search_transport", purpose: "Reach first stop", from: "city:delhi", to: "city:phuket", tripDayNumber: 1 },
  { id: "call:phuket-stay", tool: "search_stays", purpose: "Cover Phuket nights", locationId: "city:phuket", checkInDayNumber: 1, nights: 2 },
  { id: "call:interstop", tool: "search_transfers", purpose: "Connect route stops", from: "city:phuket", to: "city:krabi" },
  { id: "call:krabi-stay", tool: "search_stays", purpose: "Cover Krabi nights", locationId: "city:krabi", checkInDayNumber: 3, nights: 2 },
  { id: "call:return", tool: "search_transport", purpose: "Return from final stop", from: "city:krabi", to: "city:delhi", tripDayNumber: 5 },
  { id: "call:phuket-activity", tool: "search_activities", purpose: "Plan a Phuket day", locationId: "city:phuket", tripDayNumbers: [2], themes: ["beaches"] },
  { id: "call:krabi-activity", tool: "search_activities", purpose: "Plan a Krabi day", locationId: "city:krabi", tripDayNumbers: [4], themes: ["beaches"] },
];

const hypothesis: PlanningHypothesis = {
  goalSummary: "A balanced connected coastal trip",
  destinationMode: "specified",
  candidateMarketIds: ["region:thailand-andaman"],
  proposedStopIds: ["city:phuket", "city:krabi"],
  nightAllocation: [2, 2],
  preferenceOrder: ["pace", "price"],
  preserveSelectionIds: [],
  toolPlan: { operationalSummary: "Retrieve every route leg and stay", calls },
};

describe("end-to-end generic multi-stop PLAN", () => {
  it("assembles and validates a connected two-stop trip without destination branches", async () => {
    const observed = [outbound, phuketStay, interstop, krabiStay, returning, phuketActivity, krabiActivity];
    const offers = new Map<string, ResolvedOffer>(observed.map((offer) => [offer.id, offer]));
    const services: InventoryToolServices = {
      searchTransport: vi.fn(async (search) =>
        search.from === "city:delhi"
          ? response("query:outbound", [outbound])
          : response("query:return", [returning])),
      searchStays: vi.fn(async (search) =>
        search.locationId === "city:phuket"
          ? response("query:phuket-stay", [phuketStay])
          : response("query:krabi-stay", [krabiStay])),
      searchTransfers: vi.fn(async () => response("query:interstop", [interstop])),
      searchActivities: vi.fn(async (search) =>
        search.locationId === "city:phuket"
          ? response("query:phuket-activity", [phuketActivity])
          : response("query:krabi-activity", [krabiActivity])),
    };
    const model: SpecifiedDestinationPlannerModel = {
      createPlanningHypothesis: vi.fn(async () => hypothesis),
      chooseNextAction: vi.fn(async (input: PlannerDecisionInput) => {
        const allowedDimensions = new Set(
          input.factBundles.flatMap((bundle) => bundle.allowedComparisonDimensions),
        );
        return {
          type: "propose_plan" as const,
          marketId: "region:thailand-andaman",
          stopIds: ["city:phuket", "city:krabi"],
          nightAllocation: [2, 2],
          choices: input.observations.flatMap((observation, index) =>
            observation.candidates.map((candidate) => {
              const comparisonFact = candidate.facts.find((fact) =>
                allowedDimensions.has(fact.dimension),
              );
              if (!comparisonFact) throw new Error("Candidate has no comparable fact");
              return {
                decisionId: `decision:${index}:${candidate.candidateId}`,
                candidateId: candidate.candidateId,
                supportingFactIds: [comparisonFact.id],
                comparisonDimensions: [comparisonFact.dimension],
              };
            }),
          ),
        };
      }),
    };

    const result = await coordinateSpecifiedDestinationPlan({
      tripId: "trip:connected-coast",
      request,
      locationGraph: [
        { id: "country:in" },
        { id: "city:delhi", parentId: "country:in" },
        { id: "country:th" },
        { id: "region:thailand-andaman", parentId: "country:th" },
        { id: "city:phuket", parentId: "region:thailand-andaman" },
        { id: "airport:hkt", parentId: "city:phuket" },
        { id: "city:krabi", parentId: "region:thailand-andaman" },
        { id: "airport:kbv", parentId: "city:krabi" },
      ],
      knownMarketIds: new Set(["region:thailand-andaman"]),
      supportedThemes: new Set(["beaches"]),
      expectedInventoryVersion: "travel-seed-v1",
      model,
      inventoryServices: services,
      async resolveOffer(offerId) {
        const offer = offers.get(offerId);
        if (!offer) throw new Error("Offer not found");
        return offer;
      },
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.trip.route.stops).toEqual([
      { locationId: "city:phuket", checkIn: "2026-10-10", checkOut: "2026-10-12" },
      { locationId: "city:krabi", checkIn: "2026-10-12", checkOut: "2026-10-14" },
    ]);
    expect(result.trip.selectedStays).toHaveLength(2);
    expect(result.trip.selectedTravel).toHaveLength(3);
    expect(result.trip.selectedActivities).toHaveLength(2);
    expect(result.projection.validation).toEqual({ valid: true, issues: [] });
    const krabiArrivalDay = result.projection.itinerary.find((day) => day.date === "2026-10-12");
    expect(krabiArrivalDay?.locationId).toBe("city:krabi");
    expect(krabiArrivalDay?.events[0]).toMatchObject({
      type: "travel",
      selectionId: result.trip.selectedTravel.find((selection) => selection.offerKind === "transfer")?.id,
    });
  });
});
