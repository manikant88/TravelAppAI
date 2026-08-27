import { createHash } from "node:crypto";
import {
  factBundleSchema,
  observationBundleSchema,
  validateAgentNextAction,
  type AgentNextAction,
  type ContractViolation,
  type FactBundle,
  type PlannerBudgetState,
} from "@/agent/contracts";
import type { ExecutedToolCall } from "@/agent/executor";
import { buildRouteStops, tripDurationDays, tripNightCount } from "@/domain/dates";
import type {
  ActivitySelection,
  PlannableTripRequest,
  StaySelection,
  TravelSelection,
  TripState,
} from "@/domain/model";
import { requirePlannableRequest } from "@/domain/request";
import {
  projectTrip,
  tripStateSchema,
  type LocationNode,
  type ResolvedOffer,
  type TripProjection,
} from "@/domain/trip";
import type {
  ActivityOffer,
  StayOffer,
  TransferOffer,
  TransportOffer,
} from "@/inventory/contracts";

export type ProposePlanAction = Extract<AgentNextAction, { type: "propose_plan" }>;

export interface PlanAssemblerInput {
  tripId: string;
  action: ProposePlanAction;
  request: PlannableTripRequest;
  executedCalls: ExecutedToolCall[];
  factBundles: FactBundle[];
  budget: PlannerBudgetState;
  locationGraph: LocationNode[];
  knownMarketIds: ReadonlySet<string>;
  supportedThemes: ReadonlySet<string>;
  expectedInventoryVersion?: string;
  resolveOffer(offerId: string): Promise<ResolvedOffer>;
}

export type PlanAssemblyResult =
  | {
      status: "valid";
      trip: TripState;
      projection: TripProjection;
      selectedCandidateIds: string[];
    }
  | {
      status: "invalid";
      trip: TripState;
      projection: TripProjection;
      selectedCandidateIds: string[];
    };

export class PlanAssemblyError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ASSEMBLY_CONTEXT"
      | "INVALID_ACTION"
      | "DUPLICATE_CANDIDATE"
      | "UNKNOWN_CANDIDATE"
      | "AMBIGUOUS_CANDIDATE"
      | "INVENTORY_VERSION_MISMATCH"
      | "OFFER_RESOLUTION_FAILED"
      | "OFFER_TYPE_MISMATCH",
    message: string,
    public readonly details: {
      candidateId?: string;
      violations?: ContractViolation[];
      inventoryVersions?: string[];
    } = {},
  ) {
    super(message);
    this.name = "PlanAssemblyError";
  }
}

interface CandidateBinding {
  candidateId: string;
  execution: ExecutedToolCall;
}

function isTransportOffer(offer: ResolvedOffer): offer is TransportOffer {
  return "serviceId" in offer;
}

function isTransferOffer(offer: ResolvedOffer): offer is TransferOffer {
  return "transferId" in offer;
}

function isStayOffer(offer: ResolvedOffer): offer is StayOffer {
  return "roomOfferId" in offer;
}

function isActivityOffer(offer: ResolvedOffer): offer is ActivityOffer {
  return "sessionId" in offer;
}

function selectionId(tripId: string, candidateId: string, kind: string): string {
  const digest = createHash("sha256")
    .update(`${tripId}:${kind}:${candidateId}`)
    .digest("hex")
    .slice(0, 24);
  return `selection:${kind}:${digest}`;
}

function bindCandidate(candidateId: string, executions: ExecutedToolCall[]): CandidateBinding {
  const matches = executions.filter((execution) =>
    execution.observation.candidates.some((candidate) => candidate.candidateId === candidateId),
  );
  if (matches.length === 0) {
    throw new PlanAssemblyError(
      "UNKNOWN_CANDIDATE",
      `Candidate ${candidateId} is not present in executed observations`,
      { candidateId },
    );
  }
  const toolNames = new Set(matches.map((match) => match.observation.toolName));
  const inventoryVersions = new Set(matches.map((match) => match.inventoryVersion));
  if (toolNames.size !== 1 || inventoryVersions.size !== 1) {
    throw new PlanAssemblyError(
      "AMBIGUOUS_CANDIDATE",
      `Candidate ${candidateId} has conflicting observation bindings`,
      { candidateId, inventoryVersions: [...inventoryVersions].sort() },
    );
  }
  return {
    candidateId,
    execution: [...matches].sort((left, right) => left.callId.localeCompare(right.callId, "en"))[0],
  };
}

function offerMatchesTool(offer: ResolvedOffer, execution: ExecutedToolCall): boolean {
  switch (execution.observation.toolName) {
    case "search_transport":
      return isTransportOffer(offer);
    case "search_stays":
      return isStayOffer(offer);
    case "search_activities":
      return isActivityOffer(offer);
    case "search_transfers":
      return isTransferOffer(offer);
    case "discover_destinations":
      return false;
  }
}

function createSelection(
  tripId: string,
  offer: ResolvedOffer,
  execution: ExecutedToolCall,
  travellerIds: string[],
): TravelSelection | StaySelection | ActivitySelection {
  if (isTransportOffer(offer) && execution.observation.toolName === "search_transport") {
    return {
      id: selectionId(tripId, offer.id, "travel"),
      kind: "travel",
      offerKind: "transport",
      offerId: offer.id,
      travellerIds,
      locked: false,
    };
  }
  if (isTransferOffer(offer) && execution.observation.toolName === "search_transfers") {
    return {
      id: selectionId(tripId, offer.id, "travel"),
      kind: "travel",
      offerKind: "transfer",
      offerId: offer.id,
      travellerIds,
      locked: false,
    };
  }
  if (isStayOffer(offer) && execution.observation.toolName === "search_stays") {
    return {
      id: selectionId(tripId, offer.id, "stay"),
      kind: "stay",
      offerId: offer.id,
      travellerIds,
      locked: false,
      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
      rooms: offer.rooms,
    };
  }
  if (isActivityOffer(offer) && execution.observation.toolName === "search_activities") {
    return {
      id: selectionId(tripId, offer.id, "activity"),
      kind: "activity",
      offerId: offer.id,
      travellerIds,
      locked: false,
      date: offer.startsAt.slice(0, 10),
    };
  }
  throw new PlanAssemblyError(
    "OFFER_TYPE_MISMATCH",
    `Resolved offer ${offer.id} does not match ${execution.observation.toolName}`,
    { candidateId: offer.id },
  );
}

export async function assembleProposedPlan(
  input: PlanAssemblerInput,
): Promise<PlanAssemblyResult> {
  if (!input.tripId.trim()) {
    throw new PlanAssemblyError("INVALID_ASSEMBLY_CONTEXT", "Trip ID is required");
  }
  let request: PlannableTripRequest;
  try {
    request = requirePlannableRequest(input.request);
  } catch {
    throw new PlanAssemblyError(
      "INVALID_ASSEMBLY_CONTEXT",
      "Plan assembly requires a canonical plannable trip request",
    );
  }
  try {
    input.factBundles.forEach((bundle) => factBundleSchema.parse(bundle));
    input.executedCalls.forEach((execution) => {
      observationBundleSchema.parse(execution.observation);
      if (
        execution.callId !== execution.call.id ||
        execution.call.tool !== execution.observation.toolName ||
        !execution.inventoryVersion.trim()
      ) {
        throw new Error("Executed call metadata is inconsistent");
      }
    });
  } catch {
    throw new PlanAssemblyError(
      "INVALID_ASSEMBLY_CONTEXT",
      "Executed observations or fact bundles are internally inconsistent",
    );
  }

  const observations = input.executedCalls.map((execution) => execution.observation);
  const actionValidation = validateAgentNextAction(
    input.action,
    {
      tripDurationDays: tripDurationDays(request.startDate, request.endDate),
      tripNights: tripNightCount(request.startDate, request.endDate),
      knownLocationIds: new Set(input.locationGraph.map((node) => node.id)),
      knownMarketIds: input.knownMarketIds,
      knownSelectionIds: new Set(),
      supportedThemes: input.supportedThemes,
      originId: request.origin,
      requestedDestinationId:
        request.destination.kind === "specified" ? request.destination.locationId : undefined,
      locationGraph: input.locationGraph,
      observations,
      factBundles: input.factBundles,
    },
    input.budget,
  );
  if (!actionValidation.valid) {
    throw new PlanAssemblyError("INVALID_ACTION", "Proposed plan failed grounded action validation", {
      violations: actionValidation.violations,
    });
  }

  const candidateIds = input.action.choices.map((choice) => choice.candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new PlanAssemblyError(
      "DUPLICATE_CANDIDATE",
      "A candidate can create at most one canonical selection",
    );
  }
  const bindings = candidateIds.map((candidateId) => bindCandidate(candidateId, input.executedCalls));
  const inventoryVersions = [
    ...new Set(bindings.map((binding) => binding.execution.inventoryVersion)),
  ].sort();
  if (
    inventoryVersions.length !== 1 ||
    (input.expectedInventoryVersion !== undefined &&
      inventoryVersions[0] !== input.expectedInventoryVersion)
  ) {
    throw new PlanAssemblyError(
      "INVENTORY_VERSION_MISMATCH",
      "Selected candidates do not share the expected inventory version",
      { inventoryVersions },
    );
  }

  const resolved = await Promise.all(
    bindings.map(async (binding) => {
      let offer: ResolvedOffer;
      try {
        offer = await input.resolveOffer(binding.candidateId);
      } catch {
        throw new PlanAssemblyError(
          "OFFER_RESOLUTION_FAILED",
          `Candidate ${binding.candidateId} could not be resolved from current inventory`,
          { candidateId: binding.candidateId },
        );
      }
      if (offer.id !== binding.candidateId || !offerMatchesTool(offer, binding.execution)) {
        throw new PlanAssemblyError(
          "OFFER_TYPE_MISMATCH",
          `Resolved facts do not match candidate ${binding.candidateId}`,
          { candidateId: binding.candidateId },
        );
      }
      return { binding, offer };
    }),
  );

  const travellerIds = request.travellers.map((traveller) => traveller.id);
  const selections = resolved.map(({ binding, offer }) =>
    createSelection(input.tripId, offer, binding.execution, travellerIds),
  );
  const trip = tripStateSchema.parse({
    id: input.tripId,
    inventoryVersion: inventoryVersions[0],
    request,
    route: {
      marketId: input.action.marketId,
      stops: buildRouteStops(
        request.startDate,
        request.endDate,
        input.action.stopIds,
        input.action.nightAllocation,
      ),
    },
    selectedTravel: selections
      .filter((selection): selection is TravelSelection => selection.kind === "travel")
      .sort((left, right) => left.id.localeCompare(right.id, "en")),
    selectedStays: selections
      .filter((selection): selection is StaySelection => selection.kind === "stay")
      .sort((left, right) => left.id.localeCompare(right.id, "en")),
    selectedActivities: selections
      .filter((selection): selection is ActivitySelection => selection.kind === "activity")
      .sort((left, right) => left.id.localeCompare(right.id, "en")),
    version: 0,
  }) as TripState;

  const resolvedById = new Map(resolved.map(({ offer }) => [offer.id, offer]));
  const projection = await projectTrip(trip, {
    locationGraph: input.locationGraph,
    async resolveOffer(offerId) {
      const offer = resolvedById.get(offerId);
      if (!offer) throw new Error(`Offer ${offerId} was not resolved during assembly`);
      return offer;
    },
  });
  return {
    status: projection.validation.valid ? "valid" : "invalid",
    trip,
    projection,
    selectedCandidateIds: [...candidateIds].sort((left, right) => left.localeCompare(right, "en")),
  };
}
