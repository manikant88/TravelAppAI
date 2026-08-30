import { composeCommunication } from "@/agent/communication";
import type { CommunicationContext, CommunicationOutput } from "@/agent/interaction-contracts";
import { createOpenAICommunicationModel } from "@/agent/model";

const DEFAULT_COMMUNICATION_TIMEOUT_MS = 4_000;

/**
 * The single server-side boundary for final assistant copy.
 * Planning and domain code provide verified facts; this layer only improves
 * phrasing and always falls back to the supplied deterministic message.
 */
export async function generateAssistantCommunication(
  context: CommunicationContext,
  timeoutMs = DEFAULT_COMMUNICATION_TIMEOUT_MS,
): Promise<CommunicationOutput> {
  const model = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return composeCommunication(
    context,
    model && apiKey
      ? createOpenAICommunicationModel({ model, apiKey, timeoutMs })
      : undefined,
  );
}

export async function generateAssistantMessage(
  fallbackMessage: string,
  context: Omit<CommunicationContext, "fallbackMessage">,
): Promise<string> {
  const communication = await generateAssistantCommunication({
    ...context,
    fallbackMessage,
  });
  return communication.message;
}
