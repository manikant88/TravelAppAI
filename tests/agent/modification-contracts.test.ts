import { describe, expect, it } from "vitest";
import {
  modificationRecommendationSchema,
  scopedModificationIntentSchema,
} from "@/agent/modification-contracts";

describe("modification model contracts", () => {
  it("accepts one typed scoped modification", () => {
    expect(
      scopedModificationIntentSchema.parse({
        action: "replace",
        targetSelectionId: "selection:stay",
        preserveSelectionIds: ["selection:outbound"],
        goal: "Find a cheaper stay",
        unlockTarget: false,
        preferredThemes: [],
      }),
    ).toMatchObject({ targetSelectionId: "selection:stay", unlockTarget: false });
  });

  it("accepts a dated activity addition without inventing a target selection", () => {
    expect(
      scopedModificationIntentSchema.parse({
        action: "add",
        targetDate: "2026-10-11",
        count: null,
        replaceDayActivities: null,
        preserveSelectionIds: ["selection:stay"],
        goal: "Add something cultural",
        unlockTarget: false,
        preferredThemes: ["culture"],
      }),
    ).toMatchObject({ action: "add", targetDate: "2026-10-11" });
  });

  it("accepts typed constraint upsert and removal intents", () => {
    expect(
      scopedModificationIntentSchema.parse({
        action: "upsert_constraint",
        constraint: {
          category: "budget",
          priority: "hard",
          targetTotal: null,
          maxTotal: 75_000,
        },
        preserveSelectionIds: [],
        goal: "Keep the trip under ₹75,000",
        preferredThemes: [],
      }),
    ).toMatchObject({ action: "upsert_constraint", constraint: { category: "budget" } });
    expect(
      scopedModificationIntentSchema.parse({
        action: "remove_constraint",
        constraintId: "constraint:budget:all",
        preserveSelectionIds: [],
        goal: "Remove the budget limit",
        preferredThemes: [],
      }),
    ).toMatchObject({ action: "remove_constraint", constraintId: "constraint:budget:all" });
  });

  it("rejects arbitrary actions and comparison dimensions", () => {
    expect(
      scopedModificationIntentSchema.safeParse({
        action: "rewrite_trip",
        targetSelectionId: "selection:stay",
        preserveSelectionIds: [],
        goal: "Change everything",
        unlockTarget: false,
        preferredThemes: [],
      }).success,
    ).toBe(false);
    expect(
      modificationRecommendationSchema.safeParse({
        candidateId: "offer:stay:2",
        supportingFactIds: ["fact:price"],
        comparisonDimensions: ["weather"],
      }).success,
    ).toBe(false);
  });
});
