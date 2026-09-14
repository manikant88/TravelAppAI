import { describe, expect, it } from "vitest";
import { stayOfferSchema } from "@/inventory/contracts";
import { normalizeNuiteeStayResponse } from "@/inventory/providers/nuitee.server";

const request = {
  destination: "Jaipur",
  checkIn: "2026-10-08",
  checkOut: "2026-10-11",
  travellers: 2,
  currency: "INR" as const,
  guestNationality: "IN",
  limit: 4,
};

function response() {
  return {
    sandbox: true,
    hotels: [{
      id: "lp-jaipur",
      name: "Jaipur Heritage Hotel",
      main_photo: "https://static.cupid.travel/hotels/example.jpg",
      address: "Pink City",
      city_name: "Jaipur",
      country_code: "in",
      latitude: 26.92,
      longitude: 75.82,
      rating: 8.6,
      stars: 4,
      review_count: 1200,
      tags: ["Free WiFi", "Rooftop"],
      story: "A central heritage stay.",
    }],
    data: [{
      hotelId: "lp-jaipur",
      roomTypes: [{
        roomTypeId: "deluxe",
        offerId: "sandbox-offer-id",
        offerRetailRate: { amount: 9_000, currency: "INR" },
        suggestedSellingPrice: { amount: 9_600, currency: "INR" },
        rates: [{
          name: "Deluxe Double Room",
          maxOccupancy: 2,
          boardType: "BI",
          boardName: "Breakfast Included",
          mappedRoomId: 101,
          retailRate: {
            total: [{ amount: 9_000, currency: "INR" }],
            taxesAndFees: [{ included: true, amount: 450, currency: "INR" }],
          },
          cancellationPolicies: {
            refundableTag: "RFN",
            cancelPolicyInfos: [{ cancelTime: "2026-10-06 04:00:00", amount: 9_000, currency: "INR" }],
          },
        }],
      }],
    }],
  };
}

describe("Nuitée stay provider normalization", () => {
  it("preserves the exact public stay total and derives a comparable nightly price", () => {
    const result = normalizeNuiteeStayResponse(response(), request, "2026-09-06T16:00:00Z");
    const offer = result.offers[0];

    expect(result.environment).toBe("sandbox");
    expect(result.assumptions).toContain("1 room assumed, with no more than two travellers per room.");
    expect(offer.totalPrice).toEqual({ amount: 9_600, currency: "INR" });
    expect(offer.price).toEqual({ amount: 3_200, currency: "INR", unit: "per_room_per_night" });
    expect(offer.source).toMatchObject({ provider: "Nuitée Connect", evidenceKind: "sandbox", checkedAt: "2026-09-06T16:00:00Z" });
    expect(offer.propertyFacts).toMatchObject({ latitude: 26.92, longitude: 75.82, rating: 4.3, starRating: 4 });
    expect(offer.roomFacts).toMatchObject({ roomLabel: "Deluxe Double Room", mealPlan: "breakfast", refundable: true });
    expect(stayOfferSchema.safeParse(offer).success).toBe(true);
  });

  it("does not manufacture availability for hotels without a returned room rate", () => {
    const raw = response();
    raw.data[0].roomTypes[0].rates = [];
    const result = normalizeNuiteeStayResponse(raw, request, "2026-09-06T16:00:00Z");
    expect(result.offers).toEqual([]);
  });

  it("keeps a valid rate when Nuitée returns null tax details", () => {
    const raw: unknown = response();
    (raw as { data: Array<{ roomTypes: Array<{ rates: Array<{ retailRate: { taxesAndFees: null } }> }> }> }).data[0].roomTypes[0].rates[0].retailRate.taxesAndFees = null;
    const result = normalizeNuiteeStayResponse(raw, request, "2026-09-06T16:00:00Z");
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].totalPrice).toEqual({ amount: 9_600, currency: "INR" });
  });

  it("keeps a non-sandbox response explicitly live", () => {
    const raw = response();
    raw.sandbox = false;
    const result = normalizeNuiteeStayResponse(raw, request, "2026-09-06T16:00:00Z");
    expect(result.environment).toBe("live");
    expect(result.offers[0].source.evidenceKind).toBe("live");
  });
});
