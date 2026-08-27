import { z } from "zod";
import { constraintSchema } from "@/domain/request";

const idSchema = z.string().trim().min(1);
const unique = (values: string[]) => new Set(values).size === values.length;

export const semanticEmphasisSchema = z
  .object({
    recommendedId: idSchema.optional(),
    comparisonDimensions: z.array(z.string().trim().min(1)).max(8).optional(),
    summary: z.string().trim().min(1).max(320).optional(),
    supportingFactIds: z.array(idSchema).max(12).optional(),
    suggestedFollowUpActionIds: z.array(idSchema).max(6).optional(),
  })
  .strict();

export type SemanticEmphasis = z.infer<typeof semanticEmphasisSchema>;

export const optionComparisonBlockSchema = z
  .object({
    type: z.literal("option_comparison"),
    entityType: z.enum(["destination", "travel", "stay", "activity"]),
    choices: z
      .array(
        z
          .object({ optionId: idSchema, proposalId: idSchema.optional() })
          .strict(),
      )
      .min(2)
      .max(4),
    emphasis: semanticEmphasisSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!unique(value.choices.map((choice) => choice.optionId))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Option IDs must be unique" });
    }
    const proposalIds = value.choices.flatMap((choice) =>
      choice.proposalId ? [choice.proposalId] : [],
    );
    if (!unique(proposalIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Proposal IDs must be unique" });
    }
    if (
      value.emphasis?.recommendedId &&
      !value.choices.some((choice) => choice.optionId === value.emphasis?.recommendedId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recommended ID must be one of the compared options",
      });
    }
  });

export type OptionComparisonBlock = z.infer<typeof optionComparisonBlockSchema>;

export const changeProposalBlockSchema = z
  .object({
    type: z.literal("change_proposal"),
    proposalId: idSchema,
    emphasis: semanticEmphasisSchema.optional(),
  })
  .strict();

export type ChangeProposalBlock = z.infer<typeof changeProposalBlockSchema>;

export const constraintConflictBlockSchema = z
  .object({
    type: z.literal("constraint_conflict"),
    attemptedConstraint: constraintSchema.optional(),
    constraintIds: z.array(idSchema).max(8),
    alternatives: z
      .array(
        z
          .object({ id: idSchema, proposalId: idSchema.optional(), actionId: idSchema.optional() })
          .strict()
          .refine((value) => Boolean(value.proposalId) !== Boolean(value.actionId), {
            message: "A conflict alternative requires exactly one proposal or action ID",
          }),
      )
      .min(1)
      .max(3),
    emphasis: semanticEmphasisSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!unique(value.constraintIds) || !unique(value.alternatives.map((item) => item.id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Conflict IDs must be unique" });
    }
    const references = value.alternatives.map((item) => item.proposalId ?? item.actionId!);
    if (!unique(references)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Conflict alternative references must be unique" });
    }
    if (
      value.emphasis?.recommendedId &&
      !value.alternatives.some((item) => item.id === value.emphasis?.recommendedId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recommended ID must be one of the conflict alternatives",
      });
    }
    const actionIds = new Set(
      value.alternatives.flatMap((item) => item.actionId ? [item.actionId] : []),
    );
    if (
      value.emphasis?.suggestedFollowUpActionIds?.some((id) => !actionIds.has(id))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Suggested follow-up actions must be conflict alternatives",
      });
    }
  });

export type ConstraintConflictBlock = z.infer<typeof constraintConflictBlockSchema>;

export type InteractionBlock =
  | OptionComparisonBlock
  | ChangeProposalBlock
  | ConstraintConflictBlock;
