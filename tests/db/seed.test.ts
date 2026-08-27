import { describe, expect, it } from "vitest";
import { udaipurSeed } from "@/db/seed/data";
import { validateInventorySeed } from "@/db/seed/validate";

describe("inventory seed", () => {
  it("satisfies the first-market coverage contract", () => {
    expect(() => validateInventorySeed(udaipurSeed)).not.toThrow();
    expect(udaipurSeed.markets).toHaveLength(1);
    expect(udaipurSeed.properties.length).toBeGreaterThanOrEqual(4);
    expect(udaipurSeed.roomOffers.length).toBeGreaterThanOrEqual(6);
    expect(udaipurSeed.activities.length).toBeGreaterThanOrEqual(5);
  });

  it("contains a cheaper early flight and a hard-valid morning alternative", () => {
    const early = udaipurSeed.transportServices.find(
      (service) => service.id === "transport:del-udr-early",
    );
    const morning = udaipurSeed.transportServices.find(
      (service) => service.id === "transport:del-udr-morning",
    );
    expect(early?.priceAmount).toBeLessThan(morning?.priceAmount ?? 0);

    const earlySegment = udaipurSeed.transportSegments.find(
      (segment) => segment.serviceId === early?.id,
    );
    const morningSegment = udaipurSeed.transportSegments.find(
      (segment) => segment.serviceId === morning?.id,
    );
    expect(earlySegment?.departureLocalTime).toBe("05:50:00");
    expect(morningSegment?.departureLocalTime).toBe("09:20:00");
  });

  it("contains low and high mobility activity trade-offs", () => {
    expect(udaipurSeed.activities.some((activity) => activity.mobility === "low")).toBe(true);
    expect(udaipurSeed.activities.some((activity) => activity.mobility === "high")).toBe(true);
  });
});
