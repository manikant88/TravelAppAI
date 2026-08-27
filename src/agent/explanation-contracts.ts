import { z } from "zod";
import type { FactBundle } from "@/agent/contracts";

const idSchema = z.string().trim().min(1);

export const explanationSentenceSchema = z
  .object({
    text: z.string().trim().min(1).max(320),
    supportingFactIds: z.array(idSchema).min(1).max(5),
  })
  .strict();

export const explanationDraftSchema = z
  .object({
    sentences: z.array(explanationSentenceSchema).min(1).max(3),
  })
  .strict();

export type ExplanationDraft = z.infer<typeof explanationDraftSchema>;

export interface ExplanationModel {
  explain(input: {
    question: string;
    targetSelectionId?: string;
    factBundle: FactBundle;
  }): Promise<ExplanationDraft>;
}

export interface ExplanationResult {
  type: "explanation";
  message: string;
  supportingFactIds: string[];
  factBundle: FactBundle;
  targetSelectionId?: string;
  usedFallback: boolean;
}
