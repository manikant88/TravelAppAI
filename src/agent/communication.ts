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
  const parsed = communicationContextSchema.safeParse(input);
  if (!parsed.success) {
    console.warn("Assistant communication context was invalid", JSON.stringify({
      issueCount: parsed.error.issues.length,
    }));
    return {
      message: input.fallbackMessage,
      actionLabels: input.availableActions.map((action) => ({
        actionId: action.id,
        label: action.label,
      })),
    };
  }
  const context = parsed.data;
  const fallback = deterministicCommunication(context);
  if (!model) return fallback;

  try {
    const output = communicationOutputSchema.parse(await model.compose(context));
    const allowedIds = new Set(context.availableActions.map((action) => action.id));
    if (output.actionLabels.some((item) => !allowedIds.has(item.actionId))) {
      console.warn("Assistant communication returned an unknown action ID");
      return fallback;
    }
    return output;
  } catch (error) {
    console.warn("Assistant communication fell back", JSON.stringify({
      reason: error instanceof Error ? error.message : String(error),
    }));
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
