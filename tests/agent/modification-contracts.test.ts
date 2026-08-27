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
