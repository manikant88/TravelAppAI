import type { TripRequest } from "@/domain/model";
import { postAgentJson } from "@/ui/services/agent-http";

export function requestSpecifiedPlan(payload: {
  tripId: string;
  request: TripRequest;
  optionalClarificationUsed: boolean;
}) {
  return postAgentJson(
    "/api/agent/plan",
    payload,
    { code: "PLAN_FAILED", message: "The planner could not complete this request." },
  );
}

export function requestDestinationDiscovery(request: TripRequest) {
  return postAgentJson(
    "/api/agent/discover",
    request,
    { code: "DISCOVERY_FAILED", message: "Destination comparison could not complete." },
  );
}
