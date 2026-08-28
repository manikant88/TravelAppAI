import { describe, expect, it, vi } from "vitest";
import {
  runNaturalIntake,
  type NaturalIntakeModel,
} from "@/agent/natural-intake";
import type { NaturalTripIntent } from "@/agent/natural-intake-contracts";
import type { TripRequest } from "@/domain/model";
import type { createInventoryRepository } from "@/inventory/repository";

const emptyRequest: TripRequest = {
  travellers: [],
  preferences: {},
  constraints: [],
};

const completeIntent: NaturalTripIntent = {
  originQuery: "Delhi",
  destination: { kind: "specified", query: "Phuket" },
  startDate: "2026-10-10",
  endDate: "2026-10-15",
  travellerGroups: [{ type: "adult", count: 2, mobility: null }],
  pace: "relaxed",
  interests: ["beaches", "food"],
  constraints: [
    {
      category: "budget",
      priority: "hard",
      targetTotal: null,
      maxTotal: 80_000,
    },
  ],
};

function model(intent: NaturalTripIntent = completeIntent): NaturalIntakeModel {
  return { extractTripIntent: vi.fn(async () => intent) };
}

function repository() {
  return {
    getInventoryMeta: vi.fn(async () => ({
      version: "travel-seed-v1",
      supportedFrom: "2026-08-28",
      supportedUntil: "2027-03-31",
    })),
    getPlannerCatalog: vi.fn(async () => ({
      inventoryVersion: "travel-seed-v1",
      locationGraph: [
        { id: "city:delhi", name: "Delhi", timezone: "Asia/Kolkata" },
        { id: "country:th", name: "Thailand", timezone: "Asia/Bangkok" },
        {
          id: "city:phuket",
          parentId: "country:th",
          name: "Phuket",
          timezone: "Asia/Bangkok",
        },
      ],
      marketIds: ["country:th"],
      supportedThemes: ["beaches", "food"],
    })),
    searchLocations: vi.fn(async (query: string) => {
      if (query === "delhi") {
        return [
          {
            id: "city:delhi",
            name: "Delhi",
            type: "city" as const,
            countryCode: "IN",
            aliases: ["new delhi"],
          },
        ];
      }
      if (query === "phuket") {
        return [
          {
            id: "city:phuket",
            name: "Phuket",
            type: "city" as const,
            countryCode: "TH",
            aliases: [],
          },
        ];
      }
      return [];
    }),
  } as unknown as ReturnType<typeof createInventoryRepository>;
}

describe("natural-language trip intake", () => {
  it("skips the model when all required fields are explicit and resolvable", async () => {
    const extractTripIntent = vi.fn(async () => completeIntent);
    const result = await runNaturalIntake(
      {
        message: "Plan a relaxed trip from Delhi to Phuket for two adults from 10 October 2026 to 15 October 2026 under ₹80,000. We enjoy beaches and food.",
        currentRequest: emptyRequest,
      },
      { model: { extractTripIntent }, repository: repository(), today: () => "2026-08-28" },
    );

    expect(extractTripIntent).not.toHaveBeenCalled();
    expect(result.request).toMatchObject({
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "country:th" },
      startDate: "2026-10-10",
      endDate: "2026-10-15",
      travellers: [{ type: "adult" }, { type: "adult" }],
    });
  });

  it("resolves inventory locations, maps a child destination to its market, and applies a canonical patch", async () => {
    const result = await runNaturalIntake(
      { message: "A relaxed Phuket trip from Delhi for two adults", currentRequest: emptyRequest },
      { model: model(), repository: repository(), today: () => "2026-08-27" },
    );

    expect(result.request).toMatchObject({
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "country:th" },
      startDate: "2026-10-10",
      endDate: "2026-10-15",
      travellers: [
        { id: "traveller:1", type: "adult" },
        { id: "traveller:2", type: "adult" },
      ],
      preferences: { pace: "relaxed", interests: ["beaches", "food"] },
    });
    expect(result.request.constraints).toEqual([
      {
        id: "constraint:intake:budget",
        category: "budget",
        priority: "hard",
        value: { maxTotal: { amount: 80_000, currency: "INR" } },
      },
    ]);
    expect(result.resolvedLocations.destination).toEqual({
      id: "country:th",
      label: "Thailand",
    });
    expect(result.missingRequired).toEqual([]);
  });

  it("keeps unsupported locations out of canonical state and reports deterministic missing requirements", async () => {
    const unsupported = {
      ...completeIntent,
      originQuery: "Atlantis",
      destination: null,
      startDate: null,
      endDate: null,
      travellerGroups: [],
      pace: null,
      interests: [],
      constraints: [],
    } satisfies NaturalTripIntent;

    const result = await runNaturalIntake(
      { message: "Take me from Atlantis", currentRequest: emptyRequest },
      { model: model(unsupported), repository: repository() },
    );

    expect(result.request.origin).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "UNSUPPORTED_ORIGIN", field: "origin" }),
    ]);
    expect(result.missingRequired).toEqual([
      "origin",
      "destination_intent",
      "dates",
      "travellers",
    ]);
  });

  it("resolves an upcoming weekend deterministically when the model omits relative dates", async () => {
    const relativeIntent = {
      ...completeIntent,
      startDate: null,
      endDate: null,
      travellerGroups: [],
    } satisfies NaturalTripIntent;

    const result = await runNaturalIntake(
      {
        message: "I want a relaxed trip to Phuket this upcoming weekend",
        currentRequest: emptyRequest,
      },
      {
        model: model(relativeIntent),
        repository: repository(),
        today: () => "2026-08-27",
      },
    );

    expect(result.request.startDate).toBe("2026-08-29");
    expect(result.request.endDate).toBe("2026-08-31");
    expect(result.appliedFields).toContain("dates");
    expect(result.missingRequired).toContain("travellers");
  });

  it("preserves an explicit total party size with a named child and suggests ranges for a duration", async () => {
    const partialIntent = {
      ...completeIntent,
      originQuery: null,
      startDate: null,
      endDate: null,
      travellerGroups: [],
      pace: null,
      interests: [],
      constraints: [],
    } satisfies NaturalTripIntent;
    const currentRequest: TripRequest = {
      ...emptyRequest,
      origin: "city:delhi",
    };

    const result = await runNaturalIntake(
      { message: "Plan 5 days in Phuket for 6 people including my 4-year-old", currentRequest },
      { model: model(partialIntent), repository: repository(), today: () => "2026-08-28" },
    );

    expect(result.request.origin).toBe("city:delhi");
    expect(result.request.travellers.filter((traveller) => traveller.type === "adult")).toHaveLength(5);
    expect(result.request.travellers.filter((traveller) => traveller.type === "child")).toHaveLength(1);
    expect(result.missingRequired).not.toContain("origin");
    expect(result.missingRequired).toContain("dates");
    expect(result.suggestedDateRanges[0]).toEqual({
      id: "dates:tomorrow",
      label: "Tomorrow · 5 days",
      startDate: "2026-08-29",
      endDate: "2026-09-02",
    });
  });

  it("derives the end date deterministically from an explicit start and night count", async () => {
    const nightIntent = {
      ...completeIntent,
      startDate: "2026-09-02",
      endDate: null,
      travellerGroups: [{ type: "adult" as const, count: 2, mobility: null }],
    } satisfies NaturalTripIntent;

    const result = await runNaturalIntake(
      {
        message: "My wife and I are going from Delhi to Phuket for 3 nights on 2nd September under INR 40,000",
        currentRequest: emptyRequest,
      },
      { model: model(nightIntent), repository: repository(), today: () => "2026-08-28" },
    );

    expect(result.request.startDate).toBe("2026-09-02");
    expect(result.request.endDate).toBe("2026-09-05");
    expect(result.missingRequired).not.toContain("dates");
  });

  it("returns a typed retryable error when model extraction fails", async () => {
    const failingModel: NaturalIntakeModel = {
      async extractTripIntent() {
        throw new Error("offline");
      },
    };

    await expect(
      runNaturalIntake(
        { message: "Plan a trip from Delhi", currentRequest: emptyRequest },
        { model: failingModel, repository: repository() },
      ),
    ).rejects.toMatchObject({
      code: "MODEL_FAILURE",
      status: 502,
      retryable: true,
    });
  });
});
