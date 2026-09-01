import type {
  ActiveInteraction,
  ConversationContext,
} from "@/agent/conversation-contracts";
import type { InteractionPresentation, TripField } from "@/agent/interaction-contracts";
import type { TripRequest } from "@/domain/model";

type ConversationEntry = ConversationContext["history"][number];

function taskFor(
  request: TripRequest,
  awaitingFields: TripField[],
): ActiveInteraction["task"] {
  if (awaitingFields.length > 0) return "complete_trip_brief";
  if (request.destination?.kind === "open") return "discover_destinations";
  return "build_itinerary";
}

/** Converts render-oriented guidance into durable, bounded conversation state. */
export function deriveActiveInteraction(
  request: TripRequest,
  presentation: InteractionPresentation,
): ActiveInteraction {
  const awaitingFields = presentation.events.flatMap((event): TripField[] => {
    if (
      event.type !== "fact_missing" ||
      event.status === "completed" ||
      event.target?.type !== "trip_field"
    ) return [];
    return [event.target.field];
  });
  const uniqueAwaitingFields = [...new Set(awaitingFields)];
  return {
    mode: request.destination?.kind === "specified" && !request.dateWindow ? "build" : "explore",
    task: taskFor(request, uniqueAwaitingFields),
    awaitingFields: uniqueAwaitingFields,
    lastAssistantMessage: presentation.message,
    availableActions: presentation.actions,
  };
}

export function buildConversationContext(
  history: ConversationEntry[],
  activeInteraction?: ActiveInteraction,
): ConversationContext {
  return { history: history.slice(-8), activeInteraction };
}
