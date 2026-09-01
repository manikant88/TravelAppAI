import { composeCommunication } from "@/agent/communication";
import type { CommunicationContext, CommunicationOutput } from "@/agent/interaction-contracts";
import { createOpenAICommunicationModel } from "@/agent/model";
import {
  getOpenAIModelConfig,
  resolveOpenAITimeoutMs,
} from "@/agent/openai-config.server";

/**
 * The single server-side boundary for final assistant copy.
 * Planning and domain code provide verified facts; this layer only improves
 * phrasing and always falls back to the supplied deterministic message.
 */
export async function generateAssistantCommunication(
  context: CommunicationContext,
  timeoutMs = resolveOpenAITimeoutMs("communication"),
  correlationId?: string,
): Promise<CommunicationOutput> {
  const config = getOpenAIModelConfig("communication");
  return composeCommunication(
    context,
    config
      ? createOpenAICommunicationModel({ ...config, timeoutMs, correlationId })
      : undefined,
  );
}

export async function generateAssistantMessage(
  fallbackMessage: string,
  context: Omit<CommunicationContext, "fallbackMessage">,
  correlationId?: string,
): Promise<string> {
  const communication = await generateAssistantCommunication({
    ...context,
    fallbackMessage,
  }, resolveOpenAITimeoutMs("communication"), correlationId);
  return communication.message;
}
