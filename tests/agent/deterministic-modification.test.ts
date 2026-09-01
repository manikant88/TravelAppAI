import { describe, expect, it, vi } from "vitest";
import {
  createDeterministicModificationModel,
  interpretModificationIntentHybrid,
  NoDeterministicModificationIntentError,
  SelectionTargetError,
} from "@/agent/deterministic-modification";
import type { ModificationPlannerModel } from "@/agent/modification-contracts";
import type { TripState } from "@/domain/model";

const trip = {
  id: "trip:goa",
  inventoryVersion: "travel-seed-v2",
  request: {
    origin: "city:delhi",
    destination: { kind: "specified", locationId: "city:goa" },
    startDate: "2026-12-15",
    endDate: "2026-12-18",
    travellers: [{ id: "traveller:1", type: "adult" }],
    preferences: { interests: ["food"] },
    constraints: [],
  },
  route: {
    marketId: "city:goa",
    stops: [{ locationId: "city:goa", checkIn: "2026-12-15", checkOut: "2026-12-18" }],
  },
  selectedTravel: [],
  selectedStays: [],
  selectedActivities: [],
  version: 1,
} satisfies TripState;

const selections = [
  { selectionId: "selection:travel", kind: "travel" as const, locked: false, label: "Delhi to Goa flight", offerId: "offer:flight" },
  { selectionId: "selection:stay", kind: "stay" as const, locked: false, label: "Goa Value Rooms", offerId: "offer:stay" },
  { selectionId: "selection:activity", kind: "activity" as const, locked: false, label: "Goa food walk", offerId: "offer:activity" },
];

describe("deterministic modification interpretation", () => {
  it("scopes an explicit cheaper-hotel request and preserves other selections", async () => {
    const result = await createDeterministicModificationModel().interpretModification({
      message: "Find a cheaper hotel but preserve my flight and activity.",
      trip,
      selections,
      supportedThemes: ["food", "beaches"],
    });

    expect(result).toMatchObject({
      action: "replace",
      targetSelectionId: "selection:stay",
      preserveSelectionIds: ["selection:travel", "selection:activity"],
    });
  });

  it("turns an explicit budget into a typed hard constraint without a model", async () => {
    const result = await createDeterministicModificationModel().interpretModification({
      message: "Update the total budget to ₹75,000.",
      trip,
      selections,
      supportedThemes: ["food", "beaches"],
    });

    expect(result).toMatchObject({
      action: "upsert_constraint",
      constraint: { category: "budget", priority: "hard", maxTotal: 75_000 },
      preserveSelectionIds: selections.map((selection) => selection.selectionId),
    });
  });

  it("recognizes a conversational trip budget with Indian digit grouping", async () => {
    const result = await createDeterministicModificationModel().interpretModification({
      message: "Let's make the trip possible in 1,50,000",
      trip,
      selections,
      supportedThemes: ["food", "beaches"],
    });

    expect(result).toMatchObject({
      action: "upsert_constraint",
      constraint: { category: "budget", priority: "hard", maxTotal: 150_000 },
      preserveSelectionIds: selections.map((selection) => selection.selectionId),
    });
  });

  it("understands a bounded multi-activity request scoped to an itinerary day", async () => {
    const result = await createDeterministicModificationModel().interpretModification({
      message: "Update day 3 with 2 activities, one outdoor adventure and one food and market experience.",
      trip,
      selections,
      supportedThemes: ["outdoors", "adventure", "food", "local"],
    });

    expect(result).toMatchObject({
      action: "add",
      targetDate: "2026-12-17",
      count: 2,
      replaceDayActivities: true,
    });
    expect(result.preferredThemes).toEqual(expect.arrayContaining(["adventure", "food"]));
  });

  it("removes the activity matching both day and mobility qualifiers", async () => {
    const result = await createDeterministicModificationModel().interpretModification({
      message: "Remove the high mobility activity from day 2.",
      trip,
      selections: [
        { selectionId: "activity:day-1", kind: "activity", locked: false, label: "Goa heritage story", offerId: "offer:day-1", startDate: "2026-12-15", mobility: "low" },
        { selectionId: "activity:day-2", kind: "activity", locked: false, label: "Goa outdoor adventure", offerId: "offer:day-2", startDate: "2026-12-16", mobility: "high" },
      ],
      supportedThemes: ["heritage", "outdoors"],
    });

    expect(result).toMatchObject({ action: "remove", targetSelectionId: "activity:day-2" });
  });

  it("targets travel by route role rather than selection order", async () => {
    const result = await createDeterministicModificationModel().interpretModification({
      message: "Replace the return flight with a later option.",
      trip,
      selections: [
        { selectionId: "travel:outbound", kind: "travel", locked: false, label: "Air India flight", offerId: "offer:out", startDate: "2026-12-15", role: "outbound" },
        { selectionId: "travel:return", kind: "travel", locked: false, label: "IndiGo flight", offerId: "offer:return", startDate: "2026-12-18", role: "return" },
      ],
      supportedThemes: [],
    });

    expect(result).toMatchObject({ action: "replace", targetSelectionId: "travel:return" });
  });

  it("targets the stay covering the supplied trip day", async () => {
    const result = await createDeterministicModificationModel().interpretModification({
      message: "Replace the stay on day 3 with a quieter hotel.",
      trip,
      selections: [
        { selectionId: "stay:first", kind: "stay", locked: false, label: "Goa Beach Hotel", offerId: "offer:first", startDate: "2026-12-15", endDate: "2026-12-17" },
        { selectionId: "stay:second", kind: "stay", locked: false, label: "Goa Quiet Retreat", offerId: "offer:second", startDate: "2026-12-17", endDate: "2026-12-19" },
      ],
      supportedThemes: [],
    });

    expect(result).toMatchObject({ action: "replace", targetSelectionId: "stay:second" });
  });

  it("rejects an underspecified target when multiple cards match", async () => {
    await expect(createDeterministicModificationModel().interpretModification({
      message: "Remove an activity.",
      trip,
      selections: [
        { selectionId: "activity:day-1", kind: "activity", locked: false, label: "Goa heritage story", offerId: "offer:day-1", startDate: "2026-12-15", mobility: "low" },
        { selectionId: "activity:day-2", kind: "activity", locked: false, label: "Goa outdoor adventure", offerId: "offer:day-2", startDate: "2026-12-16", mobility: "high" },
      ],
      supportedThemes: [],
    })).rejects.toThrow("More than one activity matches");
  });

  it("leaves unclassified natural language for semantic interpretation", async () => {
    await expect(createDeterministicModificationModel().interpretModification({
      message: "Could we bring the overall spending closer to one and a half lakh?",
      trip,
      selections,
      supportedThemes: ["food", "beaches"],
    })).rejects.toBeInstanceOf(NoDeterministicModificationIntentError);
  });

  it("uses the semantic model only when deterministic intent is not confident", async () => {
    const interpretModification = vi.fn(async () => ({
      action: "upsert_constraint" as const,
      constraint: {
        category: "budget" as const,
        priority: "hard" as const,
        targetTotal: null,
        maxTotal: 150_000,
      },
      preserveSelectionIds: selections.map((selection) => selection.selectionId),
      preferredThemes: [],
      goal: "Keep the trip near ₹1,50,000",
    }));
    const semanticModel: ModificationPlannerModel = {
      interpretModification,
      recommendModification: vi.fn(),
    };

    const result = await interpretModificationIntentHybrid({
      message: "Could we bring the overall spending closer to one and a half lakh?",
      trip,
      selections,
      supportedThemes: ["food", "beaches"],
    }, semanticModel);

    expect(interpretModification).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      action: "upsert_constraint",
      constraint: { category: "budget", maxTotal: 150_000 },
    });
  });

  it("does not let the semantic model guess an explicitly ambiguous card", async () => {
    const interpretModification = vi.fn();
    const semanticModel: ModificationPlannerModel = {
      interpretModification,
      recommendModification: vi.fn(),
    };

    await expect(interpretModificationIntentHybrid({
      message: "Remove an activity.",
      trip,
      selections: [
        { selectionId: "activity:day-1", kind: "activity", locked: false, label: "Goa heritage story", offerId: "offer:day-1", startDate: "2026-12-15", mobility: "low" },
        { selectionId: "activity:day-2", kind: "activity", locked: false, label: "Goa outdoor adventure", offerId: "offer:day-2", startDate: "2026-12-16", mobility: "high" },
      ],
      supportedThemes: [],
    }, semanticModel)).rejects.toBeInstanceOf(SelectionTargetError);
    expect(interpretModification).not.toHaveBeenCalled();
  });

  it("does not call the semantic model for a high-confidence typed command", async () => {
    const interpretModification = vi.fn();
    const semanticModel: ModificationPlannerModel = {
      interpretModification,
      recommendModification: vi.fn(),
    };

    const result = await interpretModificationIntentHybrid({
      message: "Find a cheaper hotel but preserve my flight and activity.",
      trip,
      selections,
      supportedThemes: ["food", "beaches"],
    }, semanticModel);

    expect(result).toMatchObject({ action: "replace", targetSelectionId: "selection:stay" });
    expect(interpretModification).not.toHaveBeenCalled();
  });
});
