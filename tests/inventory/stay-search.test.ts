import { describe, expect, it } from "vitest";
import type { StaySearchRequest } from "@/inventory/contracts";
import type { StayCatalogOffer, StayInventoryRepository } from "@/inventory/repository";
import { resolveOffer, searchStays } from "@/inventory/service";

const oldTownRoom: StayCatalogOffer = {
  roomOfferId: "room:old-town-basic",
  propertyId: "property:udaipur-old-town-rooms",
  locationId: "neighborhood:udaipur-old-city",
  propertyName: "Old Town Rooms",
  ratingTenths: 40,
  reviewCount: 311,
  amenities: ["wifi"],
  accessibility: [],
  tags: ["budget", "central", "stairs"],
  imageAssetKey: "stay-old-town-rooms",
  roomLabel: "Basic Double",
  maxOccupancy: 2,
  inventoryCount: 7,
  mealPlan: "none",
  refundable: false,
  validFrom: "2026-09-01",
  validUntil: "2027-03-31",
  priceAmount: 2_900,
  currency: "INR",
  priceUnit: "per_room_per_night",
};

const fatehSagarRoom: StayCatalogOffer = {
  ...oldTownRoom,
  roomOfferId: "room:fateh-sagar-standard",
  propertyId: "property:udaipur-fateh-sagar-house",
  locationId: "neighborhood:udaipur-fateh-sagar",
  propertyName: "Fateh Sagar House",
  ratingTenths: 43,
  reviewCount: 524,
  amenities: ["wifi", "breakfast"],
  accessibility: ["step_free_entry"],
  tags: ["value", "relaxed", "family", "senior_friendly"],
  imageAssetKey: "stay-fateh-sagar-house",
  roomLabel: "Standard Room",
  maxOccupancy: 3,
  inventoryCount: 5,
  mealPlan: "breakfast",
  refundable: true,
  priceAmount: 4_800,
};

const familyRoom: StayCatalogOffer = {
  ...oldTownRoom,
  roomOfferId: "room:haveli-family",
  propertyId: "property:udaipur-haveli-courtyard",
  propertyName: "Haveli Courtyard",
  ratingTenths: 45,
  reviewCount: 1_284,
  amenities: ["wifi", "breakfast", "restaurant"],
  accessibility: ["elevator"],
  tags: ["central", "heritage", "family"],
  imageAssetKey: "stay-haveli-courtyard",
  roomLabel: "Family Room",
  maxOccupancy: 4,
  inventoryCount: 3,
  mealPlan: "breakfast",
  refundable: true,
  priceAmount: 9_800,
};

function createRepository(
  offers: StayCatalogOffer[] = [oldTownRoom, fatehSagarRoom, familyRoom],
): StayInventoryRepository {
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
          id: "neighborhood:udaipur-fateh-sagar",
          parentId: "city:udaipur",
          timezone: "Asia/Kolkata",
        },
      ];
    },
    async findStayOffers(locationIds) {
      return offers.filter((offer) => locationIds.includes(offer.locationId));
    },
    async findStayOfferById(roomOfferId) {
      return offers.find((offer) => offer.roomOfferId === roomOfferId);
    },
  };
}

function request(
  travellerCount = 4,
  constraints: StaySearchRequest["constraints"] = [],
): StaySearchRequest {
  return {
    locationId: "city:udaipur",
    checkIn: "2026-10-10",
    checkOut: "2026-10-13",
    travellers: Array.from({ length: travellerCount }, (_, index) => ({
      id: `traveller:${index + 1}`,
      type: "adult" as const,
    })),
    constraints,
  };
}

describe("dated stay inventory", () => {
  it("derives the minimum viable room count separately for each offer", async () => {
    const response = await searchStays(request(), createRepository());

    expect(response.coverage).toEqual({ status: "available" });
    expect(
      response.results.map((offer) => ({ id: offer.roomOfferId, rooms: offer.rooms })),
    ).toEqual([
      { id: "room:old-town-basic", rooms: 2 },
      { id: "room:fateh-sagar-standard", rooms: 2 },
      { id: "room:haveli-family", rooms: 1 },
    ]);
    expect(response.results[0]).toMatchObject({
      checkIn: "2026-10-10",
      checkOut: "2026-10-13",
      propertyFacts: { name: "Old Town Rooms", rating: 4 },
      roomFacts: { maxOccupancy: 2, mealPlan: "none", refundable: false },
      price: { amount: 2_900, currency: "INR", unit: "per_room_per_night" },
    });
  });

  it("changes derived rooms and objective ordering when occupancy changes", async () => {
    const response = await searchStays(request(3), createRepository());

    expect(response.results[0]).toMatchObject({
      roomOfferId: "room:fateh-sagar-standard",
      rooms: 1,
    });
    expect(response.results.find((offer) => offer.roomOfferId === "room:old-town-basic")?.rooms).toBe(
      2,
    );
  });

  it("uses an explicit hard room count and filters offers that cannot hold the party", async () => {
    const response = await searchStays(
      request(4, [
        {
          id: "constraint:one-room",
          category: "stay",
          priority: "hard",
          value: { requiredRooms: 1 },
        },
      ]),
      createRepository(),
    );

    expect(response.results.map((offer) => offer.roomOfferId)).toEqual(["room:haveli-family"]);
    expect(response.results[0]?.rooms).toBe(1);
  });

  it("enforces amenities, senior suitability, and unit nightly price constraints", async () => {
    const response = await searchStays(
      request(2, [
        {
          id: "constraint:senior-breakfast",
          category: "stay",
          priority: "hard",
          value: {
            requiredAmenities: ["breakfast"],
            seniorFriendly: true,
            maxNightlyPrice: { amount: 5_000, currency: "INR" },
          },
        },
      ]),
      createRepository(),
    );

    expect(response.results.map((offer) => offer.roomOfferId)).toEqual([
      "room:fateh-sagar-standard",
    ]);
  });

  it("distinguishes unsupported, outside-window, unavailable, and eliminated results", async () => {
    const repository = createRepository();
    const unsupported = await searchStays(
      { ...request(), locationId: "city:delhi" },
      repository,
    );
    const outsideWindow = await searchStays(
      { ...request(), checkIn: "2027-03-31", checkOut: "2027-04-02" },
      repository,
    );
    const noCapacity = await searchStays(request(100), repository);
    const eliminated = await searchStays(
      request(2, [
        {
          id: "constraint:pool",
          category: "stay",
          priority: "hard",
          value: { requiredAmenities: ["pool"] },
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
      constraintIds: ["constraint:pool"],
    });
  });

  it("allows checkout after the final supported occupied night", async () => {
    const response = await searchStays(
      { ...request(2), checkIn: "2027-03-31", checkOut: "2027-04-01" },
      createRepository(),
    );

    expect(response.coverage).toEqual({ status: "available" });
  });

  it("reconstructs a stay offer from its ID and current catalog facts", async () => {
    const repository = createRepository();
    const response = await searchStays(request(), repository);
    const offer = response.results[0];

    await expect(resolveOffer(offer.id, repository)).resolves.toEqual(offer);
    await expect(resolveOffer(`${offer.id}tampered`, repository)).rejects.toThrow(
      "Invalid stay offer ID",
    );
  });
});
