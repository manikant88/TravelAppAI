import { z } from "zod";
import type { GroundedFact } from "@/agent/contracts";
import type { FactBundle } from "@/agent/contracts";
import type { ProposalPreview, TripProposal } from "@/domain/proposals";
import type { TripProjection } from "@/domain/trip";
import type { TripState } from "@/domain/model";
import type {
  ChangeProposalBlock,
  ConstraintConflictBlock,
  OptionComparisonBlock,
} from "@/agent/adaptive-contracts";
import { naturalConstraintSchema } from "@/agent/natural-intake-contracts";

const idSchema = z.string().trim().min(1);

const intentShared = {
  preserveSelectionIds: z.array(idSchema),
  goal: z.string().trim().min(1).max(500),
  preferredThemes: z.array(z.string().trim().min(1)).max(8),
};

export const scopedModificationIntentSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["replace", "remove"]),
      targetSelectionId: idSchema,
      unlockTarget: z.boolean(),
      ...intentShared,
    })
    .strict(),
  z
    .object({
      action: z.literal("add"),
      targetDate: z.string().date(),
      unlockTarget: z.literal(false),
      ...intentShared,
    })
    .strict(),
  z
    .object({
      action: z.literal("upsert_constraint"),
      constraint: naturalConstraintSchema,
      ...intentShared,
    })
    .strict(),
  z
    .object({
      action: z.literal("remove_constraint"),
      constraintId: idSchema,
      ...intentShared,
    })
    .strict(),
]);

export type ScopedModificationIntent = z.infer<typeof scopedModificationIntentSchema>;

export const modificationRecommendationSchema = z
  .object({
    candidateId: idSchema,
    supportingFactIds: z.array(idSchema).min(1).max(8),
    comparisonDimensions: z
      .array(z.enum(["price", "timing", "duration", "comfort", "location", "activity_fit", "pace"]))
      .min(1)
      .max(5),
  })
  .strict();

export type ModificationRecommendation = z.infer<typeof modificationRecommendationSchema>;

export interface ModificationSelectionSummary {
  selectionId: string;
  kind: "travel" | "stay" | "activity";
  locked: boolean;
  label: string;
  offerId: string;
}

export interface ModificationCandidate {
  candidateId: string;
  facts: GroundedFact[];
}

export interface ModificationPlannerModel {
  interpretModification(input: {
    message: string;
    trip: TripState;
    selections: ModificationSelectionSummary[];
    supportedThemes: string[];
  }): Promise<ScopedModificationIntent>;
  recommendModification(input: {
    intent: ScopedModificationIntent;
    currentSelection?: ModificationSelectionSummary;
    targetDate?: string;
    candidates: ModificationCandidate[];
  }): Promise<ModificationRecommendation>;
}

export interface ModificationProposalOption {
  optionId: string;
  proposal: TripProposal;
  preview: ProposalPreview;
  projection: TripProjection;
  message: string;
}

export type ModificationResult =
  | {
      type: "proposal";
      proposal: TripProposal;
      preview: ProposalPreview;
      projection: TripProjection;
      block: ChangeProposalBlock;
      factBundle: FactBundle;
      message: string;
    }
  | {
      type: "alternatives";
      options: ModificationProposalOption[];
      block: OptionComparisonBlock;
      factBundle: FactBundle;
      message: string;
    }
  | {
      type: "conflict";
      code:
        | "LOCKED_SELECTION"
        | "NO_VALID_ALTERNATIVE"
        | "CONSTRAINT_CONFLICT"
        | "UNSUPPORTED_MODIFICATION";
      targetSelectionId?: string;
      proposals: ModificationProposalOption[];
      block: ConstraintConflictBlock;
      factBundle: FactBundle;
      message: string;
    };
