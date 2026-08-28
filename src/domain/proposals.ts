import { z } from "zod";
import { constraintSchema } from "@/domain/request";
import {
  projectTrip,
  tripStateSchema,
  type ResolvedOffer,
  type TripProjection,
  type TripProjectionContext,
  type TripValidation,
} from "@/domain/trip";
import type {
  ActivitySelection,
  Constraint,
  ID,
  Money,
  SelectionID,
  StaySelection,
  TravelSelection,
  TripState,
} from "@/domain/model";

const idSchema = z.string().trim().min(1);

export const tripOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replace_trip_plan"), nextTrip: tripStateSchema }).strict(),
  z.object({ type: z.literal("replace_travel"), selectionId: idSchema, nextOfferId: idSchema }).strict(),
  z.object({ type: z.literal("replace_stay"), selectionId: idSchema, nextOfferId: idSchema }).strict(),
  z.object({ type: z.literal("replace_activity"), selectionId: idSchema, nextOfferId: idSchema }).strict(),
  z
    .object({
      type: z.literal("add_activity"),
      nextOfferId: idSchema,
      travellerIds: z.array(idSchema).min(1),
    })
    .strict(),
  z.object({ type: z.literal("remove_activity"), selectionId: idSchema }).strict(),
  z
    .object({
      type: z.literal("update_activity_participants"),
      selectionId: idSchema,
      travellerIds: z.array(idSchema).min(1),
    })
    .strict(),
  z.object({ type: z.literal("set_selection_lock"), selectionId: idSchema, locked: z.boolean() }).strict(),
  z.object({ type: z.literal("upsert_constraint"), constraint: constraintSchema }).strict(),
  z.object({ type: z.literal("remove_constraint"), constraintId: idSchema }).strict(),
]);

export type TripOperation = z.infer<typeof tripOperationSchema>;

export const tripProposalSchema = z
  .object({
    id: idSchema,
    baseTripVersion: z.number().int().nonnegative(),
    operations: z.array(tripOperationSchema).min(1).max(12),
  })
  .strict();

export type TripProposal = z.infer<typeof tripProposalSchema>;

export type ChangedCategory =
  | "request"
  | "travel"
  | "stays"
  | "activities"
  | "constraints"
  | "locks";

export interface ProposalPreview {
  proposalId: ID;
  nextTrip: TripState;
  changedSelectionIds: SelectionID[];
  preservedSelectionIds: SelectionID[];
  changedCategories: ChangedCategory[];
  budgetDelta: Money;
  validation: TripValidation;
}

export interface ProposalEvaluation {
  preview: ProposalPreview;
  projection: TripProjection;
}

export class ProposalError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PROPOSAL"
      | "STALE_PROPOSAL"
      | "UNKNOWN_SELECTION"
      | "OPERATION_KIND_MISMATCH"
      | "LOCKED_SELECTION"
      | "INVALID_OPERATION_ORDER"
      | "OFFER_RESOLUTION_FAILED"
      | "INVALID_RESULT",
    message: string,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

type Selection = TravelSelection | StaySelection | ActivitySelection;

function allSelections(trip: TripState): Selection[] {
  return [...trip.selectedTravel, ...trip.selectedStays, ...trip.selectedActivities];
}

function selectionById(trip: TripState, selectionId: string): Selection {
  const selection = allSelections(trip).find((candidate) => candidate.id === selectionId);
  if (!selection) {
    throw new ProposalError("UNKNOWN_SELECTION", `Unknown selection ID: ${selectionId}`);
  }
  return selection;
}

function replaceSelection<T extends Selection>(items: T[], next: T): T[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

function isTransportOffer(offer: ResolvedOffer): boolean {
  return "serviceId" in offer;
}

function isTransferOffer(offer: ResolvedOffer): boolean {
  return "transferId" in offer;
}

function isStayOffer(offer: ResolvedOffer): offer is Extract<ResolvedOffer, { roomOfferId: string }> {
  return "roomOfferId" in offer;
}

function isActivityOffer(offer: ResolvedOffer): offer is Extract<ResolvedOffer, { sessionId: string }> {
  return "sessionId" in offer;
}

async function resolveReplacement(
  offerId: string,
  context: TripProjectionContext,
): Promise<ResolvedOffer> {
  try {
    return await context.resolveOffer(offerId);
  } catch {
    throw new ProposalError(
      "OFFER_RESOLUTION_FAILED",
      `Replacement offer is unavailable: ${offerId}`,
    );
  }
}

function changedCategory(operation: TripOperation): ChangedCategory {
  switch (operation.type) {
    case "replace_trip_plan":
      return "request";
    case "replace_travel":
      return "travel";
    case "replace_stay":
      return "stays";
    case "replace_activity":
    case "add_activity":
    case "remove_activity":
    case "update_activity_participants":
      return "activities";
    case "set_selection_lock":
      return "locks";
    case "upsert_constraint":
    case "remove_constraint":
      return "constraints";
  }
}

function changedSelectionId(operation: TripOperation): string | undefined {
  return "selectionId" in operation ? operation.selectionId : undefined;
}

function assertUnlocked(selection: Selection): void {
  if (selection.locked) {
    throw new ProposalError(
      "LOCKED_SELECTION",
      `Selection ${selection.id} is locked; an explicit unlock operation must come first`,
    );
  }
}

async function applyOperation(
  trip: TripState,
  operation: TripOperation,
  context: TripProjectionContext,
): Promise<TripState> {
  if (operation.type === "replace_trip_plan") {
    const replacement = operation.nextTrip as TripState;
    if (replacement.inventoryVersion !== trip.inventoryVersion) {
      throw new ProposalError(
        "INVALID_PROPOSAL",
        "A full-plan replacement must use the current inventory version",
      );
    }
    const replacementSelections = new Map(
      allSelections(replacement).map((selection) => [selection.id, selection]),
    );
    for (const current of allSelections(trip).filter((selection) => selection.locked)) {
      const next = replacementSelections.get(current.id);
      if (
        !next ||
        next.kind !== current.kind ||
        next.offerId !== current.offerId ||
        JSON.stringify(next.travellerIds) !== JSON.stringify(current.travellerIds)
      ) {
        throw new ProposalError(
          "LOCKED_SELECTION",
          `Locked selection ${current.id} must be preserved by the updated plan`,
        );
      }
    }
    return {
      ...replacement,
      id: trip.id,
      version: trip.version,
    };
  }

  if (operation.type === "add_activity") {
    const offer = await resolveReplacement(operation.nextOfferId, context);
    if (!isActivityOffer(offer)) {
      throw new ProposalError("OPERATION_KIND_MISMATCH", "Activity addition requires activity inventory");
    }
    if (trip.selectedActivities.some((selection) => selection.offerId === offer.id)) {
      throw new ProposalError("INVALID_OPERATION_ORDER", "Activity is already selected");
    }
    const knownTravellerIds = new Set(trip.request.travellers.map((traveller) => traveller.id));
    const travellerIds = [...new Set(operation.travellerIds)];
    if (travellerIds.some((id) => !knownTravellerIds.has(id))) {
      throw new ProposalError("INVALID_PROPOSAL", "Activity addition contains an unknown traveller ID");
    }
    const selectionId = `selection:activity:${offer.id}`;
    if (allSelections(trip).some((selection) => selection.id === selectionId)) {
      throw new ProposalError("INVALID_OPERATION_ORDER", "Activity selection ID already exists");
    }
    const addedSelection: ActivitySelection = {
      id: selectionId,
      kind: "activity",
      offerId: offer.id,
      travellerIds,
      locked: false,
      date: offer.startsAt.slice(0, 10),
    };
    return {
      ...trip,
      selectedActivities: [
        ...trip.selectedActivities,
        addedSelection,
      ].sort((left, right) => left.id.localeCompare(right.id, "en")),
    };
  }

  if (operation.type === "set_selection_lock") {
    const selection = selectionById(trip, operation.selectionId);
    if (selection.locked === operation.locked) {
      throw new ProposalError(
        "INVALID_OPERATION_ORDER",
        `Selection ${selection.id} already has the requested lock state`,
      );
    }
    if (selection.kind === "travel") {
      return {
        ...trip,
        selectedTravel: replaceSelection(trip.selectedTravel, {
          ...selection,
          locked: operation.locked,
        }),
      };
    }
    if (selection.kind === "stay") {
      return {
        ...trip,
        selectedStays: replaceSelection(trip.selectedStays, {
          ...selection,
          locked: operation.locked,
        }),
      };
    }
    return {
      ...trip,
      selectedActivities: replaceSelection(trip.selectedActivities, {
        ...selection,
        locked: operation.locked,
      }),
    };
  }

  if (operation.type === "replace_travel") {
    const selection = selectionById(trip, operation.selectionId);
    if (selection.kind !== "travel") {
      throw new ProposalError("OPERATION_KIND_MISMATCH", `${selection.id} is not travel`);
    }
    assertUnlocked(selection);
    if (selection.offerId === operation.nextOfferId) {
      throw new ProposalError("INVALID_OPERATION_ORDER", "Replacement offer matches the current offer");
    }
    const offer = await resolveReplacement(operation.nextOfferId, context);
    if (!isTransportOffer(offer) && !isTransferOffer(offer)) {
      throw new ProposalError("OPERATION_KIND_MISMATCH", "Travel replacement requires transport or transfer inventory");
    }
    return {
      ...trip,
      selectedTravel: replaceSelection(trip.selectedTravel, {
        ...selection,
        offerId: operation.nextOfferId,
        offerKind: isTransportOffer(offer) ? "transport" : "transfer",
      }),
    };
  }

  if (operation.type === "replace_stay") {
    const selection = selectionById(trip, operation.selectionId);
    if (selection.kind !== "stay") {
      throw new ProposalError("OPERATION_KIND_MISMATCH", `${selection.id} is not a stay`);
    }
    assertUnlocked(selection);
    if (selection.offerId === operation.nextOfferId) {
      throw new ProposalError("INVALID_OPERATION_ORDER", "Replacement offer matches the current offer");
    }
    const offer = await resolveReplacement(operation.nextOfferId, context);
    if (!isStayOffer(offer)) {
      throw new ProposalError("OPERATION_KIND_MISMATCH", "Stay replacement requires stay inventory");
    }
    return {
      ...trip,
      selectedStays: replaceSelection(trip.selectedStays, {
        ...selection,
        offerId: operation.nextOfferId,
        checkIn: offer.checkIn,
        checkOut: offer.checkOut,
        rooms: offer.rooms,
      }),
    };
  }

  if (operation.type === "replace_activity") {
    const selection = selectionById(trip, operation.selectionId);
    if (selection.kind !== "activity") {
      throw new ProposalError("OPERATION_KIND_MISMATCH", `${selection.id} is not an activity`);
    }
    assertUnlocked(selection);
    if (selection.offerId === operation.nextOfferId) {
      throw new ProposalError("INVALID_OPERATION_ORDER", "Replacement offer matches the current offer");
    }
    const offer = await resolveReplacement(operation.nextOfferId, context);
    if (!isActivityOffer(offer)) {
      throw new ProposalError("OPERATION_KIND_MISMATCH", "Activity replacement requires activity inventory");
    }
    return {
      ...trip,
      selectedActivities: replaceSelection(trip.selectedActivities, {
        ...selection,
        offerId: operation.nextOfferId,
        date: offer.startsAt.slice(0, 10),
      }),
    };
  }

  if (operation.type === "remove_activity") {
    const selection = selectionById(trip, operation.selectionId);
    if (selection.kind !== "activity") {
      throw new ProposalError("OPERATION_KIND_MISMATCH", `${selection.id} is not an activity`);
    }
    assertUnlocked(selection);
    return {
      ...trip,
      selectedActivities: trip.selectedActivities.filter((item) => item.id !== selection.id),
    };
  }

  if (operation.type === "update_activity_participants") {
    const selection = selectionById(trip, operation.selectionId);
    if (selection.kind !== "activity") {
      throw new ProposalError("OPERATION_KIND_MISMATCH", `${selection.id} is not an activity`);
    }
    assertUnlocked(selection);
    const knownTravellerIds = new Set(trip.request.travellers.map((traveller) => traveller.id));
    if (operation.travellerIds.some((id) => !knownTravellerIds.has(id))) {
      throw new ProposalError("INVALID_PROPOSAL", "Participant update contains an unknown traveller ID");
    }
    return {
      ...trip,
      selectedActivities: replaceSelection(trip.selectedActivities, {
        ...selection,
        travellerIds: [...new Set(operation.travellerIds)],
      }),
    };
  }

  if (operation.type === "upsert_constraint") {
    const constraint = constraintSchema.parse(operation.constraint) as Constraint;
    const exists = trip.request.constraints.some((item) => item.id === constraint.id);
    return {
      ...trip,
      request: {
        ...trip.request,
        constraints: exists
          ? trip.request.constraints.map((item) => (item.id === constraint.id ? constraint : item))
          : [...trip.request.constraints, constraint],
      },
    };
  }

  const exists = trip.request.constraints.some((item) => item.id === operation.constraintId);
  if (!exists) {
    throw new ProposalError("INVALID_PROPOSAL", `Unknown constraint ID: ${operation.constraintId}`);
  }
  return {
    ...trip,
    request: {
      ...trip.request,
      constraints: trip.request.constraints.filter((item) => item.id !== operation.constraintId),
    },
  };
}

export async function deriveProposalPreview(
  rawTrip: TripState,
  rawProposal: TripProposal,
  currentProjection: TripProjection,
  context: TripProjectionContext,
): Promise<ProposalEvaluation> {
  const trip = tripStateSchema.parse(rawTrip) as TripState;
  const parsed = tripProposalSchema.safeParse(rawProposal);
  if (!parsed.success) {
    throw new ProposalError("INVALID_PROPOSAL", parsed.error.issues[0]?.message ?? "Invalid proposal");
  }
  const proposal = parsed.data;
  if (proposal.baseTripVersion !== trip.version) {
    throw new ProposalError(
      "STALE_PROPOSAL",
      `Proposal expects trip version ${proposal.baseTripVersion}, but current version is ${trip.version}`,
    );
  }

  let nextTrip = trip;
  for (const operation of proposal.operations) {
    nextTrip = await applyOperation(nextTrip, operation, context);
  }
  nextTrip = tripStateSchema.parse({ ...nextTrip, version: trip.version + 1 }) as TripState;
  const projection = await projectTrip(nextTrip, context);
  if (!projection.validation.valid) {
    throw new ProposalError(
      "INVALID_RESULT",
      projection.validation.issues.find((issue) => issue.severity === "error")?.message ??
        "Proposal does not produce a valid trip",
    );
  }

  const currentSelections = new Map(allSelections(trip).map((selection) => [selection.id, selection]));
  const nextSelections = new Map(allSelections(nextTrip).map((selection) => [selection.id, selection]));
  const changedSelectionIds = [
    ...new Set([
      ...proposal.operations.map(changedSelectionId).filter((id): id is string => Boolean(id)),
      ...[...new Set([...currentSelections.keys(), ...nextSelections.keys()])].filter((id) => {
        const current = currentSelections.get(id);
        const next = nextSelections.get(id);
        return !current || !next || JSON.stringify(current) !== JSON.stringify(next);
      }),
    ]),
  ];
  const changed = new Set(changedSelectionIds);
  const preservedSelectionIds = allSelections(trip)
    .map((selection) => selection.id)
    .filter((id) => !changed.has(id) && nextSelections.has(id));
  const changedCategories = [
    ...new Set(proposal.operations.map(changedCategory)),
  ];

  return {
    preview: {
      proposalId: proposal.id,
      nextTrip,
      changedSelectionIds,
      preservedSelectionIds,
      changedCategories,
      budgetDelta: {
        amount: projection.budget.total.amount - currentProjection.budget.total.amount,
        currency: "INR",
      },
      validation: projection.validation,
    },
    projection,
  };
}

export async function applyProposal(
  trip: TripState,
  proposal: TripProposal,
  currentProjection: TripProjection,
  context: TripProjectionContext,
): Promise<{ trip: TripState; projection: TripProjection }> {
  const evaluation = await deriveProposalPreview(trip, proposal, currentProjection, context);
  return { trip: evaluation.preview.nextTrip, projection: evaluation.projection };
}
