import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { factBundleSchema, type GroundedFact } from "@/agent/contracts";
import {
  changeProposalBlockSchema,
  constraintConflictBlockSchema,
  optionComparisonBlockSchema,
} from "@/agent/adaptive-contracts";
import { factsForInventoryOffer } from "@/agent/executor";
import {
  scopedModificationIntentSchema,
  type ModificationPlannerModel,
  type ModificationResult,
  type ModificationProposalOption,
  type ModificationSelectionSummary,
  type ScopedModificationIntent,
} from "@/agent/modification-contracts";
import type {
  ActivitySelection,
  StaySelection,
  TravelSelection,
  TripState,
} from "@/domain/model";
import {
  deriveProposalPreview,
  type ProposalEvaluation,
  type TripOperation,
  type TripProposal,
} from "@/domain/proposals";
import { projectTrip, tripStateSchema, type ResolvedOffer } from "@/domain/trip";
import { createInventoryRepository } from "@/inventory/repository";
import {
  resolveOffer,
  searchActivities,
  searchStays,
  searchTransfers,
  searchTransport,
} from "@/inventory/service";
import type { CoverageResult } from "@/inventory/contracts";

const modifyRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(800),
    trip: tripStateSchema,
  })
  .strict();

type Selection = TravelSelection | StaySelection | ActivitySelection;

export interface ModifyDependencies {
  model: ModificationPlannerModel;
  repository?: ReturnType<typeof createInventoryRepository>;
  createId?: () => string;
}

export class ModifyError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REQUEST"
      | "INVALID_MODEL_OUTPUT"
      | "MODEL_FAILURE"
      | "INVENTORY_FAILURE",
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ModifyError";
  }
}

function allSelections(trip: TripState): Selection[] {
  return [...trip.selectedTravel, ...trip.selectedStays, ...trip.selectedActivities];
}

function selectionLabel(selection: Selection, offer: ResolvedOffer): string {
  if (selection.kind === "stay" && "roomOfferId" in offer) return offer.propertyFacts.name;
  if (selection.kind === "activity" && "sessionId" in offer) return offer.activityFacts.name;
  if ("serviceId" in offer) return `${offer.operator} ${offer.mode}`;
  if ("transferId" in offer) return `${offer.mode} transfer`;
  return selection.id;
}

function allowedDimensions(offer: ResolvedOffer): string[] {
  if ("serviceId" in offer) return ["price", "timing", "duration", "comfort"];
  if ("roomOfferId" in offer) return ["price", "comfort", "location"];
  if ("sessionId" in offer) return ["price", "timing", "duration", "activity_fit", "pace"];
  return ["price", "duration", "comfort"];
}

function travellersFor(trip: TripState, selection: Selection) {
  const selected = new Set(selection.travellerIds);
  return trip.request.travellers.filter((traveller) => selected.has(traveller.id));
}

function constraintsFor(trip: TripState, category: "travel" | "stay" | "activity") {
  return trip.request.constraints.filter((constraint) => constraint.category === category);
}

async function searchAlternatives(
  trip: TripState,
  selection: Selection,
  currentOffer: ResolvedOffer,
  intent: ScopedModificationIntent,
  repository: ReturnType<typeof createInventoryRepository>,
): Promise<{ offers: ResolvedOffer[]; coverage: CoverageResult }> {
  const travellers = travellersFor(trip, selection);
  if (selection.kind === "travel" && "serviceId" in currentOffer) {
    const result = await searchTransport(
      {
        from: currentOffer.from,
        to: currentOffer.to,
        date: currentOffer.departureAt.slice(0, 10),
        travellers,
        constraints: constraintsFor(trip, "travel"),
      },
      repository,
    );
    return { offers: result.results.filter((offer) => offer.id !== currentOffer.id).slice(0, 4), coverage: result.coverage };
  }
  if (selection.kind === "travel" && "transferId" in currentOffer) {
    const result = await searchTransfers(
      { from: currentOffer.from, to: currentOffer.to, travellers },
      repository,
    );
    return { offers: result.results.filter((offer) => offer.id !== currentOffer.id).slice(0, 4), coverage: result.coverage };
  }
  if (selection.kind === "stay" && "roomOfferId" in currentOffer) {
    const result = await searchStays(
      {
        locationId: currentOffer.locationId,
        checkIn: selection.checkIn,
        checkOut: selection.checkOut,
        travellers,
        constraints: constraintsFor(trip, "stay"),
      },
      repository,
    );
    return { offers: result.results.filter((offer) => offer.id !== currentOffer.id).slice(0, 4), coverage: result.coverage };
  }
  if (selection.kind === "activity" && "sessionId" in currentOffer) {
    const interests = intent.preferredThemes.length > 0
      ? intent.preferredThemes
      : (trip.request.preferences.interests ?? []);
    const result = await searchActivities(
      {
        locationId: currentOffer.locationId,
        startDate: selection.date,
        endDate: selection.date,
        travellers,
        interests,
        constraints: constraintsFor(trip, "activity"),
      },
      repository,
    );
    return { offers: result.results.filter((offer) => offer.id !== currentOffer.id).slice(0, 4), coverage: result.coverage };
  }
  return { offers: [], coverage: { status: "unsupported_route" } };
}

function conflictFact(
  tripId: string,
  dimension: string,
  label: string,
  value: string | number | boolean,
): GroundedFact {
  return {
    id: `fact:conflict:${createHash("sha256")
      .update(`${tripId}:${dimension}:${String(value)}`)
      .digest("hex")
      .slice(0, 20)}`,
    subjectType: "trip",
    subjectId: tripId,
    dimension,
    label,
    value,
  };
}

function proposalOption(
  optionId: string,
  proposal: TripProposal,
  evaluation: ProposalEvaluation,
  message: string,
): ModificationProposalOption {
  return {
    optionId,
    proposal,
    preview: evaluation.preview,
    projection: evaluation.projection,
    message,
  };
}

async function lockConflict(
  trip: TripState,
  projection: Awaited<ReturnType<typeof projectTrip>>,
  selection: Selection,
  label: string,
  context: Parameters<typeof projectTrip>[1],
  createId: () => string,
): Promise<Extract<ModificationResult, { type: "conflict" }>> {
  const proposal: TripProposal = {
    id: `proposal:${createId()}`,
    baseTripVersion: trip.version,
    operations: [{ type: "set_selection_lock", selectionId: selection.id, locked: false }],
  };
  const evaluation = await deriveProposalPreview(trip, proposal, projection, context);
  const option = proposalOption(
    `compromise:unlock:${selection.id}`,
    proposal,
    evaluation,
    `Unlock ${label}; the current inventory choice remains unchanged.`,
  );
  const fact = conflictFact(
    trip.id,
    "locked_selection",
    "Requested selection is locked",
    selection.id,
  );
  return {
    type: "conflict",
    code: "LOCKED_SELECTION",
    targetSelectionId: selection.id,
    proposals: [option],
    block: constraintConflictBlockSchema.parse({
      type: "constraint_conflict",
      constraintIds: [],
      alternatives: [{ id: option.optionId, proposalId: proposal.id }],
      emphasis: {
        recommendedId: option.optionId,
        summary: "Unlocking requires explicit approval before this selection can change.",
        supportingFactIds: [fact.id],
      },
    }),
    factBundle: factBundleSchema.parse({
      facts: [fact],
      allowedComparisonDimensions: ["locked_selection"],
      allowedFollowUpActions: [],
    }),
    message: `${label} is locked. You can keep it, or approve a separate unlock proposal before requesting a replacement.`,
  };
}

async function noAlternativeConflict(
  trip: TripState,
  projection: Awaited<ReturnType<typeof projectTrip>>,
  selection: Selection,
  coverage: CoverageResult,
  context: Parameters<typeof projectTrip>[1],
  createId: () => string,
): Promise<Extract<ModificationResult, { type: "conflict" }>> {
  const constraintIds =
    coverage.status === "eliminated_by_constraints" ? coverage.constraintIds.slice(0, 2) : [];
  const proposals = (
    await Promise.all(
      constraintIds.map(async (constraintId) => {
        const proposal: TripProposal = {
          id: `proposal:${createId()}`,
          baseTripVersion: trip.version,
          operations: [{ type: "remove_constraint", constraintId }],
        };
        try {
          const evaluation = await deriveProposalPreview(trip, proposal, projection, context);
          return proposalOption(
            `compromise:remove:${constraintId}`,
            proposal,
            evaluation,
            `Remove constraint ${constraintId}, then retry the replacement search.`,
          );
        } catch {
          return undefined;
        }
      }),
    )
  ).flatMap((option) => (option ? [option] : []));
  const fact = conflictFact(
    trip.id,
    "alternative_coverage",
    "Replacement search coverage",
    coverage.status,
  );
  const keepAction = {
    id: `action:keep-current:${selection.id}`,
    label: "Keep the current selection",
    type: "keep_current" as const,
  };
  const alternatives = [
    ...proposals.map((option) => ({ id: option.optionId, proposalId: option.proposal.id })),
    ...(proposals.length < 3
      ? [{ id: `compromise:keep:${selection.id}`, actionId: keepAction.id }]
      : []),
  ];
  return {
    type: "conflict",
    code: "NO_VALID_ALTERNATIVE",
    targetSelectionId: selection.id,
    proposals,
    block: constraintConflictBlockSchema.parse({
      type: "constraint_conflict",
      constraintIds,
      alternatives,
      emphasis: {
        recommendedId: alternatives[0]?.id,
        summary: "No replacement preserves the current trip under the active scope.",
        supportingFactIds: [fact.id],
        suggestedFollowUpActionIds: proposals.length === 0 ? [keepAction.id] : undefined,
      },
    }),
    factBundle: factBundleSchema.parse({
      facts: [fact],
      allowedComparisonDimensions: ["alternative_coverage"],
      allowedFollowUpActions: [keepAction],
    }),
    message:
      proposals.length > 0
        ? "No hard-valid replacement exists under the current constraints. You can review a constraint-relaxation proposal or keep the current selection."
        : "No available alternative can replace this selection while keeping the rest of the trip valid.",
  };
}

function replacementOperation(selection: Selection, nextOfferId: string): TripOperation {
  if (selection.kind === "travel") {
    return { type: "replace_travel", selectionId: selection.id, nextOfferId };
  }
  if (selection.kind === "stay") {
    return { type: "replace_stay", selectionId: selection.id, nextOfferId };
  }
  return { type: "replace_activity", selectionId: selection.id, nextOfferId };
}

function operationsFor(
  selection: Selection,
  intent: ScopedModificationIntent,
  nextOfferId?: string,
): TripOperation[] {
  const operations: TripOperation[] = [];
  if (selection.locked && intent.unlockTarget) {
    operations.push({ type: "set_selection_lock", selectionId: selection.id, locked: false });
  }
  if (intent.action === "remove") {
    operations.push({ type: "remove_activity", selectionId: selection.id });
  } else if (nextOfferId) {
    operations.push(replacementOperation(selection, nextOfferId));
  }
  return operations;
}

function validateIntent(
  raw: ScopedModificationIntent,
  trip: TripState,
  supportedThemes: ReadonlySet<string>,
): ScopedModificationIntent {
  const parsed = scopedModificationIntentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner returned an invalid modification scope", 502, false);
  }
  const intent = parsed.data;
  const selections = allSelections(trip);
  const knownIds = new Set(selections.map((selection) => selection.id));
  if (!knownIds.has(intent.targetSelectionId)) {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner targeted an unknown selection", 502, false);
  }
  if (
    intent.preserveSelectionIds.some((id) => !knownIds.has(id)) ||
    intent.preserveSelectionIds.includes(intent.targetSelectionId) ||
    intent.preferredThemes.some((theme) => !supportedThemes.has(theme))
  ) {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner returned an invalid preservation scope", 502, false);
  }
  const target = selections.find((selection) => selection.id === intent.targetSelectionId)!;
  if (intent.action === "remove" && target.kind !== "activity") {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "Only activities can be removed in P0", 502, false);
  }
  return intent;
}

function recommendationIsGrounded(
  candidateId: string,
  supportingFactIds: string[],
  dimensions: string[],
  candidates: Array<{ offer: ResolvedOffer; facts: GroundedFact[] }>,
): boolean {
  const candidate = candidates.find((item) => item.offer.id === candidateId);
  if (!candidate) return false;
  const factIds = new Set(candidate.facts.map((fact) => fact.id));
  const allowed = new Set(allowedDimensions(candidate.offer));
  return (
    supportingFactIds.every((id) => factIds.has(id)) &&
    dimensions.every((dimension) => allowed.has(dimension))
  );
}

async function evaluateCandidate(
  trip: TripState,
  currentProjection: Awaited<ReturnType<typeof projectTrip>>,
  selection: Selection,
  intent: ScopedModificationIntent,
  offer: ResolvedOffer,
  context: Parameters<typeof projectTrip>[1],
  createId: () => string,
): Promise<{ proposal: TripProposal; evaluation: ProposalEvaluation } | undefined> {
  const proposal: TripProposal = {
    id: `proposal:${createId()}`,
    baseTripVersion: trip.version,
    operations: operationsFor(selection, intent, offer.id),
  };
  try {
    return {
      proposal,
      evaluation: await deriveProposalPreview(trip, proposal, currentProjection, context),
    };
  } catch {
    return undefined;
  }
}

export async function runModification(
  raw: unknown,
  dependencies: ModifyDependencies,
): Promise<ModificationResult> {
  const parsed = modifyRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ModifyError(
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid modification request",
      400,
      false,
    );
  }
  const trip = parsed.data.trip as TripState;
  const repository = dependencies.repository ?? createInventoryRepository();
  const createId = dependencies.createId ?? randomUUID;

  try {
    const catalog = await repository.getPlannerCatalog();
    const context = {
      resolveOffer: (offerId: string) => resolveOffer(offerId, repository),
      locationGraph: catalog.locationGraph,
    };
    const projection = await projectTrip(trip, context);
    if (!projection.validation.valid) {
      throw new ModifyError("INVALID_REQUEST", "Only a valid committed trip can be modified", 422, false);
    }
    const offers = new Map(
      projection.hydratedSelections.map((item) => [item.selectionId, item.offer]),
    );
    const selections: ModificationSelectionSummary[] = allSelections(trip).map((selection) => ({
      selectionId: selection.id,
      kind: selection.kind,
      locked: selection.locked,
      label: selectionLabel(selection, offers.get(selection.id)!),
      offerId: selection.offerId,
    }));

    let rawIntent: ScopedModificationIntent;
    try {
      rawIntent = await dependencies.model.interpretModification({
        message: parsed.data.message,
        trip,
        selections,
        supportedThemes: catalog.supportedThemes,
      });
    } catch {
      throw new ModifyError("MODEL_FAILURE", "The planner could not interpret this change", 502, true);
    }
    const intent = validateIntent(rawIntent, trip, new Set(catalog.supportedThemes));
    const selection = allSelections(trip).find((item) => item.id === intent.targetSelectionId)!;
    const currentOffer = offers.get(selection.id)!;

    if (selection.locked && !intent.unlockTarget) {
      return lockConflict(
        trip,
        projection,
        selection,
        selectionLabel(selection, currentOffer),
        context,
        createId,
      );
    }

    if (intent.action === "remove") {
      const proposal: TripProposal = {
        id: `proposal:${createId()}`,
        baseTripVersion: trip.version,
        operations: operationsFor(selection, intent),
      };
      const evaluation = await deriveProposalPreview(trip, proposal, projection, context);
      return {
        type: "proposal",
        proposal,
        preview: evaluation.preview,
        projection: evaluation.projection,
        block: changeProposalBlockSchema.parse({
          type: "change_proposal",
          proposalId: proposal.id,
          emphasis: { recommendedId: selection.id, comparisonDimensions: [], supportingFactIds: [] },
        }),
        factBundle: { facts: [], allowedComparisonDimensions: [], allowedFollowUpActions: [] },
        message: `I scoped this change to ${selectionLabel(selection, currentOffer)}. Nothing else will change unless you approve it.`,
      };
    }

    const alternativeSearch = await searchAlternatives(
      trip,
      selection,
      currentOffer,
      intent,
      repository,
    );
    const valid = (
      await Promise.all(
        alternativeSearch.offers.map(async (offer) => ({
          offer,
          candidate: await evaluateCandidate(
            trip,
            projection,
            selection,
            intent,
            offer,
            context,
            createId,
          ),
          facts: factsForInventoryOffer(offer, selection.travellerIds.length),
        })),
      )
    ).filter(
      (item): item is typeof item & { candidate: NonNullable<typeof item.candidate> } =>
        Boolean(item.candidate),
    );

    if (valid.length === 0) {
      return noAlternativeConflict(
        trip,
        projection,
        selection,
        alternativeSearch.coverage,
        context,
        createId,
      );
    }

    let recommendation = {
      candidateId: valid[0].offer.id,
      supportingFactIds: valid[0].facts
        .filter((fact) => ["total_price", "duration", "rating", "location"].includes(fact.dimension))
        .slice(0, 2)
        .map((fact) => fact.id),
      comparisonDimensions: [allowedDimensions(valid[0].offer)[0]],
    };
    if (recommendation.supportingFactIds.length === 0) {
      recommendation.supportingFactIds = [valid[0].facts[0].id];
    }
    try {
      const modelRecommendation = await dependencies.model.recommendModification({
        intent,
        currentSelection: selections.find((item) => item.selectionId === selection.id)!,
        candidates: valid.map((item) => ({ candidateId: item.offer.id, facts: item.facts })),
      });
      if (
        recommendationIsGrounded(
          modelRecommendation.candidateId,
          modelRecommendation.supportingFactIds,
          modelRecommendation.comparisonDimensions,
          valid,
        )
      ) {
        recommendation = modelRecommendation;
      }
    } catch {
      // Deterministic recommendation above remains the safe semantic fallback.
    }
    const chosen = valid.find((item) => item.offer.id === recommendation.candidateId)!;
    const factBundle = factBundleSchema.parse({
      facts: valid.flatMap((item) => item.facts),
      allowedComparisonDimensions: allowedDimensions(chosen.offer),
      allowedFollowUpActions: [],
    });
    const delta = chosen.candidate.evaluation.preview.budgetDelta.amount;
    const deltaCopy = delta === 0
      ? "The validated total is unchanged."
      : `The validated trip total changes by ${delta > 0 ? "+" : "−"}₹${Math.abs(delta).toLocaleString("en-IN")}.`;

    const options = valid.slice(0, 4).map((item) =>
      proposalOption(
        item.offer.id,
        item.candidate.proposal,
        item.candidate.evaluation,
        `Replace ${selectionLabel(selection, currentOffer)} with this hard-valid option.`,
      ),
    );
    if (options.length >= 2) {
      return {
        type: "alternatives",
        options,
        block: optionComparisonBlockSchema.parse({
          type: "option_comparison",
          entityType: selection.kind,
          choices: options.map((option) => ({
            optionId: option.optionId,
            proposalId: option.proposal.id,
          })),
          emphasis: {
            recommendedId: recommendation.candidateId,
            comparisonDimensions: recommendation.comparisonDimensions,
            supportingFactIds: recommendation.supportingFactIds,
            summary: "Every option preserves the rest of the trip and passes final validation.",
          },
        }),
        factBundle,
        message: `I found ${options.length} hard-valid alternatives for ${selectionLabel(selection, currentOffer)}. Compare them before opening a proposal.`,
      };
    }
    return {
      type: "proposal",
      proposal: chosen.candidate.proposal,
      preview: chosen.candidate.evaluation.preview,
      projection: chosen.candidate.evaluation.projection,
      block: changeProposalBlockSchema.parse({
        type: "change_proposal",
        proposalId: chosen.candidate.proposal.id,
        emphasis: {
          recommendedId: chosen.offer.id,
          comparisonDimensions: recommendation.comparisonDimensions,
          supportingFactIds: recommendation.supportingFactIds,
        },
      }),
      factBundle,
      message: `I found one hard-valid alternative for ${selectionLabel(selection, currentOffer)}. ${deltaCopy}`,
    };
  } catch (error: unknown) {
    if (error instanceof ModifyError) throw error;
    throw new ModifyError(
      "INVENTORY_FAILURE",
      "Inventory could not be resolved for this modification",
      503,
      true,
    );
  }
}
