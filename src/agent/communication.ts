import {
  communicationContextSchema,
  communicationOutputSchema,
  interactionPresentationSchema,
  type CommunicationContext,
  type CommunicationOutput,
  type InteractionPresentation,
} from "@/agent/interaction-contracts";

export interface CommunicationModel {
  compose(context: CommunicationContext): Promise<CommunicationOutput>;
}

export function deterministicCommunication(context: CommunicationContext): CommunicationOutput {
  return {
    message: context.fallbackMessage,
    actionLabels: context.availableActions.map((action) => ({
      actionId: action.id,
      label: action.label,
    })),
  };
}

export async function composeCommunication(
  input: CommunicationContext,
  model?: CommunicationModel,
): Promise<CommunicationOutput> {
  const context = communicationContextSchema.parse(input);
  const fallback = deterministicCommunication(context);
  if (!model) return fallback;

  try {
    const output = communicationOutputSchema.parse(await model.compose(context));
    const allowedIds = new Set(context.availableActions.map((action) => action.id));
    if (output.actionLabels.some((item) => !allowedIds.has(item.actionId))) return fallback;
    return output;
  } catch {
    return fallback;
  }
}

export function applyCommunication(
  presentation: InteractionPresentation,
  output: CommunicationOutput,
): InteractionPresentation {
  const labels = new Map(output.actionLabels.map((item) => [item.actionId, item.label]));
  return interactionPresentationSchema.parse({
    ...presentation,
    message: output.message,
    actions: presentation.actions.map((action) => ({
      ...action,
      label: labels.get(action.id) ?? action.label,
    })),
  });
}
