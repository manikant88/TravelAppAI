import { z } from "zod";
import type { SpecifiedDestinationPlannerModel } from "@/agent/coordinator";
import {
  coordinateSpecifiedDestinationPlan,
  PlanCoordinatorError,
  type SpecifiedPlanCoordinatorResult,
} from "@/agent/coordinator";
import { createInventoryToolServices } from "@/agent/executor";
import {
  plannableTripRequestSchema,
  requirePlannableRequest,
} from "@/domain/request";
import type { TripProjection } from "@/domain/trip";
import type { TripState } from "@/domain/model";
import {
  factBundleSchema,
  type FactBundle,
  type GroundedFact,
} from "@/agent/contracts";
import {
  constraintConflictBlockSchema,
  type ConstraintConflictBlock,
} from "@/agent/adaptive-contracts";
import { createInventoryRepository } from "@/inventory/repository";
import { resolveOffer } from "@/inventory/service";

export const specifiedPlanApiRequestSchema = z
  .object({
    tripId: z.string().trim().min(1).max(120),
    request: plannableTripRequestSchema,
    optionalClarificationUsed: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.request.destination.kind !== "specified") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This endpoint requires a specified destination",
        path: ["request", "destination"],
      });
    }
  });

export type SpecifiedPlanApiRequest = z.infer<typeof specifiedPlanApiRequestSchema>;

export type SpecifiedPlanApiResult =
  | {
      type: "trip_ready";
      trip: TripState;
      projection: TripProjection;
      message: string;
      actionSummary: string[];
    }
  | {
      type: "clarification";
      config: {
        kind: "optional";
        topic: "budget" | "pace" | "mobility" | "interests";
        question: string;
        allowCustomInput: boolean;
        allowSkip: true;
      };
      message: string;
    }
  | {
      type: "conflict";
      reason: "cannot_satisfy" | "invalid_after_repair";
      conflictFactIds: string[];
      suggestedRelaxationIds: string[];
      validation?: TripProjection["validation"];
      block: ConstraintConflictBlock;
      factBundle: FactBundle;
      message: string;
    };

export interface SpecifiedPlanApiDependencies {
  model: SpecifiedDestinationPlannerModel;
  repository?: ReturnType<typeof createInventoryRepository>;
  coordinator?: typeof coordinateSpecifiedDestinationPlan;
}

export class SpecifiedPlanApiError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REQUEST"
      | "UNKNOWN_LOCATION"
      | "MODEL_FAILURE"
      | "INVALID_MODEL_OUTPUT"
      | "INVENTORY_FAILURE"
      | "WORKFLOW_FAILURE",
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SpecifiedPlanApiError";
  }
}

const clarificationQuestions = {
  budget: "Would you like to set a target or maximum trip budget before I plan?",
  pace: "Would you prefer a relaxed, balanced, or packed trip?",
  mobility: "Are there any mobility needs I should prioritize?",
  interests: "Which kinds of experiences matter most for this trip?",
} as const;

function mapCoordinatorResult(
  result: SpecifiedPlanCoordinatorResult,
  tripId: string,
): SpecifiedPlanApiResult {
  if (result.status === "completed") {
    return {
      type: "trip_ready",
      trip: result.trip,
      projection: result.projection,
      message: "Your trip plan is ready to review.",
      actionSummary: [
        `Used ${result.trace.finalBudget.searchCallsUsed} grounded inventory searches`,
        `Validated the assembled trip ${result.trace.validationAttempts.length} time${result.trace.validationAttempts.length === 1 ? "" : "s"}`,
      ],
    };
  }
  if (result.status === "needs_optional_clarification") {
    return {
      type: "clarification",
      config: {
        kind: "optional",
        topic: result.topic,
        question: clarificationQuestions[result.topic],
        allowCustomInput: true,
        allowSkip: true,
      },
      message: "One optional detail could materially improve the plan.",
    };
  }
  if (result.status === "cannot_satisfy") {
    const fallbackFacts: GroundedFact[] = result.conflictFactIds.map((id) => ({
      id,
      subjectType: "trip",
      subjectId: tripId,
      dimension: "planning_conflict",
      label: "Grounded inventory conflict",
      value: "The supported inventory cannot satisfy the current plan scope",
    }));
    const fallbackActions: FactBundle["allowedFollowUpActions"] = result.suggestedRelaxationIds.map((id) => ({
      id,
      label: id.startsWith("action:adjust:")
        ? `Review constraint ${id.slice("action:adjust:".length)}`
        : "Change the requested trip scope",
      type: id.startsWith("action:adjust:") ? "adjust_constraint" as const : "change_scope" as const,
    }));
    if (fallbackActions.length === 0) {
      fallbackActions.push({
        id: "action:retry:planning-conflict",
        label: "Review the brief and search again",
        type: "retry",
      });
    }
    const factBundle = factBundleSchema.parse({
      facts: result.factBundle?.facts.length ? result.factBundle.facts : fallbackFacts,
      allowedComparisonDimensions: [],
      allowedFollowUpActions: result.factBundle?.allowedFollowUpActions.length
        ? result.factBundle.allowedFollowUpActions
        : fallbackActions,
    });
    const alternatives = factBundle.allowedFollowUpActions.slice(0, 3).map((action) => ({
      id: `compromise:${action.id}`,
      actionId: action.id,
    }));
    const block = constraintConflictBlockSchema.parse({
      type: "constraint_conflict",
      constraintIds: factBundle.allowedFollowUpActions.flatMap((action) =>
        action.id.startsWith("action:adjust:")
          ? [action.id.slice("action:adjust:".length)]
          : [],
      ).slice(0, 8),
      alternatives,
      emphasis: {
        recommendedId: alternatives[0].id,
        summary: "The request needs a grounded scope or constraint compromise before planning can continue.",
        supportingFactIds: factBundle.facts.map((fact) => fact.id).slice(0, 12),
        suggestedFollowUpActionIds: alternatives.map((item) => item.actionId),
      },
    });
    return {
      type: "conflict",
      reason: "cannot_satisfy",
      conflictFactIds: factBundle.facts.map((fact) => fact.id),
      suggestedRelaxationIds: factBundle.allowedFollowUpActions.map((action) => action.id),
      block,
      factBundle,
      message: "The available inventory cannot satisfy the current request.",
    };
  }
  const validationFacts: GroundedFact[] = result.projection.validation.issues.map((issue) => ({
    id: `fact:validation:${issue.id}`,
    subjectType: "trip",
    subjectId: tripId,
    dimension: "validation",
    label: issue.message,
    value: issue.code,
  }));
  if (validationFacts.length === 0) {
    validationFacts.push({
      id: "fact:validation:invalid-after-repair",
      subjectType: "trip",
      subjectId: tripId,
      dimension: "validation",
      label: "Final trip validation did not pass",
      value: false,
    });
  }
  const constraintIds = [...new Set(
    result.projection.validation.issues.flatMap((issue) => issue.constraintIds ?? []),
  )].slice(0, 8);
  const fallbackActions = constraintIds.length > 0
    ? constraintIds.slice(0, 3).map((constraintId) => ({
        id: `action:adjust:${constraintId}`,
        label: `Review constraint ${constraintId}`,
        type: "adjust_constraint" as const,
      }))
    : [{
        id: "action:change-scope:invalid-plan",
        label: "Change the requested trip scope",
        type: "change_scope" as const,
      }];
  const factBundle = factBundleSchema.parse({
    facts: result.factBundle?.facts.length ? result.factBundle.facts : validationFacts,
    allowedComparisonDimensions: ["validation"],
    allowedFollowUpActions: result.factBundle?.allowedFollowUpActions.length
      ? result.factBundle.allowedFollowUpActions
      : fallbackActions,
  });
  const alternatives = factBundle.allowedFollowUpActions.slice(0, 3).map((action) => ({
    id: `compromise:${action.id}`,
    actionId: action.id,
  }));
  return {
    type: "conflict",
    reason: "invalid_after_repair",
    conflictFactIds: factBundle.facts.map((fact) => fact.id),
    suggestedRelaxationIds: factBundle.allowedFollowUpActions.map((action) => action.id),
    validation: result.projection.validation,
    block: constraintConflictBlockSchema.parse({
      type: "constraint_conflict",
      constraintIds,
      alternatives,
      emphasis: {
        recommendedId: alternatives[0].id,
        summary: "The bounded repair was exhausted; the request needs an explicit compromise.",
        supportingFactIds: factBundle.facts.map((fact) => fact.id).slice(0, 12),
        suggestedFollowUpActionIds: alternatives.map((item) => item.actionId),
      },
    }),
    factBundle,
    message: "The revised strategy still does not produce a valid trip.",
  };
}

function mapCoordinatorError(error: unknown): SpecifiedPlanApiError {
  if (error instanceof SpecifiedPlanApiError) return error;
  if (error instanceof PlanCoordinatorError) {
    if (error.code === "INVALID_CONTEXT") {
      return new SpecifiedPlanApiError("INVALID_REQUEST", error.message, 400, false);
    }
    if (error.code === "MODEL_FAILURE") {
      return new SpecifiedPlanApiError(
        "MODEL_FAILURE",
        "The travel planner model is temporarily unavailable",
        502,
        true,
      );
    }
    if (error.code === "INVALID_MODEL_OUTPUT") {
      return new SpecifiedPlanApiError(
        "INVALID_MODEL_OUTPUT",
        "The travel planner returned an invalid bounded action",
        502,
        false,
      );
    }
    return new SpecifiedPlanApiError(
      "WORKFLOW_FAILURE",
      "The bounded planning workflow could not complete",
      500,
      false,
    );
  }
  return new SpecifiedPlanApiError(
    "INVENTORY_FAILURE",
    "Travel inventory is temporarily unavailable",
    503,
    true,
  );
}

export async function runSpecifiedPlanApi(
  rawRequest: unknown,
  dependencies: SpecifiedPlanApiDependencies,
): Promise<SpecifiedPlanApiResult> {
  const parsed = specifiedPlanApiRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    throw new SpecifiedPlanApiError(
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid specified PLAN request",
      400,
      false,
    );
  }

  const repository = dependencies.repository ?? createInventoryRepository();
  try {
    const canonicalRequest = requirePlannableRequest(parsed.data.request);
    const catalog = await repository.getPlannerCatalog();
    const knownLocationIds = new Set(catalog.locationGraph.map((node) => node.id));
    const destination = canonicalRequest.destination;
    if (
      !knownLocationIds.has(canonicalRequest.origin) ||
      destination.kind !== "specified" ||
      !knownLocationIds.has(destination.locationId)
    ) {
      throw new SpecifiedPlanApiError(
        "UNKNOWN_LOCATION",
        "The origin or destination is not in the active inventory catalog",
        400,
        false,
      );
    }

    const coordinator = dependencies.coordinator ?? coordinateSpecifiedDestinationPlan;
    const result = await coordinator({
      tripId: parsed.data.tripId,
      request: canonicalRequest,
      locationGraph: catalog.locationGraph,
      knownMarketIds: new Set(catalog.marketIds),
      supportedThemes: new Set(catalog.supportedThemes),
      optionalClarificationUsed: parsed.data.optionalClarificationUsed,
      expectedInventoryVersion: catalog.inventoryVersion,
      model: dependencies.model,
      inventoryServices: createInventoryToolServices(repository),
      resolveOffer: (offerId) => resolveOffer(offerId, repository),
    });
    return mapCoordinatorResult(result, parsed.data.tripId);
  } catch (error: unknown) {
    throw mapCoordinatorError(error);
  }
}
