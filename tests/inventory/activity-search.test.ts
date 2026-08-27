import { describe, expect, it } from "vitest";
import type { ActivitySearchRequest } from "@/inventory/contracts";
import type {
  ActivityCatalogSession,
  ActivityInventoryRepository,
} from "@/inventory/repository";
import { resolveOffer, searchActivities } from "@/inventory/service";

const sessions: ActivityCatalogSession[] = [
  {
    sessionId: "session:city-palace-morning",
    activityId: "activity:udaipur-city-palace",
    locationId: "neighborhood:udaipur-old-city",
    timezone: "Asia/Kolkata",
    name: "City Palace visit",
    tags: ["heritage", "culture", "architecture"],
    mobility: "medium",
    childFriendly: true,
    seniorFriendly: true,
    imageAssetKey: "activity-city-palace",
    operatingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startsAtLocalTime: "09:30",
    durationMinutes: 150,
    capacity: 30,
    validFrom: "2026-09-01",
    validUntil: "2027-03-31",
    priceAmount: 450,
    currency: "INR",
    priceUnit: "per_participant",
  },
  {
    sessionId: "session:pichola-boat-sunset",
    activityId: "activity:udaipur-pichola-boat",
    locationId: "neighborhood:udaipur-pichola",
    timezone: "Asia/Kolkata",
    name: "Lake Pichola boat ride",
    tags: ["lake", "relaxed", "sunset"],
    mobility: "low",
    childFriendly: true,
    seniorFriendly: true,
    imageAssetKey: "activity-pichola-boat",
    operatingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startsAtLocalTime: "17:00",
    durationMinutes: 60,
    capacity: 20,
    validFrom: "2026-09-01",
    validUntil: "2027-03-31",
    priceAmount: 900,
    currency: "INR",
    priceUnit: "per_participant",
  },
  {
    sessionId: "session:bagore-show-evening",
    activityId: "activity:udaipur-bagore-show",
    locationId: "neighborhood:udaipur-old-city",
    timezone: "Asia/Kolkata",
    name: "Bagore Ki Haveli cultural show",
    tags: ["culture", "evening", "dance"],
    mobility: "low",
    childFriendly: true,
    seniorFriendly: true,
    imageAssetKey: "activity-bagore-show",
    operatingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startsAtLocalTime: "19:00",
    durationMinutes: 75,
    capacity: 40,
    validFrom: "2026-09-01",
    validUntil: "2027-03-31",
    priceAmount: 350,
    currency: "INR",
    priceUnit: "per_participant",
  },
  {
    sessionId: "session:monsoon-palace-afternoon",
    activityId: "activity:udaipur-monsoon-palace-hike",
    locationId: "city:udaipur",
    timezone: "Asia/Kolkata",
    name: "Monsoon Palace hillside walk",
    tags: ["views", "outdoors", "sunset"],
    mobility: "high",
    childFriendly: false,
    seniorFriendly: false,
    imageAssetKey: "activity-monsoon-palace",
    operatingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startsAtLocalTime: "15:30",
    durationMinutes: 180,
    capacity: 15,
    validFrom: "2026-09-01",
    validUntil: "2027-03-31",
    priceAmount: 700,
    currency: "INR",
    priceUnit: "per_participant",
  },
];

function createRepository(
  catalog: ActivityCatalogSession[] = sessions,
): ActivityInventoryRepository {
  return {
    async getInventoryMeta() {
      return {
        version: "travel-seed-v1",
        supportedFrom: "2026-09-01",
        supportedUntil: "2027-03-31",
      };
    },
    async getActiveLocationGraph() {
      return [
        { id: "country:in", timezone: "Asia/Kolkata" },
        { id: "city:delhi", parentId: "country:in", timezone: "Asia/Kolkata" },
        { id: "city:udaipur", parentId: "country:in", timezone: "Asia/Kolkata" },
        {
          id: "neighborhood:udaipur-old-city",
          parentId: "city:udaipur",
          timezone: "Asia/Kolkata",
        },
        {
          id: "neighborhood:udaipur-pichola",
          parentId: "city:udaipur",
          timezone: "Asia/Kolkata",
        },
      ];
    },
    async findActivitySessions(locationIds) {
      return catalog.filter((session) => locationIds.includes(session.locationId));
    },
    async findActivitySessionById(sessionId) {
      return catalog.find((session) => session.sessionId === sessionId);
    },
  };
}

function request(
  constraints: ActivitySearchRequest["constraints"] = [],
): ActivitySearchRequest {
  return {
    locationId: "city:udaipur",
    startDate: "2026-10-10",
    endDate: "2026-10-11",
    travellers: [
      { id: "traveller:1", type: "adult" },
      { id: "traveller:2", type: "adult" },
    ],
    interests: ["sunset"],
    constraints,
  };
}

describe("dated activity inventory", () => {
  it("expands recurring sessions into timezone-aware dated offers", async () => {
    const response = await searchActivities(request(), createRepository());

    expect(response.coverage).toEqual({ status: "available" });
    expect(response.results).toHaveLength(8);
    expect(new Set(response.results.map((offer) => offer.startsAt.slice(0, 10)))).toEqual(
      new Set(["2026-10-10", "2026-10-11"]),
    );
    expect(response.results[0]).toMatchObject({
      sessionId: "session:monsoon-palace-afternoon",
      startsAt: "2026-10-10T15:30:00+05:30",
      endsAt: "2026-10-10T18:30:00+05:30",
      capacity: 15,
      price: { amount: 700, currency: "INR", unit: "per_participant" },
    });
    expect(response.results[1]?.startsAt.startsWith("2026-10-11")).toBe(true);
  });

  it("uses interests for bounded ordering without eliminating non-matches", async () => {
    const response = await searchActivities(
      { ...request(), startDate: "2026-10-10", endDate: "2026-10-10", interests: ["culture"] },
      createRepository(),
    );

    expect(response.results.slice(0, 2).map((offer) => offer.sessionId)).toEqual([
      "session:bagore-show-evening",
      "session:city-palace-morning",
    ]);
    expect(response.results).toHaveLength(4);
  });

  it("enforces hard mobility and family suitability outside the model", async () => {
    const response = await searchActivities(
      request([
        {
          id: "constraint:accessible-family",
          category: "activity",
          priority: "hard",
          value: { maxMobility: "low", childFriendly: true, seniorFriendly: true },
        },
      ]),
      createRepository(),
    );

    expect(new Set(response.results.map((offer) => offer.sessionId))).toEqual(
      new Set(["session:pichola-boat-sunset", "session:bagore-show-evening"]),
    );
    expect(response.appliedFilters).toContainEqual({
      type: "hard_constraint",
      label: "Applied activity constraint constraint:accessible-family",
      constraintId: "constraint:accessible-family",
    });
  });

  it("keeps unsupported, outside-window, capacity, and constraint failures distinct", async () => {
    const repository = createRepository();
    const unsupported = await searchActivities(
      { ...request(), locationId: "city:delhi" },
      repository,
    );
    const outsideWindow = await searchActivities(
      { ...request(), startDate: "2027-04-01", endDate: "2027-04-02" },
      repository,
    );
    const noCapacity = await searchActivities(
      { ...request(), travellers: Array.from({ length: 50 }, (_, index) => ({ id: `t:${index}`, type: "adult" as const })) },
      repository,
    );
    const eliminated = await searchActivities(
      request([
        {
          id: "constraint:impossible-combination",
          category: "activity",
          priority: "hard",
          value: { maxMobility: "low", childFriendly: false },
        },
      ]),
      repository,
    );

    expect(unsupported.coverage).toEqual({
      status: "unsupported_location",
      locationId: "city:delhi",
    });
    expect(outsideWindow.coverage).toEqual({ status: "outside_inventory_window" });
    expect(noCapacity.coverage).toEqual({ status: "no_availability" });
    expect(eliminated.coverage).toEqual({
      status: "eliminated_by_constraints",
      constraintIds: ["constraint:impossible-combination"],
    });
  });

  it("reconstructs an activity offer from its ID and current session facts", async () => {
    const repository = createRepository();
    const response = await searchActivities(request(), repository);
    const offer = response.results[0];

    await expect(resolveOffer(offer.id, repository)).resolves.toEqual(offer);
    await expect(resolveOffer(`${offer.id}tampered`, repository)).rejects.toThrow(
      "Invalid activity offer ID",
    );
  });

  it("normalizes interest casing and order into a stable query ID", async () => {
    const first = await searchActivities(
      { ...request(), interests: [" Sunset ", "Culture"] },
      createRepository(),
    );
    const second = await searchActivities(
      { ...request(), interests: ["culture", "sunset"] },
      createRepository(),
    );

    expect(first.queryId).toBe(second.queryId);
  });
});
