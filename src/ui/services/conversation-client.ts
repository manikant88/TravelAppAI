import type { CommunicationContext } from "@/agent/interaction-contracts";
import type { ConversationContext } from "@/agent/conversation-contracts";
import type { TripRequest, TripState } from "@/domain/model";
import { postAgentJson } from "@/ui/services/agent-http";

function clientTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function interpretTripBrief(
  message: string,
  currentRequest: TripRequest,
  context?: ConversationContext,
) {
  return postAgentJson(
    "/api/agent/conversation",
    { phase: "draft", clientTurnId: clientTurnId(), message, currentRequest, context },
    { code: "INTAKE_FAILED", message: "The trip brief could not be interpreted." },
  );
}

export function continueTripConversation(payload: {
  message: string;
  trip: TripState;
  context: ConversationContext;
  selectionId?: string;
  targetDate?: string;
}) {
  return postAgentJson(
    "/api/agent/conversation",
    { phase: "committed", clientTurnId: clientTurnId(), ...payload },
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
