import { z } from "zod";
import { requestPatchSchema } from "@/domain/request";
import { coverageResultSchema } from "@/inventory/contracts";

const idSchema = z.string().trim().min(1);
const uniqueStrings = (values: string[]) => new Set(values).size === values.length;

export const agentIntentSchema = z.union([
  z.object({ type: z.literal("plan_trip") }).strict(),
  z
    .object({
      type: z.literal("modify_trip"),
      targetKinds: z.array(z.enum(["travel", "stay", "activity", "budget"])).min(1),
      targetSelectionIds: z.array(idSchema),
      preserveSelectionIds: z.array(idSchema),
      goal: z.string().trim().min(1).max(500),
    })
    .strict()
    .superRefine((value, context) => {
      if (!uniqueStrings(value.targetKinds)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Target kinds must be unique", path: ["targetKinds"] });
      }
      if (!uniqueStrings(value.targetSelectionIds) || !uniqueStrings(value.preserveSelectionIds)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Selection IDs must be unique" });
      }
      const preserved = new Set(value.preserveSelectionIds);
      if (value.targetSelectionIds.some((id) => preserved.has(id))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "A selection cannot be both targeted and preserved" });
      }
    }),
  z
    .object({
      type: z.literal("explain"),
      question: z.string().trim().min(1).max(500),
      selectionId: idSchema.optional(),
    })
    .strict(),
]);

export type AgentIntent = z.infer<typeof agentIntentSchema>;

export const agentIntakeSchema = z
  .object({
    intent: agentIntentSchema,
    requestPatch: requestPatchSchema,
  })
  .strict();

export type AgentIntake = z.infer<typeof agentIntakeSchema>;

const toolCallBase = {
  id: idSchema,
  purpose: z.string().trim().min(1).max(240),
};

export const plannerToolCallSchema = z.union([
  z
    .object({
      ...toolCallBase,
      tool: z.literal("discover_destinations"),
      candidateMarketIds: z.array(idSchema).max(6).optional(),
    })
    .strict()
    .refine((value) => !value.candidateMarketIds || uniqueStrings(value.candidateMarketIds), {
      message: "Candidate market IDs must be unique",
      path: ["candidateMarketIds"],
    }),
  z
    .object({
      ...toolCallBase,
      tool: z.literal("search_transport"),
      from: idSchema,
      to: idSchema,
      tripDayNumber: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...toolCallBase,
      tool: z.literal("search_stays"),
      locationId: idSchema,
      checkInDayNumber: z.number().int().positive(),
      nights: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...toolCallBase,
      tool: z.literal("search_activities"),
      locationId: idSchema,
      tripDayNumbers: z.array(z.number().int().positive()).min(1),
      themes: z.array(z.string().trim().min(1)).max(12),
    })
    .strict()
    .superRefine((value, context) => {
      if (!uniqueStrings(value.tripDayNumbers.map(String))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Activity trip days must be unique", path: ["tripDayNumbers"] });
      }
      if (!uniqueStrings(value.themes.map((theme) => theme.toLocaleLowerCase("en")))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Activity themes must be unique", path: ["themes"] });
      }
    }),
  z
    .object({
      ...toolCallBase,
      tool: z.literal("search_transfers"),
      from: idSchema,
      to: idSchema,
    })
    .strict()
    .refine((value) => value.from !== value.to, {
      message: "Transfer origin and destination must differ",
      path: ["to"],
    }),
]);

export type PlannerToolCall = z.infer<typeof plannerToolCallSchema>;
export type PlannerToolName = PlannerToolCall["tool"];

export const toolPlanSchema = z
  .object({
    operationalSummary: z.string().trim().min(1).max(280),
    calls: z.array(plannerToolCallSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.calls.map((call) => call.id);
    if (!uniqueStrings(ids)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Tool call IDs must be unique", path: ["calls"] });
    }
  });

export type ToolPlan = z.infer<typeof toolPlanSchema>;

export const groundedFactSchema = z
  .object({
    id: idSchema,
    subjectType: z.enum(["market", "transport", "stay", "activity", "transfer", "trip"]),
    subjectId: idSchema,
    dimension: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    value: z.union([z.string(), z.number().finite(), z.boolean()]),
  })
  .strict();

export type GroundedFact = z.infer<typeof groundedFactSchema>;

export const candidateFactBundleSchema = z
  .object({
    candidateId: idSchema,
    facts: z.array(groundedFactSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (!uniqueStrings(value.facts.map((fact) => fact.id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate fact IDs must be unique", path: ["facts"] });
    }
    value.facts.forEach((fact, index) => {
      if (fact.subjectId !== value.candidateId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Candidate facts must reference their candidate ID",
          path: ["facts", index, "subjectId"],
        });
      }
    });
  });

export type CandidateFactBundle = z.infer<typeof candidateFactBundleSchema>;

const rejectedSummarySchema = z
  .object({
    reason: z.string().trim().min(1).max(180),
    count: z.number().int().nonnegative(),
    constraintIds: z.array(idSchema).optional(),
  })
  .strict();

export const observationBundleSchema = z
  .object({
    queryId: idSchema,
    toolName: z.enum([
      "discover_destinations",
      "search_transport",
      "search_stays",
      "search_activities",
      "search_transfers",
    ]),
    coverage: coverageResultSchema,
    candidates: z.array(candidateFactBundleSchema).max(8),
    rejectedSummary: z.array(rejectedSummarySchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (!uniqueStrings(value.candidates.map((candidate) => candidate.candidateId))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Observation candidate IDs must be unique", path: ["candidates"] });
    }
    const factIds = value.candidates.flatMap((candidate) => candidate.facts.map((fact) => fact.id));
    if (!uniqueStrings(factIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Observation fact IDs must be globally unique", path: ["candidates"] });
    }
    if (value.coverage.status !== "available" && value.candidates.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Unavailable observations cannot expose candidates", path: ["candidates"] });
    }
    if (value.toolName === "discover_destinations" && value.candidates.length > 6) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Destination discovery returns at most six candidates", path: ["candidates"] });
    }
  });

export type ObservationBundle = z.infer<typeof observationBundleSchema>;

export const allowedFollowUpActionSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1).max(160),
    type: z.enum(["adjust_constraint", "change_scope", "retry", "keep_current"]),
  })
  .strict();

export const factBundleSchema = z
  .object({
    facts: z.array(groundedFactSchema),
    allowedComparisonDimensions: z.array(z.string().trim().min(1)).max(12),
    allowedFollowUpActions: z.array(allowedFollowUpActionSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (!uniqueStrings(value.facts.map((fact) => fact.id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Fact IDs must be unique", path: ["facts"] });
    }
    if (!uniqueStrings(value.allowedComparisonDimensions)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Comparison dimensions must be unique", path: ["allowedComparisonDimensions"] });
    }
    if (!uniqueStrings(value.allowedFollowUpActions.map((action) => action.id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Follow-up action IDs must be unique", path: ["allowedFollowUpActions"] });
    }
  });

export type FactBundle = z.infer<typeof factBundleSchema>;

const preferenceDimensionSchema = z.enum([
  "price",
  "timing",
  "duration",
  "comfort",
  "location",
  "activity_fit",
  "pace",
]);

export const planningHypothesisSchema = z
  .object({
    goalSummary: z.string().trim().min(1).max(400),
    destinationMode: z.enum(["specified", "broad_scope", "open_ended"]),
    candidateMarketIds: z.array(idSchema).max(6),
    proposedStopIds: z.array(idSchema).max(6),
    nightAllocation: z.array(z.number().int().positive()).max(6),
    preferenceOrder: z.array(preferenceDimensionSchema).min(1),
    preserveSelectionIds: z.array(idSchema),
    toolPlan: toolPlanSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!uniqueStrings(value.candidateMarketIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Candidate market IDs must be unique", path: ["candidateMarketIds"] });
    }
    if (!uniqueStrings(value.proposedStopIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Proposed stop IDs must be unique", path: ["proposedStopIds"] });
    }
    if (!uniqueStrings(value.preferenceOrder)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Preference dimensions must be unique", path: ["preferenceOrder"] });
    }
    if (!uniqueStrings(value.preserveSelectionIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Preserved selection IDs must be unique", path: ["preserveSelectionIds"] });
    }
    if (value.proposedStopIds.length !== value.nightAllocation.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Every proposed stop requires one night allocation", path: ["nightAllocation"] });
    }
    if (value.destinationMode !== "open_ended" && value.proposedStopIds.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Specified and broad-scope hypotheses require a proposed stop", path: ["proposedStopIds"] });
    }
  });

export type PlanningHypothesis = z.infer<typeof planningHypothesisSchema>;

export const candidateChoiceSchema = z
  .object({
    decisionId: idSchema,
    candidateId: idSchema,
    supportingFactIds: z.array(idSchema).min(1),
    comparisonDimensions: z.array(z.string().trim().min(1)).min(1),
    summary: z.string().trim().min(1).max(280).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!uniqueStrings(value.supportingFactIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Supporting fact IDs must be unique", path: ["supportingFactIds"] });
    }
    if (!uniqueStrings(value.comparisonDimensions)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Comparison dimensions must be unique", path: ["comparisonDimensions"] });
    }
  });

export type CandidateChoice = z.infer<typeof candidateChoiceSchema>;

export const agentNextActionSchema = z.union([
  z.object({ type: z.literal("search_more"), toolPlan: toolPlanSchema }).strict(),
  z.object({ type: z.literal("clarify"), topic: z.enum(["budget", "pace", "mobility", "interests"]) }).strict(),
  z
    .object({
      type: z.literal("present_destination_options"),
      candidateMarketIds: z.array(idSchema).min(2).max(4),
      recommendedMarketId: idSchema,
      supportingFactIds: z.array(idSchema).min(1),
    })
    .strict()
    .refine((value) => value.candidateMarketIds.includes(value.recommendedMarketId), {
      message: "Recommended market must be one of the presented candidates",
      path: ["recommendedMarketId"],
    })
    .superRefine((value, context) => {
      if (!uniqueStrings(value.candidateMarketIds)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Presented market IDs must be unique", path: ["candidateMarketIds"] });
      }
      if (!uniqueStrings(value.supportingFactIds)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Supporting fact IDs must be unique", path: ["supportingFactIds"] });
      }
    }),
  z
    .object({
      type: z.literal("propose_plan"),
      marketId: idSchema,
      stopIds: z.array(idSchema).min(1).max(6),
      nightAllocation: z.array(z.number().int().positive()).min(1).max(6),
      choices: z.array(candidateChoiceSchema).min(1),
    })
    .strict()
    .refine((value) => value.stopIds.length === value.nightAllocation.length, {
      message: "Every proposed stop requires one night allocation",
      path: ["nightAllocation"],
    })
    .superRefine((value, context) => {
      if (!uniqueStrings(value.stopIds)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Proposed stop IDs must be unique", path: ["stopIds"] });
      }
      if (!uniqueStrings(value.choices.map((choice) => choice.decisionId))) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Decision IDs must be unique", path: ["choices"] });
      }
    }),
  z
    .object({
      type: z.literal("cannot_satisfy"),
      conflictFactIds: z.array(idSchema).min(1),
      suggestedRelaxationIds: z.array(idSchema),
    })
    .strict()
    .superRefine((value, context) => {
      if (!uniqueStrings(value.conflictFactIds) || !uniqueStrings(value.suggestedRelaxationIds)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Conflict and relaxation IDs must be unique" });
      }
    }),
]);

export type AgentNextAction = z.infer<typeof agentNextActionSchema>;

export interface PlannerScope {
  tripDurationDays: number;
  tripNights: number;
  knownLocationIds: ReadonlySet<string>;
  knownMarketIds: ReadonlySet<string>;
  knownSelectionIds: ReadonlySet<string>;
  supportedThemes: ReadonlySet<string>;
}

export interface PlannerBudgetState {
  evidenceRoundsUsed: number;
  repairRoundsUsed: number;
  searchCallsUsed: number;
  optionalClarificationUsed: boolean;
  priorCallSignatures: ReadonlySet<string>;
}

export interface ContractViolation {
  code:
    | "INVALID_SHAPE"
    | "INVALID_INTENT"
    | "UNKNOWN_ID"
    | "INVALID_TRIP_DAY"
    | "UNSUPPORTED_THEME"
    | "DUPLICATE_CALL"
    | "TOOL_BUDGET_EXCEEDED"
    | "EVIDENCE_ROUND_EXCEEDED"
    | "CLARIFICATION_ALREADY_USED"
    | "UNKNOWN_CANDIDATE"
    | "UNKNOWN_FACT"
    | "FACT_CANDIDATE_MISMATCH"
    | "UNSUPPORTED_COMPARISON"
    | "INVALID_NIGHT_ALLOCATION"
    | "UNKNOWN_FOLLOW_UP_ACTION";
  message: string;
  referenceId?: string;
}

export interface ContractValidation<T> {
  valid: boolean;
  value?: T;
  violations: ContractViolation[];
}

export interface AgentIntentScope {
  hasTrip: boolean;
  knownSelectionIds: ReadonlySet<string>;
}

export function validateAgentIntake(
  input: AgentIntake,
  scope: AgentIntentScope,
): ContractValidation<AgentIntake> {
  const parsed = agentIntakeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      violations: parsed.error.issues.map((item) => ({ code: "INVALID_SHAPE", message: item.message })),
    };
  }
  const intake = parsed.data;
  const violations: ContractViolation[] = [];
  if (intake.intent.type === "plan_trip" && scope.hasTrip) {
    violations.push({ code: "INVALID_INTENT", message: "An existing trip must be changed through modify_trip" });
  }
  if (intake.intent.type === "modify_trip") {
    if (!scope.hasTrip) violations.push({ code: "INVALID_INTENT", message: "modify_trip requires an existing trip" });
    violations.push(
      ...unknownIdViolations(
        [...intake.intent.targetSelectionIds, ...intake.intent.preserveSelectionIds],
        scope.knownSelectionIds,
        "selection ID",
      ),
    );
  }
  if (intake.intent.type === "explain" && intake.intent.selectionId && !scope.knownSelectionIds.has(intake.intent.selectionId)) {
    violations.push({ code: "UNKNOWN_ID", message: `Unknown selection ID: ${intake.intent.selectionId}`, referenceId: intake.intent.selectionId });
  }
  if (scope.hasTrip && Object.keys(intake.requestPatch).length > 0) {
    violations.push({ code: "INVALID_INTENT", message: "Request patches cannot mutate an existing trip; use proposal operations" });
  }
  return { valid: violations.length === 0, value: violations.length === 0 ? intake : undefined, violations };
}

function normalizeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLocaleLowerCase("en")))].sort();
}

export function toolCallSignature(call: PlannerToolCall): string {
  switch (call.tool) {
    case "discover_destinations":
      return `${call.tool}:${[...(call.candidateMarketIds ?? [])].sort().join(",")}`;
    case "search_transport":
      return `${call.tool}:${call.from}:${call.to}:${call.tripDayNumber}`;
    case "search_stays":
      return `${call.tool}:${call.locationId}:${call.checkInDayNumber}:${call.nights}`;
    case "search_activities":
      return `${call.tool}:${call.locationId}:${[...call.tripDayNumbers].sort((a, b) => a - b).join(",")}:${normalizeStrings(call.themes).join(",")}`;
    case "search_transfers":
      return `${call.tool}:${call.from}:${call.to}`;
  }
  throw new Error("Unsupported planner tool call");
}

function unknownIdViolations(ids: string[], knownIds: ReadonlySet<string>, label: string): ContractViolation[] {
  return ids
    .filter((id) => !knownIds.has(id))
    .map((id) => ({ code: "UNKNOWN_ID" as const, message: `Unknown ${label}: ${id}`, referenceId: id }));
}

export function validateToolPlan(
  input: ToolPlan,
  scope: PlannerScope,
  budget: PlannerBudgetState,
  roundKind: "evidence" | "repair" = "evidence",
): ContractValidation<ToolPlan> {
  const parsed = toolPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      violations: parsed.error.issues.map((item) => ({ code: "INVALID_SHAPE", message: item.message })),
    };
  }
  const plan = parsed.data;
  const violations: ContractViolation[] = [];
  if (budget.searchCallsUsed + plan.calls.length > 12) {
    violations.push({ code: "TOOL_BUDGET_EXCEEDED", message: "PLAN workflow permits at most 12 search calls" });
  }
  if (roundKind === "evidence" && budget.evidenceRoundsUsed >= 2) {
    violations.push({ code: "EVIDENCE_ROUND_EXCEEDED", message: "PLAN workflow permits at most two evidence rounds" });
  }
  if (roundKind === "repair" && budget.repairRoundsUsed >= 1) {
    violations.push({ code: "EVIDENCE_ROUND_EXCEEDED", message: "PLAN workflow permits at most one repair round" });
  }

  const seen = new Set(budget.priorCallSignatures);
  for (const call of plan.calls) {
    const signature = toolCallSignature(call);
    if (seen.has(signature)) {
      violations.push({ code: "DUPLICATE_CALL", message: `Search call does not materially differ: ${signature}`, referenceId: call.id });
    }
    seen.add(signature);
    if (call.tool === "discover_destinations") {
      violations.push(...unknownIdViolations(call.candidateMarketIds ?? [], scope.knownMarketIds, "market ID"));
    } else if (call.tool === "search_transport") {
      violations.push(...unknownIdViolations([call.from, call.to], scope.knownLocationIds, "location ID"));
      if (call.tripDayNumber > scope.tripDurationDays) violations.push({ code: "INVALID_TRIP_DAY", message: `Trip day ${call.tripDayNumber} is outside the trip`, referenceId: call.id });
    } else if (call.tool === "search_stays") {
      violations.push(...unknownIdViolations([call.locationId], scope.knownLocationIds, "location ID"));
      if (call.checkInDayNumber + call.nights > scope.tripDurationDays) violations.push({ code: "INVALID_TRIP_DAY", message: "Stay nights extend beyond the trip", referenceId: call.id });
    } else if (call.tool === "search_activities") {
      violations.push(...unknownIdViolations([call.locationId], scope.knownLocationIds, "location ID"));
      call.tripDayNumbers.filter((day) => day > scope.tripDurationDays).forEach((day) => violations.push({ code: "INVALID_TRIP_DAY", message: `Trip day ${day} is outside the trip`, referenceId: call.id }));
      call.themes.filter((theme) => !scope.supportedThemes.has(theme.toLocaleLowerCase("en"))).forEach((theme) => violations.push({ code: "UNSUPPORTED_THEME", message: `Unsupported activity theme: ${theme}`, referenceId: call.id }));
    } else {
      violations.push(...unknownIdViolations([call.from, call.to], scope.knownLocationIds, "location ID"));
    }
  }
  return { valid: violations.length === 0, value: violations.length === 0 ? plan : undefined, violations };
}

export function validatePlanningHypothesis(
  input: PlanningHypothesis,
  scope: PlannerScope,
  budget: PlannerBudgetState,
): ContractValidation<PlanningHypothesis> {
  const parsed = planningHypothesisSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, violations: parsed.error.issues.map((item) => ({ code: "INVALID_SHAPE", message: item.message })) };
  }
  const hypothesis = parsed.data;
  const violations = [
    ...unknownIdViolations(hypothesis.candidateMarketIds, scope.knownMarketIds, "market ID"),
    ...unknownIdViolations(hypothesis.proposedStopIds, scope.knownLocationIds, "stop ID"),
    ...unknownIdViolations(hypothesis.preserveSelectionIds, scope.knownSelectionIds, "selection ID"),
  ];
  if (
    hypothesis.nightAllocation.length > 0 &&
    hypothesis.nightAllocation.reduce((total, nights) => total + nights, 0) !== scope.tripNights
  ) {
    violations.push({ code: "INVALID_NIGHT_ALLOCATION", message: "Hypothesis night allocation must equal trip nights" });
  }
  violations.push(...validateToolPlan(hypothesis.toolPlan, scope, budget).violations);
  return { valid: violations.length === 0, value: violations.length === 0 ? hypothesis : undefined, violations };
}

export interface NextActionScope extends PlannerScope {
  observations: ObservationBundle[];
  factBundles: FactBundle[];
}

export function validateAgentNextAction(
  input: AgentNextAction,
  scope: NextActionScope,
  budget: PlannerBudgetState,
): ContractValidation<AgentNextAction> {
  const parsed = agentNextActionSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, violations: parsed.error.issues.map((item) => ({ code: "INVALID_SHAPE", message: item.message })) };
  }
  const action = parsed.data;
  const violations: ContractViolation[] = [];
  const candidateFacts = new Map<string, Set<string>>();
  const allFactIds = new Set<string>();
  scope.observations.forEach((observation) =>
    observation.candidates.forEach((candidate) => {
      const facts = candidateFacts.get(candidate.candidateId) ?? new Set<string>();
      candidate.facts.forEach((fact) => {
        facts.add(fact.id);
        allFactIds.add(fact.id);
      });
      candidateFacts.set(candidate.candidateId, facts);
    }),
  );
  const allowedComparisonDimensions = new Set(
    scope.factBundles.flatMap((bundle) => bundle.allowedComparisonDimensions),
  );
  const allowedFollowUpActionIds = new Set(
    scope.factBundles.flatMap((bundle) => bundle.allowedFollowUpActions.map((action) => action.id)),
  );
  scope.factBundles.forEach((bundle) => bundle.facts.forEach((fact) => allFactIds.add(fact.id)));

  if (action.type === "search_more") {
    violations.push(...validateToolPlan(action.toolPlan, scope, budget).violations);
  } else if (action.type === "clarify") {
    if (budget.optionalClarificationUsed) violations.push({ code: "CLARIFICATION_ALREADY_USED", message: "Optional clarification has already been used" });
  } else if (action.type === "present_destination_options") {
    violations.push(...unknownIdViolations(action.candidateMarketIds, scope.knownMarketIds, "market ID"));
    action.candidateMarketIds.filter((id) => !candidateFacts.has(id)).forEach((id) => violations.push({ code: "UNKNOWN_CANDIDATE", message: `Market ${id} is not present in observations`, referenceId: id }));
    const recommendedFacts = candidateFacts.get(action.recommendedMarketId) ?? new Set<string>();
    action.supportingFactIds.forEach((id) => {
      if (!allFactIds.has(id)) {
        violations.push({ code: "UNKNOWN_FACT", message: `Unknown supporting fact: ${id}`, referenceId: id });
      } else if (!recommendedFacts.has(id)) {
        violations.push({ code: "FACT_CANDIDATE_MISMATCH", message: `Fact ${id} does not ground recommended market ${action.recommendedMarketId}`, referenceId: id });
      }
    });
  } else if (action.type === "propose_plan") {
    violations.push(...unknownIdViolations([action.marketId], scope.knownMarketIds, "market ID"));
    violations.push(...unknownIdViolations(action.stopIds, scope.knownLocationIds, "stop ID"));
    if (action.nightAllocation.reduce((total, nights) => total + nights, 0) !== scope.tripNights) violations.push({ code: "INVALID_NIGHT_ALLOCATION", message: "Proposed plan night allocation must equal trip nights" });
    action.choices.forEach((choice) => {
      const facts = candidateFacts.get(choice.candidateId);
      if (!facts) {
        violations.push({ code: "UNKNOWN_CANDIDATE", message: `Unknown or hard-invalid candidate: ${choice.candidateId}`, referenceId: choice.candidateId });
        return;
      }
      choice.supportingFactIds.forEach((factId) => {
        if (!facts.has(factId)) violations.push({ code: "FACT_CANDIDATE_MISMATCH", message: `Fact ${factId} does not ground candidate ${choice.candidateId}`, referenceId: factId });
      });
      choice.comparisonDimensions.filter((dimension) => !allowedComparisonDimensions.has(dimension)).forEach((dimension) => violations.push({ code: "UNSUPPORTED_COMPARISON", message: `Unsupported comparison dimension: ${dimension}` }));
    });
  } else {
    action.conflictFactIds.filter((id) => !allFactIds.has(id)).forEach((id) => violations.push({ code: "UNKNOWN_FACT", message: `Unknown conflict fact: ${id}`, referenceId: id }));
    action.suggestedRelaxationIds.filter((id) => !allowedFollowUpActionIds.has(id)).forEach((id) => violations.push({ code: "UNKNOWN_FOLLOW_UP_ACTION", message: `Unknown suggested relaxation: ${id}`, referenceId: id }));
  }
  return { valid: violations.length === 0, value: violations.length === 0 ? action : undefined, violations };
}
