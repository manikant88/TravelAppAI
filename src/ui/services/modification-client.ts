import type { TripProposal } from "@/domain/proposals";
import type { TripState } from "@/domain/model";
import { postAgentJson } from "@/ui/services/agent-http";

export function applyTripProposal(trip: TripState, proposal: TripProposal) {
  return postAgentJson(
    "/api/trip/proposals/apply",
    { trip, proposal },
    { code: "PROPOSAL_FAILED", message: "This trip change could not be applied." },
  );
}
