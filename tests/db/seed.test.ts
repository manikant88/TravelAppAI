import { describe, expect, it } from "vitest";
import { addCalendarDays, localDateTimeWithOffset } from "@/domain/dates";
import { travelInventorySeed, udaipurSeed } from "@/db/seed/data";
import { marketManifest } from "@/db/seed/market-manifest";
import { validateInventorySeed } from "@/db/seed/validate";

describe("inventory seed", () => {
  it("satisfies the shared market coverage contract", () => {
    expect(() => validateInventorySeed(travelInventorySeed)).not.toThrow();
    expect(travelInventorySeed.markets.length).toBeGreaterThanOrEqual(20);
    expect(travelInventorySeed.markets.filter((market) => market.region === "india").length).toBeGreaterThanOrEqual(10);
    expect(
      travelInventorySeed.markets.filter((market) => market.region === "international").length,
    ).toBeGreaterThanOrEqual(10);
    expect(marketManifest.length).toBeGreaterThanOrEqual(19);
    expect(travelInventorySeed.markets.map((market) => market.locationId)).toEqual(expect.arrayContaining([
      "city:udaipur",
      "city:mumbai",
      "city:chennai",
      "city:bengaluru",
      "city:hyderabad",
      "city:kolkata",
      "city:goa",
      "city:manali",
      "city:srinagar",
      "city:rishikesh",
      "city:kochi",
      "city:munnar",
      "city:puducherry",
      "city:darjeeling",
      "city:puri",
      "region:thailand-andaman",
      "city:bali",
      "city:singapore",
      "city:dubai",
      "city:tokyo",
      "city:paris",
      "city:rome",
      "city:london",
      "city:new-york",
      "city:sydney",
    ]));
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

  it("models Thailand multi-stop travel through normalized locations and transfers", () => {
    const thailand = travelInventorySeed.markets.find(
      (market) => market.locationId === "region:thailand-andaman",
    );
    expect(thailand?.region).toBe("international");

    const stops = travelInventorySeed.locations.filter(
      (location) => location.parentId === thailand?.locationId && location.type === "city",
    );
    expect(stops.map((stop) => stop.id).sort()).toEqual(["city:krabi", "city:phuket"]);
    expect(
      travelInventorySeed.transfers.some(
        (transfer) =>
          transfer.fromLocationId === "city:phuket" && transfer.toLocationId === "city:krabi",
      ),
    ).toBe(true);
    expect(
      travelInventorySeed.transfers.some(
        (transfer) =>
          transfer.fromLocationId === "city:krabi" && transfer.toLocationId === "city:phuket",
      ),
    ).toBe(true);
  });

  it("keeps every seeded segment duration correct at validity boundaries", () => {
    const timezones = new Map(
      travelInventorySeed.locations.map((location) => [location.id, location.timezone]),
    );
    const segmentsByService = new Map<string, typeof travelInventorySeed.transportSegments>();
    for (const segment of travelInventorySeed.transportSegments) {
      const segments = segmentsByService.get(segment.serviceId) ?? [];
      segments.push(segment);
      segmentsByService.set(segment.serviceId, segments);
    }

    for (const service of travelInventorySeed.transportServices) {
      for (const date of [service.validFrom, service.validUntil]) {
        for (const segment of segmentsByService.get(service.id) ?? []) {
          const fromTimezone = timezones.get(segment.fromLocationId);
          const toTimezone = timezones.get(segment.toLocationId);
          expect(fromTimezone, segment.id).toBeDefined();
          expect(toTimezone, segment.id).toBeDefined();
          const departureAt = localDateTimeWithOffset(
            date,
            segment.departureLocalTime,
            fromTimezone!,
          );
          const arrivalAt = localDateTimeWithOffset(
            addCalendarDays(date, segment.arrivalDayOffset ?? 0),
            segment.arrivalLocalTime,
            toTimezone!,
          );
          expect(
            Math.round((Date.parse(arrivalAt) - Date.parse(departureAt)) / 60_000),
            `${segment.id} on ${date}`,
          ).toBe(segment.durationMinutes);
        }
      }
    }
  });

  it("lets every city market act as an origin hub", () => {
    const marketIds = new Set(travelInventorySeed.markets.map((market) => market.locationId));
    const originHubIds = travelInventorySeed.locations
      .filter((location) => location.type === "city" && location.tags?.includes("origin_hub"))
      .map((location) => location.id)
      .sort();
    expect(originHubIds).toEqual(expect.arrayContaining([
      "city:bengaluru",
      "city:chennai",
      "city:delhi",
      "city:hyderabad",
      "city:kolkata",
      "city:mumbai",
    ]));
    for (const marketId of marketIds) {
      const location = travelInventorySeed.locations.find((item) => item.id === marketId);
      if (location?.type === "city") {
        expect(location.tags, marketId).toContain("origin_hub");
      }
    }
  });
});
