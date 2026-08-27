import { describe, expect, it } from "vitest";
import { stayOfferSchema, staySearchRequestSchema } from "@/inventory/contracts";

describe("stay search API contract", () => {
  it("enforces exclusive checkout and valid traveller references", () => {
    const baseRequest = {
      locationId: "city:udaipur",
      checkIn: "2026-10-10",
      checkOut: "2026-10-13",
      travellers: [{ id: "traveller:1", type: "adult" }],
      constraints: [],
    };

    expect(staySearchRequestSchema.safeParse(baseRequest).success).toBe(true);
    expect(
      staySearchRequestSchema.safeParse({ ...baseRequest, checkOut: "2026-10-10" }).success,
    ).toBe(false);
    expect(
      staySearchRequestSchema.safeParse({
        ...baseRequest,
        constraints: [
          {
            id: "constraint:rooms",
            category: "stay",
            priority: "hard",
            travellerIds: ["traveller:missing"],
            value: { requiredRooms: 1 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("exposes facts but rejects database-only room inventory fields", () => {
    const offer = {
      id: "offer:stay:example",
      roomOfferId: "room:haveli-family",
      propertyId: "property:udaipur-haveli-courtyard",
      locationId: "neighborhood:udaipur-old-city",
      checkIn: "2026-10-10",
      checkOut: "2026-10-13",
      rooms: 1,
      propertyFacts: {
        name: "Haveli Courtyard",
        rating: 4.5,
        reviewCount: 1_284,
        amenities: ["wifi", "breakfast"],
        accessibility: ["elevator"],
        tags: ["heritage"],
        imageAssetKey: "stay-haveli-courtyard",
      },
      roomFacts: {
        roomLabel: "Family Room",
        maxOccupancy: 4,
        mealPlan: "breakfast",
        refundable: true,
      },
      price: { amount: 9_800, currency: "INR", unit: "per_room_per_night" },
    };

    expect(stayOfferSchema.safeParse(offer).success).toBe(true);
    expect(stayOfferSchema.safeParse({ ...offer, inventoryCount: 3 }).success).toBe(false);
  });
});
