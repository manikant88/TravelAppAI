import { describe, expect, it } from "vitest";
import { createDeterministicModificationModel } from "@/agent/deterministic-modification";
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
});
