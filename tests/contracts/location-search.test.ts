import { describe, expect, it } from "vitest";
import {
  locationSearchQuerySchema,
  locationSearchResponseSchema,
} from "@/inventory/contracts";

const validResponse = {
  queryId: "query:abc123",
  inventoryVersion: "travel-seed-v1",
  results: [
    {
      id: "city:udaipur",
      name: "Udaipur",
      type: "city" as const,
      countryCode: "IN",
      parentLabel: "India",
    },
  ],
  resultCount: 1,
  appliedFilters: [{ type: "location" as const, label: "Active locations matching Udaipur" }],
  coverage: { status: "available" as const },
  generatedAt: "2026-08-26T12:00:00.000Z",
};

describe("location search API contract", () => {
  it("rejects empty and oversized external queries", () => {
    expect(locationSearchQuerySchema.safeParse({ q: "  " }).success).toBe(false);
    expect(locationSearchQuerySchema.safeParse({ q: "x".repeat(81) }).success).toBe(false);
  });

  it("keeps database-only location fields out of the public response", () => {
    expect(locationSearchResponseSchema.safeParse(validResponse).success).toBe(true);
    expect(
      locationSearchResponseSchema.safeParse({
        ...validResponse,
        results: [{ ...validResponse.results[0], aliases: ["City of Lakes"] }],
      }).success,
    ).toBe(false);
  });

  it("requires resultCount to match the public results", () => {
    expect(
      locationSearchResponseSchema.safeParse({ ...validResponse, resultCount: 2 }).success,
    ).toBe(false);
  });
});
