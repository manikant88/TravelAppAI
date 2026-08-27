import { describe, expect, it } from "vitest";
import {
  transportSearchRequestSchema,
  transportSearchResponseSchema,
} from "@/inventory/contracts";

describe("transport search API contract", () => {
  it("validates traveller references and typed local-time constraints", () => {
    const baseRequest = {
      from: "city:delhi",
      to: "city:udaipur",
      date: "2026-10-10",
      travellers: [{ id: "traveller:1", type: "adult" }],
      constraints: [],
    };

    expect(transportSearchRequestSchema.safeParse(baseRequest).success).toBe(true);
    expect(
      transportSearchRequestSchema.safeParse({
        ...baseRequest,
        constraints: [
          {
            id: "constraint:early",
            category: "travel",
            priority: "hard",
            travellerIds: ["traveller:missing"],
            value: { earliestDeparture: "25:00" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects database-only service fields in the public offer", () => {
    const response = {
      queryId: "query:transport",
      inventoryVersion: "travel-seed-v1",
      results: [
        {
          id: "offer:transport:example",
          serviceId: "transport:del-udr-morning",
          mode: "flight",
          from: "airport:del",
          to: "airport:udr",
          departureAt: "2026-10-10T09:20:00+05:30",
          arrivalAt: "2026-10-10T10:45:00+05:30",
          durationMinutes: 85,
          stops: 0,
          operator: "IndiGo",
          segments: [
            {
              from: "airport:del",
              to: "airport:udr",
              departureAt: "2026-10-10T09:20:00+05:30",
              arrivalAt: "2026-10-10T10:45:00+05:30",
              operator: "IndiGo",
              number: "6E 2421",
            },
          ],
          price: { amount: 6_900, currency: "INR", unit: "per_traveller" },
        },
      ],
      resultCount: 1,
      appliedFilters: [{ type: "date", label: "Departure date 2026-10-10" }],
      coverage: { status: "available" },
      generatedAt: "2026-08-26T12:00:00.000Z",
    };

    expect(transportSearchResponseSchema.safeParse(response).success).toBe(true);
    expect(
      transportSearchResponseSchema.safeParse({
        ...response,
        results: [{ ...response.results[0], validFrom: "2026-09-01" }],
      }).success,
    ).toBe(false);
  });
});
