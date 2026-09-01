import { createHash } from "node:crypto";
import {
  observationBundleSchema,
  toolCallSignature,
  validateToolPlan,
  type ContractViolation,
  type GroundedFact,
  type ObservationBundle,
  type PlannerBudgetState,
  type PlannerScope,
  type PlannerToolCall,
  type ToolPlan,
} from "@/agent/contracts";
import { addCalendarDays, calendarDayDifference, tripDurationDays, tripNightCount } from "@/domain/dates";
import { reduceActivityOffersForPlanning } from "@/inventory/activity-selection";
import type { Constraint, PlannableTripRequest } from "@/domain/model";
import { requirePlannableRequest } from "@/domain/request";
import type {
  ActivityOffer,
  ActivitySearchRequest,
  CoverageResult,
  SearchResponse,
  StayOffer,
  StaySearchRequest,
  TransferOffer,
  TransferSearchRequest,
  TransportOffer,
  TransportSearchRequest,
} from "@/inventory/contracts";
import { createInventoryRepository } from "@/inventory/repository";
import {
  searchActivities,
  searchStays,
  searchTransfers,
  searchTransport,
} from "@/inventory/service";
import { discoverDestinations } from "@/inventory/discovery";

export interface InventoryToolServices {
  searchTransport(request: TransportSearchRequest): Promise<SearchResponse<TransportOffer>>;
  searchStays(request: StaySearchRequest): Promise<SearchResponse<StayOffer>>;
  searchActivities(request: ActivitySearchRequest): Promise<SearchResponse<ActivityOffer>>;
  searchTransfers(request: TransferSearchRequest): Promise<SearchResponse<TransferOffer>>;
  discoverDestinations?: (
    call: Extract<PlannerToolCall, { tool: "discover_destinations" }>,
    request: PlannableTripRequest,
  ) => Promise<{ observation: ObservationBundle; inventoryVersion: string }>;
}

export function createInventoryToolServices(
  repository: ReturnType<typeof createInventoryRepository> = createInventoryRepository(),
): InventoryToolServices {
  return {
    searchTransport: (request) => searchTransport(request, repository),
    searchStays: (request) => searchStays(request, repository),
    searchActivities: (request) => searchActivities(request, repository),
    searchTransfers: (request) => searchTransfers(request, repository),
    discoverDestinations: (_call, request) => discoverDestinations(request, repository),
  };
}

export interface ToolExecutorContext {
  request: PlannableTripRequest;
  knownLocationIds: ReadonlySet<string>;
  knownMarketIds: ReadonlySet<string>;
  knownSelectionIds: ReadonlySet<string>;
  supportedThemes: ReadonlySet<string>;
  budget: PlannerBudgetState;
  roundKind?: "evidence" | "repair";
}

export interface ExecutedToolCall {
  callId: string;
  call: PlannerToolCall;
  inventoryVersion: string;
  observation: ObservationBundle;
}

export interface ToolExecutionBatch {
  operationalSummary: string;
  results: ExecutedToolCall[];
  nextBudget: PlannerBudgetState;
}

export class PlannerToolExecutorError extends Error {
  constructor(
    public readonly code:
      | "INVALID_EXECUTION_CONTEXT"
      | "INVALID_TOOL_PLAN"
      | "TOOL_NOT_IMPLEMENTED"
      | "INVENTORY_FAILURE",
    message: string,
    public readonly details: { callId?: string; tool?: PlannerToolCall["tool"]; violations?: ContractViolation[] } = {},
  ) {
    super(message);
    this.name = "PlannerToolExecutorError";
  }
}

function constraintsFor<K extends Constraint["category"]>(
  request: PlannableTripRequest,
  category: K,
): Extract<Constraint, { category: K }>[] {
  return request.constraints.filter(
    (constraint): constraint is Extract<Constraint, { category: K }> => constraint.category === category,
  );
}

function normalizedThemes(callThemes: string[], request: PlannableTripRequest): string[] {
  return [
    ...new Set(
      [...callThemes, ...(request.preferences.interests ?? [])].map((theme) =>
        theme.trim().toLocaleLowerCase("en"),
      ),
    ),
  ].sort();
}

function factId(candidateId: string, dimension: string): string {
  return `fact:${createHash("sha256").update(`${candidateId}:${dimension}`).digest("hex").slice(0, 20)}`;
}

function fact(
  candidateId: string,
  subjectType: GroundedFact["subjectType"],
  dimension: string,
  label: string,
  value: GroundedFact["value"],
): GroundedFact {
  return {
    id: factId(candidateId, dimension),
    subjectType,
    subjectId: candidateId,
    dimension,
    label,
    value,
  };
}

function transportFacts(offer: TransportOffer, travellerCount: number): GroundedFact[] {
  return [
    fact(offer.id, "transport", "unit_price", "Price per traveller (INR)", offer.price.amount),
    fact(offer.id, "transport", "price_unit", "Price unit", offer.price.unit),
    fact(offer.id, "transport", "total_price", "Total price for selected travellers (INR)", offer.price.amount * travellerCount),
    fact(offer.id, "transport", "duration", "Total duration in minutes", offer.durationMinutes),
    fact(offer.id, "transport", "stops", "Number of stops", offer.stops),
    fact(offer.id, "transport", "departure", "Departure time", offer.departureAt),
    fact(offer.id, "transport", "arrival", "Arrival time", offer.arrivalAt),
    fact(offer.id, "transport", "mode", "Travel mode", offer.mode),
    fact(offer.id, "transport", "operator", "Operator", offer.operator),
  ];
}

function stayFacts(offer: StayOffer): GroundedFact[] {
  const nights = calendarDayDifference(offer.checkIn, offer.checkOut);
  return [
    fact(offer.id, "stay", "property_name", "Property name", offer.propertyFacts.name),
    fact(offer.id, "stay", "unit_price", "Price per room per night (INR)", offer.price.amount),
    fact(offer.id, "stay", "price_unit", "Price unit", offer.price.unit),
    fact(offer.id, "stay", "total_price", "Total stay price (INR)", offer.price.amount * offer.rooms * nights),
    fact(offer.id, "stay", "rooms", "Required rooms", offer.rooms),
    fact(offer.id, "stay", "nights", "Number of nights", nights),
    fact(offer.id, "stay", "location", "Stay location ID", offer.locationId),
    fact(offer.id, "stay", "check_in", "Check-in date", offer.checkIn),
    fact(offer.id, "stay", "check_out", "Check-out date", offer.checkOut),
    fact(offer.id, "stay", "rating", "Property rating", offer.propertyFacts.rating),
    fact(offer.id, "stay", "review_count", "Property review count", offer.propertyFacts.reviewCount),
    fact(offer.id, "stay", "property_tags", "Verified property tags", [...offer.propertyFacts.tags].sort().join(", ")),
    fact(offer.id, "stay", "amenities", "Available amenities", [...offer.propertyFacts.amenities].sort().join(", ")),
    fact(offer.id, "stay", "room_capacity", "Maximum occupancy per room", offer.roomFacts.maxOccupancy),
    fact(offer.id, "stay", "room_label", "Room type", offer.roomFacts.roomLabel),
    fact(offer.id, "stay", "meal_plan", "Meal plan", offer.roomFacts.mealPlan),
    fact(offer.id, "stay", "refundable", "Refundable", offer.roomFacts.refundable),
  ];
}

function activityFacts(offer: ActivityOffer, travellerCount: number): GroundedFact[] {
  const durationMinutes = Math.round((Date.parse(offer.endsAt) - Date.parse(offer.startsAt)) / 60_000);
  return [
    fact(offer.id, "activity", "activity_id", "Activity identity", offer.activityId),
    fact(offer.id, "activity", "activity_name", "Activity name", offer.activityFacts.name),
    fact(offer.id, "activity", "unit_price", "Price per participant (INR)", offer.price.amount),
    fact(offer.id, "activity", "price_unit", "Price unit", offer.price.unit),
    fact(offer.id, "activity", "total_price", "Total price for selected travellers (INR)", offer.price.amount * travellerCount),
    fact(offer.id, "activity", "start", "Activity start time", offer.startsAt),
    fact(offer.id, "activity", "end", "Activity end time", offer.endsAt),
    fact(offer.id, "activity", "duration", "Activity duration in minutes", durationMinutes),
    fact(offer.id, "activity", "capacity", "Session capacity", offer.capacity),
    fact(offer.id, "activity", "location", "Activity location ID", offer.locationId),
    fact(offer.id, "activity", "mobility", "Mobility load", offer.activityFacts.mobility),
    fact(offer.id, "activity", "child_friendly", "Child friendly", offer.activityFacts.childFriendly),
    fact(offer.id, "activity", "senior_friendly", "Senior friendly", offer.activityFacts.seniorFriendly),
    fact(offer.id, "activity", "themes", "Activity themes", [...offer.activityFacts.tags].sort().join(", ")),
  ];
}

function transferFacts(offer: TransferOffer, travellerCount: number): GroundedFact[] {
  const requiredVehicles = Math.ceil(travellerCount / offer.capacity);
  return [
    fact(offer.id, "transfer", "unit_price", "Price per vehicle (INR)", offer.price.amount),
    fact(offer.id, "transfer", "price_unit", "Price unit", offer.price.unit),
    fact(offer.id, "transfer", "required_vehicles", "Required vehicles", requiredVehicles),
    fact(offer.id, "transfer", "total_price", "Total transfer price (INR)", offer.price.amount * requiredVehicles),
    fact(offer.id, "transfer", "duration", "Transfer duration in minutes", offer.durationMinutes),
    fact(offer.id, "transfer", "capacity", "Capacity per vehicle", offer.capacity),
    fact(offer.id, "transfer", "mode", "Transfer mode", offer.mode),
    fact(offer.id, "transfer", "from", "Transfer origin", offer.from),
    fact(offer.id, "transfer", "to", "Transfer destination", offer.to),
  ];
}

export function factsForInventoryOffer(
  offer: TransportOffer | StayOffer | ActivityOffer | TransferOffer,
  travellerCount: number,
): GroundedFact[] {
  if ("serviceId" in offer) return transportFacts(offer, travellerCount);
  if ("roomOfferId" in offer) return stayFacts(offer);
  if ("sessionId" in offer) return activityFacts(offer, travellerCount);
  return transferFacts(offer, travellerCount);
}

function observationFromSearch<T extends { id: string }>(
  toolName: ObservationBundle["toolName"],
  response: SearchResponse<T>,
  factsForOffer: (offer: T) => GroundedFact[],
): ObservationBundle {
  return observationBundleSchema.parse({
    queryId: response.queryId,
    toolName,
    coverage: response.coverage,
    candidates: response.results.map((offer) => ({ candidateId: offer.id, facts: factsForOffer(offer) })),
    rejectedSummary: [],
  });
}

function combineCoverage(responses: SearchResponse<ActivityOffer>[]): CoverageResult {
  if (responses.some((response) => response.results.length > 0)) return { status: "available" };
  const unsupported = responses.find((response) => response.coverage.status === "unsupported_location");
  if (unsupported?.coverage.status === "unsupported_location") return unsupported.coverage;
  if (responses.some((response) => response.coverage.status === "outside_inventory_window")) {
    return { status: "outside_inventory_window" };
  }
  const constraintIds = [
    ...new Set(
      responses.flatMap((response) =>
        response.coverage.status === "eliminated_by_constraints"
          ? response.coverage.constraintIds
          : [],
      ),
    ),
  ].sort();
  if (constraintIds.length > 0) return { status: "eliminated_by_constraints", constraintIds };
  if (responses.some((response) => response.coverage.status === "no_availability")) {
    return { status: "no_availability" };
  }
  return { status: "unsupported_route" };
}

function combinedActivityQueryId(responses: SearchResponse<ActivityOffer>[]): string {
  const sourceIds = responses.map((response) => response.queryId).sort().join(":");
  return `query:agent-activities:${createHash("sha256").update(sourceIds).digest("hex")}`;
}

async function executeCall(
  call: PlannerToolCall,
  context: ToolExecutorContext,
  services: InventoryToolServices,
): Promise<{ observation: ObservationBundle; inventoryVersion: string }> {
  const travellers = context.request.travellers;
  try {
    if (call.tool === "discover_destinations") {
      if (!services.discoverDestinations) {
        throw new PlannerToolExecutorError(
          "TOOL_NOT_IMPLEMENTED",
          "Destination discovery is not available in this implementation slice",
          { callId: call.id, tool: call.tool },
        );
      }
      const result = await services.discoverDestinations(call, context.request);
      return {
        observation: observationBundleSchema.parse(result.observation),
        inventoryVersion: result.inventoryVersion,
      };
    }
    if (call.tool === "search_transport") {
      const response = await services.searchTransport({
        from: call.from,
        to: call.to,
        date: addCalendarDays(context.request.startDate, call.tripDayNumber - 1),
        travellers,
        constraints: constraintsFor(context.request, "travel"),
      });
      return {
        observation: observationFromSearch("search_transport", response, (offer) =>
          transportFacts(offer, travellers.length),
        ),
        inventoryVersion: response.inventoryVersion,
      };
    }
    if (call.tool === "search_stays") {
      const checkIn = addCalendarDays(context.request.startDate, call.checkInDayNumber - 1);
      const response = await services.searchStays({
        locationId: call.locationId,
        checkIn,
        checkOut: addCalendarDays(checkIn, call.nights),
        travellers,
        constraints: constraintsFor(context.request, "stay"),
      });
      return {
        observation: observationFromSearch("search_stays", response, stayFacts),
        inventoryVersion: response.inventoryVersion,
      };
    }
    if (call.tool === "search_activities") {
      const themes = normalizedThemes(call.themes, context.request);
      const responses = await Promise.all(
        [...call.tripDayNumbers]
          .sort((left, right) => left - right)
          .map((dayNumber) => {
            const date = addCalendarDays(context.request.startDate, dayNumber - 1);
            return services.searchActivities({
              locationId: call.locationId,
              startDate: date,
              endDate: date,
              travellers,
              interests: themes,
              constraints: constraintsFor(context.request, "activity"),
            });
          }),
      );
      if (new Set(responses.map((response) => response.inventoryVersion)).size !== 1) {
        throw new Error("Activity search responses use different inventory versions");
      }
      const offers = reduceActivityOffersForPlanning(
        responses.flatMap((response) => response.results),
        {
          startDate: context.request.startDate,
          endDate: context.request.endDate,
          interests: themes,
        },
      );
      const combined: SearchResponse<ActivityOffer> = {
        queryId: combinedActivityQueryId(responses),
        inventoryVersion: responses[0]?.inventoryVersion ?? "unknown",
        results: offers,
        resultCount: offers.length,
        appliedFilters: [],
        coverage: combineCoverage(responses),
        generatedAt: responses.map((response) => response.generatedAt).sort().at(-1) ?? new Date(0).toISOString(),
      };
      return {
        observation: observationFromSearch("search_activities", combined, (offer) =>
          activityFacts(offer, travellers.length),
        ),
        inventoryVersion: combined.inventoryVersion,
      };
    }
    const response = await services.searchTransfers({
      from: call.from,
      to: call.to,
      travellers,
    });
    return {
      observation: observationFromSearch("search_transfers", response, (offer) =>
        transferFacts(offer, travellers.length),
      ),
      inventoryVersion: response.inventoryVersion,
    };
  } catch (error: unknown) {
    if (error instanceof PlannerToolExecutorError) throw error;
    throw new PlannerToolExecutorError(
      "INVENTORY_FAILURE",
      `Inventory execution failed for ${call.tool}`,
      { callId: call.id, tool: call.tool },
    );
  }
}

function plannerScope(context: ToolExecutorContext): PlannerScope {
  return {
    tripDurationDays: tripDurationDays(context.request.startDate, context.request.endDate),
    tripNights: tripNightCount(context.request.startDate, context.request.endDate),
    knownLocationIds: context.knownLocationIds,
    knownMarketIds: context.knownMarketIds,
    knownSelectionIds: context.knownSelectionIds,
    supportedThemes: new Set([
      ...[...context.supportedThemes].map((theme) => theme.toLocaleLowerCase("en")),
      ...(context.request.preferences.interests ?? []).map((theme) => theme.toLocaleLowerCase("en")),
    ]),
  };
}

export async function executeToolPlan(
  plan: ToolPlan,
  context: ToolExecutorContext,
  services: InventoryToolServices = createInventoryToolServices(),
): Promise<ToolExecutionBatch> {
  let canonicalRequest: PlannableTripRequest;
  try {
    canonicalRequest = requirePlannableRequest(context.request);
  } catch {
    throw new PlannerToolExecutorError(
      "INVALID_EXECUTION_CONTEXT",
      "Tool execution requires a canonical plannable trip request",
    );
  }
  const canonicalContext = { ...context, request: canonicalRequest };
  const roundKind = canonicalContext.roundKind ?? "evidence";
  const validation = validateToolPlan(
    plan,
    plannerScope(canonicalContext),
    canonicalContext.budget,
    roundKind,
  );
  if (!validation.valid || !validation.value) {
    throw new PlannerToolExecutorError("INVALID_TOOL_PLAN", "Planner tool plan failed deterministic validation", {
      violations: validation.violations,
    });
  }

  const observations = await Promise.all(
    validation.value.calls.map(async (call) => {
      const result = await executeCall(call, canonicalContext, services);
      return {
        callId: call.id,
        call,
        inventoryVersion: result.inventoryVersion,
        observation: result.observation,
      };
    }),
  );
  const nextSignatures = new Set(canonicalContext.budget.priorCallSignatures);
  validation.value.calls.forEach((call) => nextSignatures.add(toolCallSignature(call)));
  return {
    operationalSummary: validation.value.operationalSummary,
    results: observations,
    nextBudget: {
      evidenceRoundsUsed:
        roundKind === "evidence"
          ? canonicalContext.budget.evidenceRoundsUsed + 1
          : canonicalContext.budget.evidenceRoundsUsed,
      repairRoundsUsed:
        roundKind === "repair"
          ? canonicalContext.budget.repairRoundsUsed + 1
          : canonicalContext.budget.repairRoundsUsed,
      searchCallsUsed: canonicalContext.budget.searchCallsUsed + validation.value.calls.length,
      optionalClarificationUsed: canonicalContext.budget.optionalClarificationUsed,
      priorCallSignatures: nextSignatures,
    },
  };
}
