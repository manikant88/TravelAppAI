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
  constraintDraftFromNatural,
  type NaturalConstraint,
} from "@/agent/natural-intake-contracts";
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
  Constraint,
  StaySelection,
  TravelSelection,
  TripState,
} from "@/domain/model";
import {
  deriveProposalPreview,
  ProposalError,
  type ProposalEvaluation,
  type TripOperation,
  type TripProposal,
} from "@/domain/proposals";
import { constraintSchema } from "@/domain/request";
import {
  projectTrip,
  routeLocationForDate,
  tripStateSchema,
  type ResolvedOffer,
} from "@/domain/trip";
import { createInventoryRepository } from "@/inventory/repository";
import {
  resolveOffer,
  searchActivities,
  searchStays,
  searchTransfers,
  searchTransport,
} from "@/inventory/service";
import type { ActivityOffer, CoverageResult } from "@/inventory/contracts";
import {
  createDeterministicModificationModel,
  SelectionTargetError,
} from "@/agent/deterministic-modification";

const modifyRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(800),
    trip: tripStateSchema,
    targetDate: z.string().date().optional(),
  })
  .strict();

type Selection = TravelSelection | StaySelection | ActivitySelection;
type SelectionModificationIntent = Extract<
  ScopedModificationIntent,
  { targetSelectionId: string }
>;

export interface ModifyDependencies {
  model?: ModificationPlannerModel;
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

function selectionSummary(
  selection: Selection,
  offer: ResolvedOffer,
  trip: TripState,
): ModificationSelectionSummary {
  const common = {
    selectionId: selection.id,
    kind: selection.kind,
    locked: selection.locked,
    label: selectionLabel(selection, offer),
    offerId: selection.offerId,
  };
  if ("sessionId" in offer) {
    return {
      ...common,
      startDate: offer.startsAt.slice(0, 10),
      endDate: offer.endsAt.slice(0, 10),
      mobility: offer.activityFacts.mobility,
      searchTerms: [
        offer.locationId.split(":").at(-1) ?? offer.locationId,
        ...offer.activityFacts.tags,
      ],
    };
  }
  if ("roomOfferId" in offer) {
    return {
      ...common,
      startDate: offer.checkIn,
      endDate: offer.checkOut,
      searchTerms: [
        offer.locationId.split(":").at(-1) ?? offer.locationId,
        offer.roomFacts.roomLabel,
        ...offer.propertyFacts.tags,
        ...offer.propertyFacts.amenities,
      ],
    };
  }
  if ("serviceId" in offer) {
    const role = offer.from === trip.request.origin
      ? "outbound" as const
      : offer.to === trip.request.origin
        ? "return" as const
        : "connecting" as const;
    return {
      ...common,
      startDate: offer.departureAt.slice(0, 10),
      endDate: offer.arrivalAt.slice(0, 10),
      role,
      searchTerms: [
        offer.from.split(":").at(-1) ?? offer.from,
        offer.to.split(":").at(-1) ?? offer.to,
        offer.operator,
        offer.mode,
      ],
    };
  }
  return {
    ...common,
    role: "connecting",
    searchTerms: [
      offer.from.split(":").at(-1) ?? offer.from,
      offer.to.split(":").at(-1) ?? offer.to,
      offer.mode,
      "transfer",
    ],
  };
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
  intent: SelectionModificationIntent,
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
  copy?: { message: string; summary: string },
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
        summary: copy?.summary ?? "No replacement preserves the current trip under the active scope.",
        supportingFactIds: [fact.id],
        suggestedFollowUpActionIds: proposals.length === 0 ? [keepAction.id] : undefined,
      },
    }),
    factBundle: factBundleSchema.parse({
      facts: [fact],
      allowedComparisonDimensions: ["alternative_coverage"],
      allowedFollowUpActions: [keepAction],
    }),
    message: copy?.message ?? (
      proposals.length > 0
        ? "No hard-valid replacement exists under the current constraints. You can review a constraint-relaxation proposal or keep the current selection."
        : "No available alternative can replace this selection while keeping the rest of the trip valid."
    ),
  };
}

function asksForLowerPrice(goal: string): boolean {
  return /\b(?:cheaper|less expensive|lower(?:-|\s+)(?:price|cost)|reduce (?:the )?(?:price|cost)|save money)\b/i.test(goal);
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
  intent: SelectionModificationIntent,
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
  if (
    intent.preserveSelectionIds.some((id) => !knownIds.has(id)) ||
    intent.preferredThemes.some((theme) => !supportedThemes.has(theme))
  ) {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner returned an invalid preservation scope", 502, false);
  }
  if (intent.action === "upsert_constraint") return intent;
  if (intent.action === "remove_constraint") {
    if (!trip.request.constraints.some((constraint) => constraint.id === intent.constraintId)) {
      throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner targeted an unknown constraint", 502, false);
    }
    return intent;
  }
  if (intent.action === "add") {
    if (
      intent.targetDate < trip.request.startDate ||
      intent.targetDate > trip.request.endDate ||
      intent.preserveSelectionIds.some((id) => !knownIds.has(id))
    ) {
      throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner returned an invalid activity-addition scope", 502, false);
    }
    return intent;
  }
  if (!knownIds.has(intent.targetSelectionId)) {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner targeted an unknown selection", 502, false);
  }
  if (intent.preserveSelectionIds.includes(intent.targetSelectionId)) {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "The planner returned an invalid preservation scope", 502, false);
  }
  const target = selections.find((selection) => selection.id === intent.targetSelectionId)!;
  if (intent.action === "remove" && target.kind !== "activity") {
    throw new ModifyError("INVALID_MODEL_OUTPUT", "Only activities can be removed in P0", 502, false);
  }
  return intent;
}

function canonicalConstraint(
  trip: TripState,
  natural: NaturalConstraint,
): Constraint {
  const draft = constraintDraftFromNatural(natural);
  const existing = trip.request.constraints.find(
    (constraint) => constraint.category === draft.category && !constraint.travellerIds?.length,
  );
  return constraintSchema.parse({
    ...draft,
    id: existing?.id ?? `constraint:${draft.category}:all`,
  }) as Constraint;
}

function constraintSummary(constraint: Constraint): string {
  if (constraint.category === "budget") {
    const amount = constraint.value.maxTotal?.amount ?? constraint.value.targetTotal?.amount;
    const kind = constraint.value.maxTotal ? "maximum" : "target";
    return amount
      ? `${kind} trip budget of ₹${amount.toLocaleString("en-IN")}`
      : "trip budget constraint";
  }
  if (constraint.category === "travel") {
    const details = [
      constraint.value.earliestDeparture ? `depart after ${constraint.value.earliestDeparture}` : undefined,
      constraint.value.latestArrival ? `arrive by ${constraint.value.latestArrival}` : undefined,
      constraint.value.allowedModes?.length ? `use ${constraint.value.allowedModes.join("/")}` : undefined,
      constraint.value.maxStops !== undefined ? `at most ${constraint.value.maxStops} stops` : undefined,
    ].filter(Boolean);
    return details.join(", ") || "travel constraint";
  }
  if (constraint.category === "stay") {
    const details = [
      constraint.value.maxNightlyPrice
        ? `nightly stay under ₹${constraint.value.maxNightlyPrice.amount.toLocaleString("en-IN")}`
        : undefined,
      constraint.value.requiredAmenities?.length
        ? `require ${constraint.value.requiredAmenities.join(", ")}`
        : undefined,
      constraint.value.seniorFriendly ? "senior-friendly stay" : undefined,
      constraint.value.requiredRooms ? `${constraint.value.requiredRooms} rooms` : undefined,
    ].filter(Boolean);
    return details.join(", ") || "stay constraint";
  }
  if (constraint.category === "activity") {
    const details = [
      constraint.value.maxMobility ? `${constraint.value.maxMobility} mobility maximum` : undefined,
      constraint.value.childFriendly ? "child-friendly activities" : undefined,
      constraint.value.seniorFriendly ? "senior-friendly activities" : undefined,
    ].filter(Boolean);
    return details.join(", ") || "activity constraint";
  }
  return `maximum ${constraint.value.maxActiveMinutesPerDay} active minutes per day`;
}

function constraintFact(
  trip: TripState,
  constraint: Constraint,
  label: string,
): GroundedFact {
  return {
    id: `fact:constraint:${createHash("sha256")
      .update(`${trip.id}:${constraint.id}:${JSON.stringify(constraint)}`)
      .digest("hex")
      .slice(0, 20)}`,
    subjectType: "trip",
    subjectId: trip.id,
    dimension: "constraint_change",
    label,
    value: constraintSummary(constraint),
  };
}

function keepConstraintAction(tripId: string) {
  return {
    id: `action:keep-current-constraints:${tripId}`,
    label: "Keep the current trip constraints",
    type: "keep_current" as const,
  };
}

async function constraintConflict(
  trip: TripState,
  attempted: Constraint,
  projection: Awaited<ReturnType<typeof projectTrip>>,
  context: Parameters<typeof projectTrip>[1],
  createId: () => string,
  reason: string,
  allowSoftening = true,
): Promise<Extract<ModificationResult, { type: "conflict" }>> {
  const alreadyActive = reason === "that rule is already active";
  const proposals: ModificationProposalOption[] = [];
  if (allowSoftening && attempted.priority === "hard") {
    let softened: Constraint = { ...attempted, priority: "strong" } as Constraint;
    if (attempted.category === "budget" && attempted.value.maxTotal) {
      softened = {
        ...attempted,
        priority: "strong",
        value: { targetTotal: attempted.value.maxTotal },
      };
    }
    const proposal: TripProposal = {
      id: `proposal:${createId()}`,
      baseTripVersion: trip.version,
      operations: [{ type: "upsert_constraint", constraint: softened }],
    };
    try {
      const evaluation = await deriveProposalPreview(trip, proposal, projection, context);
      proposals.push(
        proposalOption(
          `compromise:soften:${attempted.id}`,
          proposal,
          evaluation,
          `Treat ${constraintSummary(attempted)} as a strong target instead of a hard limit.`,
        ),
      );
    } catch {
      // If softening still cannot validate, keep-current remains the only honest action.
    }
  }
  const fact = constraintFact(
    trip,
    attempted,
    alreadyActive
      ? "Requested constraint is already active"
      : `Requested constraint conflicts with the committed trip: ${reason}`,
  );
  const keepAction = keepConstraintAction(trip.id);
  const alternatives = [
    ...proposals.map((option) => ({ id: option.optionId, proposalId: option.proposal.id })),
    { id: `compromise:keep-constraints:${trip.id}`, actionId: keepAction.id },
  ];
  return {
    type: "conflict",
    code: "CONSTRAINT_CONFLICT",
    proposals,
    block: constraintConflictBlockSchema.parse({
      type: "constraint_conflict",
      constraintIds: [attempted.id],
      alternatives,
      emphasis: {
        recommendedId: alternatives[0].id,
        summary: alreadyActive
          ? "This rule is already part of the committed trip, so no state change is needed."
          : "The requested rule would invalidate the committed trip. Review a softer target or keep the current constraints.",
        supportingFactIds: [fact.id],
        suggestedFollowUpActionIds: proposals.length === 0 ? [keepAction.id] : undefined,
      },
    }),
    factBundle: factBundleSchema.parse({
      facts: [fact],
      allowedComparisonDimensions: ["constraint_change"],
      allowedFollowUpActions: [keepAction],
    }),
    message: alreadyActive
      ? `${constraintSummary(attempted)} is already active. The current trip is unchanged.`
      : `I can’t apply ${constraintSummary(attempted)} as requested without invalidating the current trip.`,
  };
}

async function runConstraintModification(
  trip: TripState,
  projection: Awaited<ReturnType<typeof projectTrip>>,
  intent: Extract<
    ScopedModificationIntent,
    { action: "upsert_constraint" | "remove_constraint" }
  >,
  context: Parameters<typeof projectTrip>[1],
  createId: () => string,
): Promise<ModificationResult> {
  const operation: TripOperation = intent.action === "remove_constraint"
    ? { type: "remove_constraint", constraintId: intent.constraintId }
    : { type: "upsert_constraint", constraint: canonicalConstraint(trip, intent.constraint) };
  const current = operation.type === "remove_constraint"
    ? trip.request.constraints.find((constraint) => constraint.id === operation.constraintId)!
    : operation.constraint;
  const existing = trip.request.constraints.find((constraint) => constraint.id === current.id);
  if (operation.type === "upsert_constraint" && JSON.stringify(existing) === JSON.stringify(current)) {
    return constraintConflict(
      trip,
      current,
      projection,
      context,
      createId,
      "that rule is already active",
      false,
    );
  }

  const proposal: TripProposal = {
    id: `proposal:${createId()}`,
    baseTripVersion: trip.version,
    operations: [operation],
  };
  try {
    const evaluation = await deriveProposalPreview(trip, proposal, projection, context);
    const fact = constraintFact(
      trip,
      current,
      operation.type === "remove_constraint"
        ? "Existing constraint proposed for removal"
        : "Typed constraint proposed for approval",
    );
    const verb = operation.type === "remove_constraint" ? "remove" : "apply";
    return {
      type: "proposal",
      proposal,
      preview: evaluation.preview,
      projection: evaluation.projection,
      block: changeProposalBlockSchema.parse({
        type: "change_proposal",
        proposalId: proposal.id,
        emphasis: {
          recommendedId: current.id,
          comparisonDimensions: ["constraint_change"],
          supportingFactIds: [fact.id],
        },
      }),
      factBundle: factBundleSchema.parse({
        facts: [fact],
        allowedComparisonDimensions: ["constraint_change"],
        allowedFollowUpActions: [],
      }),
      message: `I prepared a proposal to ${verb} ${constraintSummary(current)}. Every selection remains unchanged unless you approve it.`,
    };
  } catch (error: unknown) {
    if (error instanceof ProposalError && error.code === "INVALID_RESULT") {
      return constraintConflict(
        trip,
        current,
        projection,
        context,
        createId,
        error.message,
      );
    }
    throw error;
  }
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
  intent: SelectionModificationIntent,
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

async function runActivityAddition(
  trip: TripState,
  projection: Awaited<ReturnType<typeof projectTrip>>,
  intent: Extract<ScopedModificationIntent, { action: "add" }>,
  repository: ReturnType<typeof createInventoryRepository>,
  context: Parameters<typeof projectTrip>[1],
  model: ModificationPlannerModel,
  createId: () => string,
): Promise<ModificationResult> {
  const requestedCount = intent.count ?? 1;
  const locationId = routeLocationForDate(intent.targetDate, trip);
  const result = await searchActivities(
    {
      locationId,
      startDate: intent.targetDate,
      endDate: intent.targetDate,
      travellers: trip.request.travellers,
      interests: intent.preferredThemes.length > 0
        ? intent.preferredThemes
        : (trip.request.preferences.interests ?? []),
      constraints: constraintsFor(trip, "activity"),
    },
    repository,
  );
  const activitiesOnTargetDay = trip.selectedActivities.filter(
    (selection) => selection.date === intent.targetDate,
  );
  const selectedOfferIds = new Set(
    trip.selectedActivities
      .filter((selection) => !intent.replaceDayActivities || selection.date !== intent.targetDate)
      .map((selection) => selection.offerId),
  );
  const selectedActivityIds = new Set(
    trip.selectedActivities
      .filter((selection) => !intent.replaceDayActivities || selection.date !== intent.targetDate)
      .map((selection) => projection.hydratedSelections.find((item) => item.selectionId === selection.id)?.offer)
      .filter((offer): offer is Extract<ResolvedOffer, { activityId: string }> => Boolean(offer && "activityId" in offer))
      .map((offer) => offer.activityId),
  );
  const uniqueActivityOffers = result.results.filter((offer) =>
    !selectedOfferIds.has(offer.id) && !selectedActivityIds.has(offer.activityId),
  );
  // Only reuse a recurring activity after every unseen activity is exhausted.
  const availableOffers = (uniqueActivityOffers.length > 0 ? uniqueActivityOffers : result.results.filter((offer) => !selectedOfferIds.has(offer.id))).slice(0, 8);

  if (requestedCount > 1) {
    const bundles: ActivityOffer[][] = [];
    const collectBundles = (start: number, selected: ActivityOffer[]) => {
      if (selected.length === requestedCount) {
        bundles.push(selected);
        return;
      }
      for (let index = start; index < availableOffers.length; index += 1) {
        collectBundles(index + 1, [...selected, availableOffers[index]!]);
      }
    };
    collectBundles(0, []);
    const evaluated = (
      await Promise.all(bundles.slice(0, 24).map(async (offers) => {
        const operations: TripOperation[] = [
          ...(intent.replaceDayActivities
            ? activitiesOnTargetDay.map((selection): TripOperation => ({
                type: "remove_activity",
                selectionId: selection.id,
              }))
            : []),
          ...offers.map((offer): TripOperation => ({
            type: "add_activity",
            nextOfferId: offer.id,
            travellerIds: trip.request.travellers.map((traveller) => traveller.id),
          })),
        ];
        const proposal: TripProposal = {
          id: `proposal:${createId()}`,
          baseTripVersion: trip.version,
          operations,
        };
        try {
          const evaluation = await deriveProposalPreview(trip, proposal, projection, context);
          const matchedThemes = new Set(
            offers.flatMap((offer) => offer.activityFacts.tags).filter((tag) => intent.preferredThemes.includes(tag)),
          );
          return {
            offers,
            proposal,
            evaluation,
            themeScore: matchedThemes.size,
            totalPrice: offers.reduce((sum, offer) => sum + offer.price.amount, 0),
          };
        } catch {
          return undefined;
        }
      }))
    ).flatMap((candidate) => candidate ? [candidate] : [])
      .sort((left, right) =>
        right.themeScore - left.themeScore || left.totalPrice - right.totalPrice,
      );

    const chosenBundle = evaluated[0];
    if (chosenBundle) {
      const names = chosenBundle.offers.map((offer) => offer.activityFacts.name);
      const facts = chosenBundle.offers.flatMap((offer) =>
        factsForInventoryOffer(offer, trip.request.travellers.length),
      );
      return {
        type: "proposal",
        proposal: chosenBundle.proposal,
        preview: chosenBundle.evaluation.preview,
        projection: chosenBundle.evaluation.projection,
        block: changeProposalBlockSchema.parse({
          type: "change_proposal",
          proposalId: chosenBundle.proposal.id,
          emphasis: {
            recommendedId: chosenBundle.offers[0]!.id,
            comparisonDimensions: ["activity_fit"],
            supportingFactIds: facts.slice(0, 4).map((fact) => fact.id),
          },
        }),
        factBundle: factBundleSchema.parse({
          facts,
          allowedComparisonDimensions: ["price", "timing", "duration", "activity_fit", "pace"],
          allowedFollowUpActions: [],
        }),
        message: `I selected ${names.join(" and ")} for day ${Math.round((Date.parse(`${intent.targetDate}T12:00:00Z`) - Date.parse(`${trip.request.startDate}T12:00:00Z`)) / 86_400_000) + 1}. Both fit the requested themes and the validated schedule.`,
      };
    }
    const fact = conflictFact(
      trip.id,
      "activity_coverage",
      `Non-overlapping activity combinations on ${intent.targetDate}`,
      "none_available",
    );
    const actionId = `action:keep-current:${intent.targetDate}`;
    return {
      type: "conflict",
      code: "NO_VALID_ALTERNATIVE",
      proposals: [],
      block: constraintConflictBlockSchema.parse({
        type: "constraint_conflict",
        constraintIds: [],
        alternatives: [{ id: `compromise:keep:${intent.targetDate}`, actionId }],
        emphasis: {
          recommendedId: `compromise:keep:${intent.targetDate}`,
          summary: `I couldn’t find ${requestedCount} activities that fit together without a time conflict.`,
          supportingFactIds: [fact.id],
          suggestedFollowUpActionIds: [actionId],
        },
      }),
      factBundle: factBundleSchema.parse({
        facts: [fact],
        allowedComparisonDimensions: ["activity_coverage"],
        allowedFollowUpActions: [{
          id: actionId,
          label: "Keep the current schedule",
          type: "keep_current",
        }],
      }),
      message: `I couldn’t find ${requestedCount} non-overlapping activities for that day. Try fewer activities or choose another day.`,
    };
  }

  const candidates = (
    await Promise.all(
      availableOffers
        .slice(0, 6)
        .map(async (offer) => {
          const proposal: TripProposal = {
            id: `proposal:${createId()}`,
            baseTripVersion: trip.version,
            operations: [{
              type: "add_activity",
              nextOfferId: offer.id,
              travellerIds: trip.request.travellers.map((traveller) => traveller.id),
            }],
          };
          try {
            return {
              offer,
              proposal,
              evaluation: await deriveProposalPreview(trip, proposal, projection, context),
              facts: factsForInventoryOffer(offer, trip.request.travellers.length),
            };
          } catch {
            return undefined;
          }
        }),
    )
  ).flatMap((candidate) => candidate ? [candidate] : []);

  if (candidates.length === 0) {
    const fact = conflictFact(
      trip.id,
      "activity_coverage",
      `Activity availability on ${intent.targetDate}`,
      result.coverage.status,
    );
    const actionId = `action:keep-current:${intent.targetDate}`;
    return {
      type: "conflict",
      code: "NO_VALID_ALTERNATIVE",
      proposals: [],
      block: constraintConflictBlockSchema.parse({
        type: "constraint_conflict",
        constraintIds: result.coverage.status === "eliminated_by_constraints"
          ? result.coverage.constraintIds.slice(0, 8)
          : [],
        alternatives: [{ id: `compromise:keep:${intent.targetDate}`, actionId }],
        emphasis: {
          recommendedId: `compromise:keep:${intent.targetDate}`,
          summary: "No dated activity can be added without breaking the current trip.",
          supportingFactIds: [fact.id],
          suggestedFollowUpActionIds: [actionId],
        },
      }),
      factBundle: factBundleSchema.parse({
        facts: [fact],
        allowedComparisonDimensions: ["activity_coverage"],
        allowedFollowUpActions: [{
          id: actionId,
          label: "Keep this day as open time",
          type: "keep_current",
        }],
      }),
      message: `No schedule-valid activity is available for ${intent.targetDate}. The current trip is unchanged.`,
    };
  }

  let recommendation = {
    candidateId: candidates[0].offer.id,
    supportingFactIds: candidates[0].facts.slice(0, 2).map((fact) => fact.id),
    comparisonDimensions: ["activity_fit"],
  };
  try {
    const modelRecommendation = await model.recommendModification({
      intent,
      targetDate: intent.targetDate,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.offer.id,
        facts: candidate.facts,
      })),
    });
    if (
      recommendationIsGrounded(
        modelRecommendation.candidateId,
        modelRecommendation.supportingFactIds,
        modelRecommendation.comparisonDimensions,
        candidates,
      )
    ) {
      recommendation = modelRecommendation;
    }
  } catch {
    // The first hard-valid activity remains the deterministic semantic fallback.
  }
  const chosen = candidates.find((candidate) => candidate.offer.id === recommendation.candidateId)
    ?? candidates[0];
  const factBundle = factBundleSchema.parse({
    facts: candidates.flatMap((candidate) => candidate.facts),
    allowedComparisonDimensions: allowedDimensions(chosen.offer),
    allowedFollowUpActions: [],
  });
  const options = candidates.slice(0, 4).map((candidate) =>
    proposalOption(
      candidate.offer.id,
      candidate.proposal,
      candidate.evaluation,
      `Add ${candidate.offer.activityFacts.name} on ${intent.targetDate}.`,
    ),
  );
  if (options.length >= 2) {
    return {
      type: "alternatives",
      options,
      block: optionComparisonBlockSchema.parse({
        type: "option_comparison",
        entityType: "activity",
        choices: options.map((option) => ({
          optionId: option.optionId,
          proposalId: option.proposal.id,
        })),
        emphasis: {
          recommendedId: chosen.offer.id,
          comparisonDimensions: recommendation.comparisonDimensions,
          supportingFactIds: recommendation.supportingFactIds,
          summary: `Every option is available on ${intent.targetDate} and keeps the trip valid.`,
        },
      }),
      factBundle,
      message: `Choose an activity to add on ${intent.targetDate}.`,
    };
  }
  return {
    type: "proposal",
    proposal: chosen.proposal,
    preview: chosen.evaluation.preview,
    projection: chosen.evaluation.projection,
    block: changeProposalBlockSchema.parse({
      type: "change_proposal",
      proposalId: chosen.proposal.id,
      emphasis: {
        recommendedId: chosen.offer.id,
        comparisonDimensions: recommendation.comparisonDimensions,
        supportingFactIds: recommendation.supportingFactIds,
      },
    }),
    factBundle,
    message: `One schedule-valid activity is available on ${intent.targetDate}. Review it before adding it.`,
  };
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
    const selections: ModificationSelectionSummary[] = allSelections(trip).map((selection) =>
      selectionSummary(selection, offers.get(selection.id)!, trip),
    );

    const deterministicModel = createDeterministicModificationModel();
    let rawIntent: ScopedModificationIntent;
    if (parsed.data.targetDate) {
      const supportedThemes = new Set(catalog.supportedThemes);
      rawIntent = {
        action: "add",
        targetDate: parsed.data.targetDate,
        count: 1,
        replaceDayActivities: false,
        preserveSelectionIds: allSelections(trip).map((selection) => selection.id),
        goal: parsed.data.message,
        unlockTarget: false,
        preferredThemes: (trip.request.preferences.interests ?? []).filter((theme) =>
          supportedThemes.has(theme),
        ),
      };
    } else {
      const modelInput = {
          message: parsed.data.message,
          trip,
          selections,
          supportedThemes: catalog.supportedThemes,
        };
      try {
        // Explicit selection/category/budget changes are code-owned. Only an
        // ambiguous message is offered to the model for semantic resolution.
        rawIntent = await deterministicModel.interpretModification(modelInput);
      } catch (error: unknown) {
        if (error instanceof SelectionTargetError) {
          throw new ModifyError("INVALID_REQUEST", error.message, 400, false);
        }
        try {
          if (!dependencies.model) throw new Error("No ambiguity resolver configured");
          rawIntent = await dependencies.model.interpretModification(modelInput);
        } catch {
          throw new ModifyError(
            "INVALID_REQUEST",
            "Tell me whether you want to change the travel, stay, or an activity.",
            400,
            false,
          );
        }
      }
    }
    const intent = validateIntent(rawIntent, trip, new Set(catalog.supportedThemes));
    if (intent.action === "upsert_constraint" || intent.action === "remove_constraint") {
      return runConstraintModification(
        trip,
        projection,
        intent,
        context,
        createId,
      );
    }
    if (intent.action === "add") {
      return runActivityAddition(
        trip,
        projection,
        intent,
        repository,
        context,
        dependencies.model ?? deterministicModel,
        createId,
      );
    }
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

    const lowerPriceRequested = asksForLowerPrice(intent.goal);
    const eligible = lowerPriceRequested
      ? valid.filter((item) => item.candidate.evaluation.preview.budgetDelta.amount < 0)
      : valid;

    if (eligible.length === 0) {
      const currentLabel = selectionLabel(selection, currentOffer);
      const selectionNoun = selection.kind === "stay" ? "stay" : selection.kind === "travel" ? "travel option" : "activity";
      return noAlternativeConflict(
        trip,
        projection,
        selection,
        alternativeSearch.coverage,
        context,
        createId,
        {
          summary: `${currentLabel} is already the lowest-priced valid option in the available inventory.`,
          message: `I checked the valid alternatives, but none is cheaper than ${currentLabel}. I kept your current ${selectionNoun} and the rest of the trip unchanged.`,
        },
      );
    }

    let recommendation = {
      candidateId: eligible[0].offer.id,
      supportingFactIds: eligible[0].facts
        .filter((fact) => ["total_price", "duration", "rating", "location"].includes(fact.dimension))
        .slice(0, 2)
        .map((fact) => fact.id),
      comparisonDimensions: [allowedDimensions(eligible[0].offer)[0]],
    };
    if (recommendation.supportingFactIds.length === 0) {
      recommendation.supportingFactIds = [eligible[0].facts[0].id];
    }
    try {
      const modelRecommendation = await (dependencies.model ?? deterministicModel).recommendModification({
        intent,
        currentSelection: selections.find((item) => item.selectionId === selection.id)!,
        candidates: eligible.map((item) => ({ candidateId: item.offer.id, facts: item.facts })),
      });
      if (
        recommendationIsGrounded(
          modelRecommendation.candidateId,
          modelRecommendation.supportingFactIds,
          modelRecommendation.comparisonDimensions,
          eligible,
        )
      ) {
        recommendation = modelRecommendation;
      }
    } catch {
      // Deterministic recommendation above remains the safe semantic fallback.
    }
    const chosen = eligible.find((item) => item.offer.id === recommendation.candidateId)!;
    const factBundle = factBundleSchema.parse({
      facts: eligible.flatMap((item) => item.facts),
      allowedComparisonDimensions: allowedDimensions(chosen.offer),
      allowedFollowUpActions: [],
    });
    const delta = chosen.candidate.evaluation.preview.budgetDelta.amount;
    const deltaCopy = delta === 0
      ? "The validated total is unchanged."
      : `The validated trip total changes by ${delta > 0 ? "+" : "−"}₹${Math.abs(delta).toLocaleString("en-IN")}.`;

    const options = eligible.slice(0, 4).map((item) =>
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
        message: lowerPriceRequested
          ? `I found ${options.length} cheaper valid stays that preserve your travel selections. Choose one to update the itinerary.`
          : `I found ${options.length} hard-valid alternatives for ${selectionLabel(selection, currentOffer)}. Compare them before opening a proposal.`,
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
