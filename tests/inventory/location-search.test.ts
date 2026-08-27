import { describe, expect, it } from "vitest";
import { locationSearchResponseSchema } from "@/inventory/contracts";
import type {
  LocationInventoryRepository,
  LocationInventoryRow,
} from "@/inventory/repository";
import { normalizeLocationQuery, searchLocations } from "@/inventory/service";

const rows: LocationInventoryRow[] = [
  {
    id: "city:udaipur",
    name: "Udaipur",
    type: "city",
    countryCode: "IN",
    parentLabel: "India",
    aliases: ["City of Lakes"],
  },
  {
    id: "airport:udr",
    name: "Maharana Pratap Airport",
    type: "airport",
    countryCode: "IN",
    parentLabel: "Udaipur",
    airportCode: "UDR",
    aliases: ["Udaipur Airport", "Dabok Airport"],
  },
];

function createRepository(): LocationInventoryRepository {
  return {
    async getInventoryMeta() {
      return {
        version: "travel-seed-v1",
        supportedFrom: "2026-09-01",
        supportedUntil: "2027-03-31",
      };
    },
    async searchLocations(query) {
      return rows.filter((row) =>
        [row.name, row.airportCode, ...row.aliases]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalizeLocationQuery(value).includes(query)),
      );
    },
  };
}

describe("location inventory search", () => {
  it("normalizes an alias to one stable location result", async () => {
    const response = await searchLocations(
      { q: "  CITY   OF LAKES " },
      createRepository(),
      () => new Date("2026-08-26T12:00:00.000Z"),
    );

    expect(response.results).toEqual([
      {
        id: "city:udaipur",
        name: "Udaipur",
        type: "city",
        countryCode: "IN",
        parentLabel: "India",
      },
    ]);
    expect(response.coverage).toEqual({ status: "available" });
    expect(locationSearchResponseSchema.parse(response)).toEqual(response);
  });

  it("uses inventory version and normalized input for a stable query ID", async () => {
    const first = await searchLocations({ q: "UDR" }, createRepository());
    const second = await searchLocations({ q: " udr " }, createRepository());

    expect(first.queryId).toBe(second.queryId);
    expect(first.results[0]?.id).toBe("airport:udr");
  });

  it("distinguishes unsupported coverage from an available result", async () => {
    const response = await searchLocations({ q: "Tokyo" }, createRepository());

    expect(response.results).toEqual([]);
    expect(response.resultCount).toBe(0);
    expect(response.coverage).toEqual({ status: "unsupported_location" });
  });
});
