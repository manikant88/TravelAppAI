import { describe, expect, it } from "vitest";
import { activityOfferSchema, activitySearchRequestSchema } from "@/inventory/contracts";

describe("activity search API contract", () => {
  it("validates inclusive date ranges and traveller references", () => {
    const baseRequest = {
      locationId: "city:udaipur",
      startDate: "2026-10-10",
      endDate: "2026-10-10",
      travellers: [{ id: "traveller:1", type: "adult" }],
      interests: ["culture"],
      constraints: [],
    };

    expect(activitySearchRequestSchema.safeParse(baseRequest).success).toBe(true);
    expect(
      activitySearchRequestSchema.safeParse({ ...baseRequest, endDate: "2026-10-09" }).success,
    ).toBe(false);
    expect(
      activitySearchRequestSchema.safeParse({
        ...baseRequest,
        constraints: [
          {
            id: "constraint:mobility",
            category: "activity",
            priority: "hard",
            travellerIds: ["traveller:missing"],
            value: { maxMobility: "low" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("exposes grounded activity facts without recurring catalog fields", () => {
    const offer = {
      id: "offer:activity:example",
      activityId: "activity:udaipur-pichola-boat",
      sessionId: "session:pichola-boat-sunset",
      locationId: "neighborhood:udaipur-pichola",
      startsAt: "2026-10-10T17:00:00+05:30",
      endsAt: "2026-10-10T18:00:00+05:30",
      capacity: 20,
      activityFacts: {
        name: "Lake Pichola boat ride",
        tags: ["lake", "relaxed", "sunset"],
        mobility: "low",
        childFriendly: true,
        seniorFriendly: true,
        imageAssetKey: "activity-pichola-boat",
      },
      price: { amount: 900, currency: "INR", unit: "per_participant" },
    };

    expect(activityOfferSchema.safeParse(offer).success).toBe(true);
    expect(
      activityOfferSchema.safeParse({ ...offer, operatingWeekdays: [0, 1, 2, 3, 4, 5, 6] })
        .success,
    ).toBe(false);
  });
});
