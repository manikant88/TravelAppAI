import { describe, expect, it, vi } from "vitest";
import {
  explicitFlexibleDateWindow,
  runNaturalIntake,
  type NaturalIntakeModel,
} from "@/agent/natural-intake";
import type { NaturalTripIntent } from "@/agent/natural-intake-contracts";
import { intakePresentation } from "@/agent/interaction-guidance";
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
  dateWindow: null,
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
        { id: "city:mumbai", name: "Mumbai", timezone: "Asia/Kolkata" },
        { id: "city:tokyo", name: "Tokyo", timezone: "Asia/Tokyo" },
        { id: "country:th", name: "Thailand", timezone: "Asia/Bangkok" },
        {
          id: "region:thailand-andaman",
          parentId: "country:th",
          name: "Thailand — Phuket & Krabi",
          timezone: "Asia/Bangkok",
        },
        {
          id: "city:phuket",
          parentId: "country:th",
          name: "Phuket",
          timezone: "Asia/Bangkok",
        },
      ],
      marketIds: ["city:mumbai", "city:tokyo", "country:th", "region:thailand-andaman"],
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
      if (query === "thailand — phuket & krabi") {
        return [
          {
            id: "region:thailand-andaman",
            name: "Thailand — Phuket & Krabi",
            type: "region" as const,
            countryCode: "TH",
            aliases: ["phuket and krabi"],
          },
        ];
      }
      if (query === "mumbai") {
        return [
          {
            id: "city:mumbai",
            name: "Mumbai",
            type: "city" as const,
            countryCode: "IN",
            aliases: ["bombay"],
          },
        ];
      }
      if (query === "tokyo") {
        return [
          {
            id: "city:tokyo",
            name: "Tokyo",
            type: "city" as const,
            countryCode: "JP",
            aliases: [],
          },
        ];
      }
      return [];
    }),
  } as unknown as ReturnType<typeof createInventoryRepository>;
}

describe("natural-language trip intake", () => {
  it("preserves the full span of a multi-month exploration phrase", () => {
    expect(explicitFlexibleDateWindow(
      "Bhutan for 7 days in March / April / May 2027",
      "2026-09-01",
    )).toEqual({
      kind: "flexible_window",
      earliestStart: "2027-03-01",
      latestEnd: "2027-05-31",
      durationDays: 7,
      label: "March–May 2027",
    });
  });

  it("separates a named destination from a plural seasonal window", async () => {
    const result = await runNaturalIntake(
      {
        message: "Plan a trip to Tokyo in summers 2027 for a family of 4",
        currentRequest: emptyRequest,
      },
      { repository: repository(), today: () => "2026-09-01" },
    );

    expect(result.request.destination).toEqual({
      kind: "specified",
      locationId: "city:tokyo",
    });
    expect(result.resolvedLocations.destination).toEqual({
      id: "city:tokyo",
      label: "Tokyo",
    });
    expect(result.request.dateWindow).toEqual({
      kind: "flexible_window",
      earliestStart: "2027-06-01",
      latestEnd: "2027-08-31",
      label: "Summer 2027",
    });
    expect(result.missingRequired).not.toContain("destination_intent");
    expect(result.missingRequired).toContain("dates");
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "OUTSIDE_INVENTORY_WINDOW",
        field: "dates",
      }),
    ]);
  });

  it("lets a verified model location survive when a deterministic phrase cannot resolve", async () => {
    const inferred: NaturalTripIntent = {
      ...completeIntent,
      originQuery: null,
      destination: { kind: "specified", query: "Tokyo" },
      startDate: null,
      endDate: null,
      dateWindow: {
        kind: "flexible_window",
        earliestStart: "2027-06-01",
        latestEnd: "2027-08-31",
        durationDays: null,
        label: "Summer 2027",
      },
      constraints: [],
    };
    const result = await runNaturalIntake(
      {
        message: "Plan a trip to the Tokyo area in summer 2027",
        currentRequest: emptyRequest,
      },
      { model: model(inferred), repository: repository(), today: () => "2026-09-01" },
    );

    expect(result.request.destination).toEqual({ kind: "specified", locationId: "city:tokyo" });
    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNSUPPORTED_DESTINATION" }),
    ]));
  });
  it("uses model-first understanding while preserving explicit deterministic facts", async () => {
    const extractTripIntent = vi.fn(async () => completeIntent);
    const result = await runNaturalIntake(
      {
        message: "Plan a relaxed trip from Delhi to Phuket for two adults from 10 October 2026 to 15 October 2026 under ₹80,000. We enjoy beaches and food.",
        currentRequest: emptyRequest,
      },
      { model: { extractTripIntent }, repository: repository(), today: () => "2026-08-28" },
    );

    expect(extractTripIntent).toHaveBeenCalledOnce();
    expect(result.request).toMatchObject({
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "country:th" },
      startDate: "2026-10-10",
      endDate: "2026-10-15",
      travellers: [{ type: "adult" }, { type: "adult" }],
    });
  });

  it("keeps a named destination when the user asks for itinerary suggestions", async () => {
    const result = await runNaturalIntake(
      {
        message: "Plan a relaxed trip from Delhi to Phuket for two adults from 10 October 2026 to 15 October 2026. Suggest a balanced itinerary.",
        currentRequest: emptyRequest,
      },
      { repository: repository(), today: () => "2026-08-28" },
    );

    expect(result.request.destination).toEqual({
      kind: "specified",
      locationId: "country:th",
    });
    expect(result.resolvedLocations.destination?.label).toBe("Thailand");
  });

  it("preserves a canonical destination while a short follow-up supplies the awaited origin", async () => {
    const currentRequest: TripRequest = {
      ...emptyRequest,
      destination: { kind: "specified", locationId: "city:mumbai" },
      startDate: "2026-10-10",
      endDate: "2026-10-13",
      travellers: [{ id: "traveller:1", type: "adult" }],
    };
    const result = await runNaturalIntake(
      {
        message: "Delhi",
        currentRequest,
        context: {
          history: [],
          activeInteraction: {
            mode: "build",
            task: "complete_trip_brief",
            awaitingFields: ["origin"],
            availableActions: [],
          },
        },
      },
      { repository: repository(), today: () => "2026-08-28" },
    );

    expect(result.issues).toEqual([]);
    expect(result.request.origin).toBe("city:delhi");
    expect(result.request.destination).toEqual({ kind: "specified", locationId: "city:mumbai" });
    expect(result.missingRequired).toEqual([]);
  });

  it("keeps pace words out of the interest list", async () => {
    const result = await runNaturalIntake(
      {
        message: "Plan a relaxed food trip from Delhi to Mumbai for two adults from 10 October 2026 to 13 October 2026",
        currentRequest: emptyRequest,
      },
      { repository: repository(), today: () => "2026-08-28" },
    );

    expect(result.request.preferences.pace).toBe("relaxed");
    expect(result.request.preferences.interests).not.toContain("relaxed");
  });

  it("preserves a compound destination containing an em dash and ampersand", async () => {
    const extractTripIntent = vi.fn(async () => completeIntent);
    const result = await runNaturalIntake(
      {
        message: "Plan an adventurous friends trip from Delhi to Thailand — Phuket & Krabi for four adults from 10 October 2026 to 13 October 2026.",
        currentRequest: emptyRequest,
      },
      { model: { extractTripIntent }, repository: repository(), today: () => "2026-08-31" },
    );

    expect(extractTripIntent).toHaveBeenCalledOnce();
    expect(result.request.destination).toEqual({
      kind: "specified",
      locationId: "region:thailand-andaman",
    });
    expect(result.resolvedLocations.destination).toEqual({
      id: "region:thailand-andaman",
      label: "Thailand — Phuket & Krabi",
    });
    expect(result.missingRequired).toEqual([]);
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

  it("preserves an explicit total party size without inventing a travel window", async () => {
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
    expect(result.suggestedDateRanges).toEqual([]);
  });

  it("does not recommend near-term dates when only a duration is known", async () => {
    const result = await runNaturalIntake(
      {
        message: "Plan a family-friendly 5-day holiday to Phuket for two adults",
        currentRequest: emptyRequest,
      },
      { repository: repository(), today: () => "2026-08-28" },
    );

    expect(result.suggestedDateRanges).toEqual([]);
  });

  it("preserves a month and duration as a flexible window and suggests dates inside it", async () => {
    const result = await runNaturalIntake(
      {
        message: "I'm planning a trip to Goa with my wife for 4 days in November",
        currentRequest: emptyRequest,
      },
      { repository: repository(), today: () => "2026-09-01" },
    );

    expect(result.request.dateWindow).toEqual({
      kind: "flexible_window",
      earliestStart: "2026-11-01",
      latestEnd: "2026-11-30",
      durationDays: 4,
      label: "November 2026",
    });
    expect(result.request.startDate).toBeUndefined();
    expect(result.request.endDate).toBeUndefined();
    expect(result.missingRequired).toContain("dates");
    expect(result.suggestedDateRanges).toEqual([
      expect.objectContaining({ startDate: "2026-11-01", endDate: "2026-11-04" }),
      expect.objectContaining({ startDate: "2026-11-14", endDate: "2026-11-17" }),
      expect.objectContaining({ startDate: "2026-11-27", endDate: "2026-11-30" }),
    ]);
  });

  it("merges a duration-only follow-up into the active window and replaces the prompt with date choices", async () => {
    const result = await runNaturalIntake(
      {
        message: "6 days",
        currentRequest: {
          ...emptyRequest,
          origin: "city:delhi",
          destination: { kind: "specified", locationId: "city:tokyo" },
          dateWindow: {
            kind: "flexible_window",
            earliestStart: "2027-03-01",
            latestEnd: "2027-03-31",
            label: "March 2027",
          },
          travellers: [{ id: "traveller:1", type: "adult" }],
        },
      },
      { repository: repository(), today: () => "2026-09-01" },
    );

    expect(result.request.dateWindow?.durationDays).toBe(6);
    expect(result.suggestedDateRanges).toHaveLength(3);
    expect(intakePresentation(result, "intake:duration").actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set_dates", startDate: "2027-03-01", endDate: "2027-03-06" }),
      ]),
    );
    expect(intakePresentation(result, "intake:duration").actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "request_date_recommendation" })]),
    );
  });

  it("asks for a different window instead of another duration when inventory cannot cover it", async () => {
    const result = await runNaturalIntake(
      {
        message: "6 days",
        currentRequest: {
          ...emptyRequest,
          origin: "city:delhi",
          destination: { kind: "specified", locationId: "city:tokyo" },
          dateWindow: {
            kind: "flexible_window",
            earliestStart: "2067-06-01",
            latestEnd: "2067-08-31",
            label: "Summer 2067",
          },
        },
      },
      { repository: repository(), today: () => "2026-09-01" },
    );

    expect(result.request.dateWindow?.durationDays).toBe(6);
    expect(result.suggestedDateRanges).toEqual([]);
    expect(intakePresentation(result, "intake:outside").actions).toContainEqual(
      expect.objectContaining({
        type: "request_date_recommendation",
        reason: "change_window",
        label: "Choose another travel window",
      }),
    );

    const changedWindow = await runNaturalIntake(
      {
        message: "March 2027",
        currentRequest: result.request,
      },
      { repository: repository(), today: () => "2026-09-01" },
    );
    expect(changedWindow.request.dateWindow).toMatchObject({
      label: "March 2027",
      durationDays: 6,
    });
    expect(changedWindow.issues).toEqual([]);
    expect(changedWindow.suggestedDateRanges).toHaveLength(3);
  });

  it("preserves a seasonal window without manufacturing exact dates", async () => {
    const result = await runNaturalIntake(
      {
        message: "Help me explore a 7 day winter trip",
        currentRequest: emptyRequest,
      },
      { repository: repository(), today: () => "2026-09-01" },
    );

    expect(result.request.dateWindow).toMatchObject({
      earliestStart: "2026-12-01",
      latestEnd: "2027-02-28",
      durationDays: 7,
      label: "Winter 2026–2027",
    });
    expect(result.request.startDate).toBeUndefined();
    expect(result.missingRequired).toContain("dates");
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

  it("derives an inclusive date range from an ordinal date with 'of' and a day count", async () => {
    const result = await runNaturalIntake(
      {
        message: "plan me a 4 day trip to mumbai from delhi on 1st of september for 2 adults",
        currentRequest: emptyRequest,
      },
      { repository: repository(), today: () => "2026-08-31" },
    );

    expect(result.request).toMatchObject({
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "city:mumbai" },
      startDate: "2026-09-01",
      endDate: "2026-09-04",
      travellers: [{ type: "adult" }, { type: "adult" }],
    });
    expect(result.missingRequired).toEqual([]);
    expect(result.suggestedDateRanges).toEqual([]);
  });

  it("keeps explicit facts and returns deterministic missing requirements when model extraction fails", async () => {
    const failingModel: NaturalIntakeModel = {
      async extractTripIntent() {
        throw new Error("offline");
      },
    };

    const result = await runNaturalIntake(
        { message: "Plan a trip from Delhi", currentRequest: emptyRequest },
        { model: failingModel, repository: repository() },
      );

    expect(result.request.origin).toBe("city:delhi");
    expect(result.missingRequired).toEqual(["destination_intent", "dates", "travellers"]);
    expect(result.message).toContain("Please add destination, dates, travellers");
  });

  it("uses the awaited field to interpret a bare origin follow-up", async () => {
    const extractTripIntent = vi.fn(async () => completeIntent);
    const currentRequest: TripRequest = {
      destination: { kind: "specified", locationId: "city:mumbai" },
      startDate: "2026-10-10",
      endDate: "2026-10-13",
      travellers: [{ id: "traveller:1", type: "adult" }],
      preferences: {},
      constraints: [],
    };
    const result = await runNaturalIntake(
      {
        message: "Delhi",
        currentRequest,
        context: {
          history: [{ role: "assistant", text: "Where will you be travelling from?" }],
          activeInteraction: {
            mode: "build",
            task: "complete_trip_brief",
            awaitingFields: ["origin"],
            lastAssistantMessage: "Where will you be travelling from?",
            availableActions: [],
          },
        },
      },
      { model: { extractTripIntent }, repository: repository(), today: () => "2026-08-31" },
    );

    expect(extractTripIntent).toHaveBeenCalledOnce();
    expect(result.request.origin).toBe("city:delhi");
    expect(result.missingRequired).toEqual([]);
  });

  it("resolves an ordinal reply only against the options actually presented", async () => {
    const currentRequest: TripRequest = {
      destination: { kind: "specified", locationId: "city:mumbai" },
      startDate: "2026-10-10",
      endDate: "2026-10-13",
      travellers: [{ id: "traveller:1", type: "adult" }],
      preferences: {},
      constraints: [],
    };
    const result = await runNaturalIntake(
      {
        message: "the second one",
        currentRequest,
        context: {
          history: [],
          activeInteraction: {
            mode: "build",
            task: "complete_trip_brief",
            awaitingFields: ["origin"],
            availableActions: [
              { id: "origin:mumbai", type: "set_location", field: "origin", locationId: "city:mumbai", label: "Mumbai" },
              { id: "origin:delhi", type: "set_location", field: "origin", locationId: "city:delhi", label: "Delhi" },
            ],
          },
        },
      },
      { repository: repository(), today: () => "2026-08-31" },
    );

    expect(result.request.origin).toBe("city:delhi");
  });

  it("keeps an unconstrained request in open recommendation mode without inventing dates or travellers", async () => {
    const result = await runNaturalIntake(
      {
        message: "Plan a trip without anything in mind",
        currentRequest: emptyRequest,
        context: { history: [] },
      },
      { repository: repository(), today: () => "2026-08-31" },
    );

    expect(result.request.destination).toEqual({ kind: "open" });
    expect(result.request.startDate).toBeUndefined();
    expect(result.request.travellers).toEqual([]);
    expect(result.missingRequired).toEqual(["origin", "dates", "travellers"]);
    expect(result.suggestedDateRanges).toEqual([]);
  });
});
