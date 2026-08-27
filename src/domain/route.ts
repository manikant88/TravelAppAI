export interface RouteLocationNode {
  id: string;
  parentId?: string;
}

export type RouteSemanticCall =
  | {
      tool: "search_transport";
      from: string;
      to: string;
      tripDayNumber: number;
    }
  | {
      tool: "search_stays";
      locationId: string;
      checkInDayNumber: number;
      nights: number;
    }
  | {
      tool: "search_activities";
      locationId: string;
      tripDayNumbers: number[];
    }
  | {
      tool: "search_transfers";
      from: string;
      to: string;
    }
  | { tool: "discover_destinations" };

export interface PlannedRouteDefinition {
  originId: string;
  marketId: string;
  stopIds: string[];
  nightAllocation: number[];
  tripDurationDays: number;
}

export interface RequiredRouteCall {
  id: string;
  description: string;
  matches(call: RouteSemanticCall): boolean;
}

export function isWithinLocationScope(
  candidateId: string,
  scopeId: string,
  graph: RouteLocationNode[],
): boolean {
  if (candidateId === scopeId) return true;
  const nodes = new Map(graph.map((node) => [node.id, node]));
  const visited = new Set<string>();
  let current = nodes.get(candidateId);
  while (current && !visited.has(current.id)) {
    if (current.id === scopeId) return true;
    visited.add(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return false;
}

export function requiredRouteCalls(route: PlannedRouteDefinition): RequiredRouteCall[] {
  const firstStopId = route.stopIds[0];
  const lastStopId = route.stopIds.at(-1);
  if (!firstStopId || !lastStopId) return [];

  const requirements: RequiredRouteCall[] = [
    {
      id: "outbound",
      description: `outbound transport from ${route.originId} to ${firstStopId} on trip day 1`,
      matches: (call) =>
        call.tool === "search_transport" &&
        call.from === route.originId &&
        call.to === firstStopId &&
        call.tripDayNumber === 1,
    },
  ];

  let checkInDayNumber = 1;
  route.stopIds.forEach((stopId, index) => {
    const nights = route.nightAllocation[index];
    const stopCheckInDayNumber = checkInDayNumber;
    requirements.push({
      id: `stay:${index}`,
      description: `a ${nights}-night stay at ${stopId} from trip day ${stopCheckInDayNumber}`,
      matches: (call) =>
        call.tool === "search_stays" &&
        call.locationId === stopId &&
        call.checkInDayNumber === stopCheckInDayNumber &&
        call.nights === nights,
    });
    checkInDayNumber += nights;

    const nextStopId = route.stopIds[index + 1];
    if (nextStopId) {
      requirements.push({
        id: `transfer:${index}`,
        description: `an inter-stop transfer from ${stopId} to ${nextStopId}`,
        matches: (call) =>
          call.tool === "search_transfers" && call.from === stopId && call.to === nextStopId,
      });
    }
  });

  requirements.push({
    id: "return",
    description: `return transport from ${lastStopId} to ${route.originId} on trip day ${route.tripDurationDays}`,
    matches: (call) =>
      call.tool === "search_transport" &&
      call.from === lastStopId &&
      call.to === route.originId &&
      call.tripDayNumber === route.tripDurationDays,
  });
  return requirements;
}

export function routeScopeProblems(
  route: PlannedRouteDefinition,
  graph: RouteLocationNode[],
  requestedDestinationId?: string,
): string[] {
  const problems: string[] = [];
  if (route.stopIds.length === 0) problems.push("A route requires at least one stop");
  if (route.stopIds.length !== route.nightAllocation.length) {
    problems.push("Every route stop requires one night allocation");
  }
  if (new Set(route.stopIds).size !== route.stopIds.length) {
    problems.push("A route cannot visit the same stop more than once");
  }
  if (route.nightAllocation.some((nights) => !Number.isInteger(nights) || nights < 1)) {
    problems.push("Every route stop requires at least one whole night");
  }
  const totalNights = route.nightAllocation.reduce((total, nights) => total + nights, 0);
  if (totalNights !== route.tripDurationDays - 1) {
    problems.push("Route night allocation must cover every trip night exactly once");
  }
  if (
    requestedDestinationId &&
    !isWithinLocationScope(route.marketId, requestedDestinationId, graph)
  ) {
    problems.push(
      `Route market ${route.marketId} is outside requested destination ${requestedDestinationId}`,
    );
  }
  route.stopIds.forEach((stopId) => {
    if (!isWithinLocationScope(stopId, route.marketId, graph)) {
      problems.push(`Route stop ${stopId} is outside market ${route.marketId}`);
    }
  });
  return problems;
}

export function routeEvidenceProblems(
  route: PlannedRouteDefinition,
  calls: RouteSemanticCall[],
): string[] {
  return requiredRouteCalls(route)
    .filter((requirement) => !calls.some((call) => requirement.matches(call)))
    .map((requirement) => `Missing evidence search for ${requirement.description}`);
}

export function activityCallFitsRoute(
  route: PlannedRouteDefinition,
  call: Extract<RouteSemanticCall, { tool: "search_activities" }>,
  graph: RouteLocationNode[],
): boolean {
  let firstDay = 1;
  for (let index = 0; index < route.stopIds.length; index += 1) {
    const stopId = route.stopIds[index];
    const nights = route.nightAllocation[index];
    const lastDay = firstDay + nights;
    if (
      isWithinLocationScope(call.locationId, stopId, graph) &&
      call.tripDayNumbers.every((day) => day >= firstDay && day <= lastDay)
    ) {
      return true;
    }
    firstDay += nights;
  }
  return false;
}
