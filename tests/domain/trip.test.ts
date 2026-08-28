import { describe, expect, it } from "vitest";
import type { TripState } from "@/domain/model";
import type {
  ActivityOffer,
  StayOffer,
  TransferOffer,
  TransportOffer,
} from "@/inventory/contracts";
import type { ResolvedOffer } from "@/domain/trip";
import { projectTrip, tripStateSchema } from "@/domain/trip";

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
    amenities: ["wifi", "breakfast"],
    accessibility: [],
    tags: ["senior_friendly"],
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
    mobility: "medium",
    childFriendly: true,
    seniorFriendly: true,
    imageAssetKey: "palace",
  },
  price: { amount: 500, currency: "INR", unit: "per_participant" },
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

const offers = new Map<string, ResolvedOffer>([
  [outbound.id, outbound],
  [returning.id, returning],
  [stay.id, stay],
  [activity.id, activity],
  [arrivalTransfer.id, arrivalTransfer],
  [departureTransfer.id, departureTransfer],
]);

const locationGraph = [
  { id: "country:in" },
  { id: "city:delhi", parentId: "country:in" },
  { id: "city:udaipur", parentId: "country:in" },
  { id: "airport:udr", parentId: "city:udaipur" },
  { id: "neighborhood:udaipur-old-city", parentId: "city:udaipur" },
];

function validTrip(): TripState {
  const travellerIds = ["traveller:1", "traveller:2"];
  return {
    id: "trip:1",
    inventoryVersion: "travel-seed-v1",
    request: {
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "city:udaipur" },
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      travellers: [
        { id: travellerIds[0], type: "adult" },
        { id: travellerIds[1], type: "adult" },
      ],
      preferences: { pace: "balanced", interests: ["heritage"] },
      constraints: [
        {
          id: "constraint:budget",
          category: "budget",
          priority: "hard",
          value: {
            targetTotal: { amount: 25_000, currency: "INR" },
            maxTotal: { amount: 30_000, currency: "INR" },
          },
        },
        {
          id: "constraint:stay",
          category: "stay",
          priority: "hard",
          value: { requiredAmenities: ["wifi"] },
        },
        {
          id: "constraint:activity",
          category: "activity",
          priority: "hard",
          value: { maxMobility: "medium" },
        },
      ],
    },
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
    selectedTravel: [
      { id: "selection:outbound", kind: "travel", offerKind: "transport", offerId: outbound.id, travellerIds, locked: false },
      { id: "selection:return", kind: "travel", offerKind: "transport", offerId: returning.id, travellerIds, locked: false },
      { id: "selection:arrival-transfer", kind: "travel", offerKind: "transfer", offerId: arrivalTransfer.id, travellerIds, locked: false },
      { id: "selection:departure-transfer", kind: "travel", offerKind: "transfer", offerId: departureTransfer.id, travellerIds, locked: false },
    ],
    selectedStays: [
      { id: "selection:stay", kind: "stay", offerId: stay.id, travellerIds, locked: false, checkIn: stay.checkIn, checkOut: stay.checkOut, rooms: 1 },
    ],
    selectedActivities: [
      { id: "selection:activity", kind: "activity", offerId: activity.id, travellerIds, locked: false, date: "2026-10-11" },
    ],
    version: 0,
  };
}

function context() {
  return {
    locationGraph,
    async resolveOffer(offerId: string) {
      const offer = offers.get(offerId);
      if (!offer) throw new Error("Offer is no longer available");
      return offer;
    },
  };
}

describe("deterministic trip projection", () => {
  it("derives budget, chronological itinerary, and warning-only validation", async () => {
    const projection = await projectTrip(validTrip(), context());

    expect(projection.budget).toEqual({
      target: { amount: 25_000, currency: "INR" },
      maximum: { amount: 30_000, currency: "INR" },
      total: { amount: 28_400, currency: "INR" },
      breakdown: {
        travel: { amount: 21_400, currency: "INR" },
        stays: { amount: 6_000, currency: "INR" },
        activities: { amount: 1_000, currency: "INR" },
      },
      deltaFromTarget: { amount: 3_400, currency: "INR" },
      amountOverMaximum: undefined,
    });
    expect(projection.itinerary.map((day) => day.date)).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ]);
    expect(projection.itinerary[1].events[0]).toMatchObject({
      type: "activity",
      title: "Palace walk",
      startAt: activity.startsAt,
    });
    expect(projection.itinerary[0].events).toContainEqual(
      expect.objectContaining({ type: "free_time", title: "Open time around travel" }),
    );
    expect(projection.validation.valid).toBe(true);
    expect(projection.validation.issues).toContainEqual(
      expect.objectContaining({ code: "BUDGET_EXCEEDED", severity: "warning" }),
    );
  });

  it("rejects an empty initial itinerary but keeps open time explicit", async () => {
    const trip = validTrip();
    trip.selectedActivities = [];

    const projection = await projectTrip(trip, context());

    expect(projection.validation.valid).toBe(false);
    expect(projection.validation.issues).toContainEqual(
      expect.objectContaining({ code: "ITINERARY_INCOMPLETE", severity: "error" }),
    );
    expect(projection.itinerary[1].events).toContainEqual(
      expect.objectContaining({ type: "free_time" }),
    );
  });

  it("makes maximum budget breaches and route/stay gaps blocking errors", async () => {
    const trip = validTrip();
    const budget = trip.request.constraints[0];
    if (budget.category === "budget") budget.value.maxTotal = { amount: 25_500, currency: "INR" };
    trip.route.stops[0].checkOut = "2026-10-11";

    const projection = await projectTrip(trip, context());
    expect(projection.validation.valid).toBe(false);
    expect(projection.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BUDGET_EXCEEDED", severity: "error" }),
        expect.objectContaining({ code: "ROUTE_GAP", severity: "error" }),
        expect.objectContaining({ code: "STAY_CONFLICT", severity: "error" }),
      ]),
    );
  });

  it("detects overlapping traveller schedules and hard mobility conflicts", async () => {
    const trip = validTrip();
    trip.selectedActivities.push({
      id: "selection:activity-overlap",
      kind: "activity",
      offerId: "offer:activity:overlap",
      travellerIds: ["traveller:1"],
      locked: false,
      date: "2026-10-11",
    });
    const overlap: ActivityOffer = {
      ...activity,
      id: "offer:activity:overlap",
      activityId: "activity:hike",
      sessionId: "session:hike",
      startsAt: "2026-10-11T11:00:00+05:30",
      endsAt: "2026-10-11T13:00:00+05:30",
      activityFacts: { ...activity.activityFacts, name: "Hill hike", mobility: "high" },
    };
    offers.set(overlap.id, overlap);

    const projection = await projectTrip(trip, context());
    expect(projection.validation.valid).toBe(false);
    expect(projection.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SCHEDULE_CONFLICT", severity: "error" }),
        expect.objectContaining({ code: "MOBILITY_CONFLICT", severity: "error" }),
      ]),
    );
    offers.delete(overlap.id);
  });

  it("enforces travel, stay, and daily activity constraints outside the model", async () => {
    const trip = validTrip();
    trip.request.constraints.push(
      {
        id: "constraint:travel",
        category: "travel",
        priority: "hard",
        value: { earliestDeparture: "08:00", allowedModes: ["train"] },
      },
      {
        id: "constraint:schedule",
        category: "schedule",
        priority: "hard",
        value: { maxActiveMinutesPerDay: 100 },
      },
    );
    const stayConstraint = trip.request.constraints.find(
      (constraint) => constraint.category === "stay",
    );
    if (stayConstraint?.category === "stay") {
      stayConstraint.value.requiredAmenities = ["pool"];
    }

    const projection = await projectTrip(trip, context());
    expect(projection.validation.valid).toBe(false);
    expect(projection.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "EARLY_TRAVEL_CONFLICT", severity: "error" }),
        expect.objectContaining({ code: "TRAVEL_MODE_CONFLICT", severity: "error" }),
        expect.objectContaining({ code: "STAY_CONFLICT", severity: "error" }),
        expect.objectContaining({ code: "SCHEDULE_CONFLICT", severity: "error" }),
      ]),
    );
  });

  it("classifies stale and missing resolved offers without trusting client facts", async () => {
    const trip = validTrip();
    const staleContext = {
      locationGraph,
      async resolveOffer(offerId: string) {
        if (offerId === stay.id) throw new Error("Offer inventory version is stale");
        return context().resolveOffer(offerId);
      },
    };
    const projection = await projectTrip(trip, staleContext);

    expect(projection.validation.valid).toBe(false);
    expect(projection.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "INVENTORY_VERSION_MISMATCH",
        selectionIds: ["selection:stay"],
      }),
    );
  });

  it("rejects duplicate selection IDs and unknown selection travellers structurally", () => {
    const trip = validTrip();
    trip.selectedStays[0].id = trip.selectedTravel[0].id;
    trip.selectedActivities[0].travellerIds = ["traveller:missing"];
    expect(tripStateSchema.safeParse(trip).success).toBe(false);
  });
});
