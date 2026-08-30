import type { CommunicationContext } from "@/agent/interaction-contracts";
import type { TripRequest, TripState } from "@/domain/model";
import { postAgentJson } from "@/ui/services/agent-http";

export function interpretTripBrief(message: string, currentRequest: TripRequest) {
  return postAgentJson(
    "/api/agent/conversation",
    { phase: "draft", message, currentRequest },
    { code: "INTAKE_FAILED", message: "The trip brief could not be interpreted." },
  );
}

export function continueTripConversation(payload: {
  message: string;
  trip: TripState;
  conversationHistory: Array<{ role: "user" | "assistant"; text: string }>;
}) {
  return postAgentJson(
    "/api/agent/conversation",
    { phase: "committed", ...payload },
    { code: "CONVERSATION_FAILED", message: "The assistant could not complete that request." },
  );
}

function requestAssistantCommunication(context: CommunicationContext) {
  return postAgentJson(
    "/api/agent/communicate",
    context,
    { code: "COMMUNICATION_FAILED", message: context.fallbackMessage },
  );
}

export async function rewriteAssistantMessage(
  fallbackMessage: string,
  intent: CommunicationContext["intent"],
  facts: string[] = [fallbackMessage],
): Promise<string> {
  try {
    const body = await requestAssistantCommunication({
      intent,
      fallbackMessage,
      facts,
      events: [],
      availableActions: [],
    });
    if (!body || typeof body !== "object") return fallbackMessage;
    const message = (body as { message?: unknown }).message;
    return typeof message === "string" && message.trim() ? message.trim() : fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}
