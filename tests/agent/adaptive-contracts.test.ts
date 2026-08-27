import { describe, expect, it } from "vitest";
import {
  constraintConflictBlockSchema,
  optionComparisonBlockSchema,
} from "@/agent/adaptive-contracts";

describe("adaptive interaction contracts", () => {
  it("accepts a bounded comparison whose recommendation is one of its choices", () => {
    const block = optionComparisonBlockSchema.parse({
      type: "option_comparison",
      entityType: "stay",
      choices: [
        { optionId: "offer:stay:1", proposalId: "proposal:1" },
        { optionId: "offer:stay:2", proposalId: "proposal:2" },
      ],
      emphasis: {
        recommendedId: "offer:stay:2",
        comparisonDimensions: ["price", "location"],
        supportingFactIds: ["fact:stay:2:price"],
      },
    });

    expect(block.choices).toHaveLength(2);
  });

  it("rejects duplicate choices and recommendations outside the comparison", () => {
    expect(
      optionComparisonBlockSchema.safeParse({
        type: "option_comparison",
        entityType: "activity",
        choices: [
          { optionId: "offer:activity:1", proposalId: "proposal:1" },
          { optionId: "offer:activity:1", proposalId: "proposal:2" },
        ],
        emphasis: { recommendedId: "offer:activity:3" },
      }).success,
    ).toBe(false);
  });

  it("requires every grounded compromise to reference exactly one typed proposal or action", () => {
    expect(
      constraintConflictBlockSchema.safeParse({
        type: "constraint_conflict",
        constraintIds: ["constraint:budget"],
        alternatives: [
          {
            id: "compromise:budget",
            proposalId: "proposal:budget",
            actionId: "action:adjust:budget",
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      constraintConflictBlockSchema.parse({
        type: "constraint_conflict",
        constraintIds: ["constraint:budget"],
        alternatives: [
          { id: "compromise:budget", actionId: "action:adjust:constraint:budget" },
        ],
      }).alternatives[0].actionId,
    ).toBe("action:adjust:constraint:budget");
  });
});
