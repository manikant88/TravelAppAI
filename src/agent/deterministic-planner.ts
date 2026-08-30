import type {
  PlannerDecisionInput,
  SpecifiedDestinationPlannerModel,
} from "@/agent/coordinator";
import type {
  CandidateFactBundle,
  CandidateChoice,
  PlannerToolCall,
  PlanningHypothesis,
} from "@/agent/contracts";
import { tripDurationDays, tripNightCount } from "@/domain/dates";
import type { PlannableTripRequest } from "@/domain/model";
import type { LocationNode } from "@/domain/trip";

function allocateNights(totalNights: number, stopCount: number): number[] {
  const base = Math.floor(totalNights / stopCount);
  const remainder = totalNights % stopCount;
  return Array.from({ length: stopCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function routeStops(request: PlannableTripRequest, graph: LocationNode[]): string[] {
  if (request.destination.kind !== "specified") return [];
  const marketId = request.destination.locationId;
  const market = graph.find((node) => node.id === marketId);
  if (market?.type === "city") return [marketId];
  const routeOrder = (node: LocationNode): number => {
    const tag = node.tags?.find((item) => item.startsWith("route_order:"));
    const value = tag ? Number(tag.slice("route_order:".length)) : Number.POSITIVE_INFINITY;
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  const childCities = graph
    .filter((node) => node.parentId === marketId && node.type === "city")
    .sort((left, right) =>
      routeOrder(left) - routeOrder(right) || left.id.localeCompare(right.id, "en"),
    )
    .map((node) => node.id);
  return childCities.length > 0 ? childCities : [marketId];
}

function deterministicHypothesis(
  request: PlannableTripRequest,
  graph: LocationNode[],
): PlanningHypothesis {
  const marketId = request.destination.kind === "specified" ? request.destination.locationId : "";
  const nights = tripNightCount(request.startDate, request.endDate);
  const stops = routeStops(request, graph).slice(0, Math.max(1, nights));
  const nightAllocation = allocateNights(nights, stops.length);
  const duration = tripDurationDays(request.startDate, request.endDate);
  const calls: PlannerToolCall[] = [{ id: "fallback:outbound", tool: "search_transport", purpose: "Find valid outbound travel", from: request.origin, to: stops[0]!, tripDayNumber: 1 }];

  let firstDay = 1;
  stops.forEach((stopId, index) => {
    const stopNights = nightAllocation[index]!;
    calls.push({ id: `fallback:stay:${index}`, tool: "search_stays", purpose: `Find a valid stay at route stop ${index + 1}`, locationId: stopId, checkInDayNumber: firstDay, nights: stopNights });
    const activityDays = Array.from({ length: stopNights + (index === stops.length - 1 ? 1 : 0) }, (_, offset) => firstDay + offset);
    calls.push({ id: `fallback:activities:${index}`, tool: "search_activities", purpose: `Find schedule-valid activities at route stop ${index + 1}`, locationId: stopId, tripDayNumbers: activityDays, themes: request.preferences.interests ?? [] });
    const nextStop = stops[index + 1];
    if (nextStop) calls.push({ id: `fallback:transfer:${index}`, tool: "search_transfers", purpose: "Connect adjacent route stops", from: stopId, to: nextStop });
    firstDay += stopNights;
  });
  calls.push({ id: "fallback:return", tool: "search_transport", purpose: "Find valid return travel", from: stops.at(-1)!, to: request.origin, tripDayNumber: duration });

  return {
    goalSummary: "Assemble a deterministic valid trip from grounded inventory",
    destinationMode: "specified",
    candidateMarketIds: [marketId],
    proposedStopIds: stops,
    nightAllocation,
    preferenceOrder: ["price", "timing", "activity_fit"],
    preserveSelectionIds: [],
    toolPlan: { operationalSummary: "Retrieve the complete route inventory in one bounded round", calls },
  };
}

function numericFact(candidate: CandidateFactBundle, dimension: string): number {
  const value = candidate.facts.find((fact) => fact.dimension === dimension)?.value;
  return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
}

function textFact(candidate: CandidateFactBundle, dimension: string): string | undefined {
  const value = candidate.facts.find((fact) => fact.dimension === dimension)?.value;
  return typeof value === "string" ? value : undefined;
}

function overlapsSelectedTravel(candidate: CandidateFactBundle, travel: CandidateFactBundle[]): boolean {
  const startsAt = textFact(candidate, "start");
  const endsAt = textFact(candidate, "end");
  if (!startsAt || !endsAt) return false;
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return travel.some((selection) => {
    const departure = textFact(selection, "departure");
    const arrival = textFact(selection, "arrival");
    if (!departure || !arrival) return false;
    const travelStart = new Date(departure).getTime();
    const travelEnd = new Date(arrival).getTime();
    return start < travelEnd && travelStart < end;
  });
}

function overlaps(candidate: CandidateFactBundle, selected: CandidateFactBundle[]): boolean {
  const startsAt = textFact(candidate, "start");
  const endsAt = textFact(candidate, "end");
  if (!startsAt || !endsAt) return false;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return selected.some((item) => {
    const selectedStart = textFact(item, "start");
    const selectedEnd = textFact(item, "end");
    if (!selectedStart || !selectedEnd) return false;
    return start < Date.parse(selectedEnd) && Date.parse(selectedStart) < end;
  });
}

function activityDate(candidate: CandidateFactBundle): string | undefined {
  return textFact(candidate, "start")?.slice(0, 10);
}

const TRAVEL_ACTIVITY_BUFFER_MS = 90 * 60 * 1000;

function fitsDestinationTravelWindow(
  candidate: CandidateFactBundle,
  travel: CandidateFactBundle[],
  request: PlannableTripRequest,
): boolean {
  const startsAt = textFact(candidate, "start");
  const endsAt = textFact(candidate, "end");
  if (!startsAt || !endsAt) return false;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  // Identify the boundary journeys by their departure dates. Long-haul
  // outbound travel can arrive one or more calendar days after the trip starts
  // (for example Delhi to Sydney), so comparing the arrival's date with the
  // requested start date incorrectly leaves pre-arrival activities eligible.
  const outboundArrivals = travel.flatMap((selection) => {
    const departure = textFact(selection, "departure");
    const arrival = textFact(selection, "arrival");
    return departure?.slice(0, 10) === request.startDate && arrival
      ? [Date.parse(arrival)]
      : [];
  });
  if (
    outboundArrivals.length > 0 &&
    start < Math.max(...outboundArrivals) + TRAVEL_ACTIVITY_BUFFER_MS
  ) return false;

  const returnDepartures = travel.flatMap((selection) => {
    const departure = textFact(selection, "departure");
    return departure?.slice(0, 10) === request.endDate
      ? [Date.parse(departure)]
      : [];
  });
  if (
    returnDepartures.length > 0 &&
    end > Math.min(...returnDepartures) - TRAVEL_ACTIVITY_BUFFER_MS
  ) return false;
  return true;
}

function activityPreferenceScore(
  candidate: CandidateFactBundle,
  interests: string[],
): number {
  const themes = (textFact(candidate, "themes") ?? "")
    .split(",")
    .map((theme) => theme.trim().toLocaleLowerCase("en"));
  return interests.reduce(
    (score, interest) => score + (themes.includes(interest.toLocaleLowerCase("en")) ? 1 : 0),
    0,
  );
}

function candidateChoice(candidate: CandidateFactBundle, index: number, allowedDimensions: Set<string>): CandidateChoice {
  const dimensions = candidate.facts.map((fact) => fact.dimension).filter((dimension) => allowedDimensions.has(dimension));
  return {
    decisionId: `fallback:decision:${index}`,
    candidateId: candidate.candidateId,
    supportingFactIds: candidate.facts.slice(0, 3).map((fact) => fact.id),
    comparisonDimensions: dimensions.slice(0, 2).length > 0 ? dimensions.slice(0, 2) : [candidate.facts[0]!.dimension],
    summary: "Selected deterministically from hard-valid grounded inventory",
  };
}

function deterministicAction(input: PlannerDecisionInput) {
  if (input.validationFeedback) {
    const validationBundle = input.factBundles.at(-1);
    const conflictFactIds = validationBundle?.facts.map((fact) => fact.id) ?? [];
    return {
      type: "cannot_satisfy" as const,
      conflictFactIds: conflictFactIds.length > 0 ? conflictFactIds : [input.factBundles[0]!.facts[0]!.id],
      suggestedRelaxationIds: validationBundle?.allowedFollowUpActions.map((action) => action.id) ?? [],
    };
  }

  const allowedDimensions = new Set(input.factBundles.flatMap((bundle) => bundle.allowedComparisonDimensions));
  const choices: CandidateChoice[] = [];
  const selectedTravel: CandidateFactBundle[] = [];
  let decisionIndex = 0;
  for (const observation of input.observations.filter((item) => item.toolName !== "search_activities")) {
    if (observation.candidates.length === 0) continue;
    const candidate = [...observation.candidates].sort((left, right) => numericFact(left, "total_price") - numericFact(right, "total_price") || left.candidateId.localeCompare(right.candidateId, "en"))[0]!;
    choices.push(candidateChoice(candidate, decisionIndex, allowedDimensions));
    if (observation.toolName === "search_transport") selectedTravel.push(candidate);
    decisionIndex += 1;
  }
  const activityLimitPerDay = input.request.preferences.pace === "packed" ? 2 : 1;
  const selectedActivities: CandidateFactBundle[] = [];
  const selectedByDate = new Map<string, number>();
  const activityCandidates = input.observations
    .filter((item) => item.toolName === "search_activities")
    .flatMap((observation) => observation.candidates)
    .filter((candidate, index, candidates) =>
      candidates.findIndex((item) => item.candidateId === candidate.candidateId) === index,
    )
    .sort((left, right) =>
      activityPreferenceScore(right, input.request.preferences.interests ?? []) -
        activityPreferenceScore(left, input.request.preferences.interests ?? []) ||
      numericFact(left, "total_price") - numericFact(right, "total_price") ||
      (textFact(left, "start") ?? "").localeCompare(textFact(right, "start") ?? "", "en") ||
      left.candidateId.localeCompare(right.candidateId, "en"),
    );
  for (const candidate of activityCandidates) {
    const date = activityDate(candidate);
    if (!date || (selectedByDate.get(date) ?? 0) >= activityLimitPerDay) continue;
    if (
      overlapsSelectedTravel(candidate, selectedTravel) ||
      !fitsDestinationTravelWindow(candidate, selectedTravel, input.request) ||
      overlaps(candidate, selectedActivities)
    ) continue;
    selectedActivities.push(candidate);
    selectedByDate.set(date, (selectedByDate.get(date) ?? 0) + 1);
    choices.push(candidateChoice(candidate, decisionIndex, allowedDimensions));
    decisionIndex += 1;
  }
  return {
    type: "propose_plan" as const,
    marketId: input.hypothesis.candidateMarketIds[0]!,
    stopIds: input.hypothesis.proposedStopIds,
    nightAllocation: input.hypothesis.nightAllocation,
    choices,
  };
}

export function createDeterministicPlannerModel(): SpecifiedDestinationPlannerModel {
  return {
    deterministicStrategy: true,
    async createPlanningHypothesis({ request, catalogScope }) {
      return deterministicHypothesis(request, catalogScope.locationGraph);
    },
    async chooseNextAction(input) {
      return deterministicAction(input);
    },
  };
}
