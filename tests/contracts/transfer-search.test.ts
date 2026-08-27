import { describe, expect, it } from "vitest";
import { transferOfferSchema, transferSearchRequestSchema } from "@/inventory/contracts";

describe("transfer search API contract", () => {
  it("requires distinct normalized locations and unique travellers", () => {
    const request = {
      from: "airport:udr",
      to: "neighborhood:udaipur-old-city",
      travellers: [{ id: "traveller:1", type: "adult" }],
    };

    expect(transferSearchRequestSchema.safeParse(request).success).toBe(true);
    expect(transferSearchRequestSchema.safeParse({ ...request, to: request.from }).success).toBe(false);
    expect(
      transferSearchRequestSchema.safeParse({
        ...request,
        travellers: [
          { id: "traveller:1", type: "adult" },
          { id: "traveller:1", type: "senior" },
        ],
      }).success,
    ).toBe(false);
  });

  it("exposes only grounded transfer facts with explicit per-vehicle pricing", () => {
    const offer = {
      id: "offer:transfer:example",
      transferId: "transfer:udr-old-city",
      from: "airport:udr",
      to: "neighborhood:udaipur-old-city",
      mode: "car",
      durationMinutes: 45,
      capacity: 3,
      price: { amount: 1_200, currency: "INR", unit: "per_vehicle" },
    };

    expect(transferOfferSchema.safeParse(offer).success).toBe(true);
    expect(
      transferOfferSchema.safeParse({ ...offer, operatingStartLocalTime: "08:00" }).success,
    ).toBe(false);
  });
});
