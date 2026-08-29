import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { runNaturalIntake, NaturalIntakeError } from "@/agent/natural-intake";
import { runModification, ModifyError } from "@/agent/modify";
import { runExplanation, ExplainError } from "@/agent/explain";
import {
  createOpenAIExplanationModel,
  createOpenAICommunicationModel,
  createOpenAIModificationModel,
  createOpenAINaturalIntakeModel,
} from "@/agent/model";
import { tripRequestSchema } from "@/domain/request";
import { tripStateSchema } from "@/domain/trip";
import { createDeterministicModificationModel } from "@/agent/deterministic-modification";
import { createInventoryRepository } from "@/inventory/repository";
import { intakePresentation } from "@/agent/interaction-guidance";
import { applyCommunication, composeCommunication } from "@/agent/communication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const draftConversationSchema = z
  .object({
    phase: z.literal("draft"),
    message: z.string().trim().min(1).max(800),
    currentRequest: tripRequestSchema,
  })
  .strict();

const committedConversationSchema = z
  .object({
    phase: z.literal("committed"),
    message: z.string().trim().min(1).max(800),
    trip: tripStateSchema,
    actionHint: z.enum(["modify_trip", "explain_trip"]).optional(),
    selectionId: z.string().trim().min(1).optional(),
    targetDate: z.string().date().optional(),
  })
  .strict();

const conversationRequestSchema = z.discriminatedUnion("phase", [
  draftConversationSchema,
  committedConversationSchema,
]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsed = conversationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_REQUEST",
        message: parsed.error.issues[0]?.message ?? "Invalid conversation request",
        retryable: false,
      },
      { status: 400 },
    );
  }

  const model = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  try {
    if (parsed.data.phase === "draft") {
      const result = await runNaturalIntake(
        {
          message: parsed.data.message,
          currentRequest: parsed.data.currentRequest,
        },
        {
          model: model && apiKey
            ? createOpenAINaturalIntakeModel({ model, apiKey })
            : undefined,
        },
      );
      const catalog = await createInventoryRepository().getPlannerCatalog();
      const originSuggestions = catalog.locationGraph
        .filter((location) => location.type === "city" && location.name)
        .sort((left, right) => left.name!.localeCompare(right.name!))
        .slice(0, 4)
        .map((location) => ({ id: location.id, label: location.name! }));
      const operationId = `intake:${Date.now()}`;
      const presentation = intakePresentation(result, operationId, originSuggestions);
      const communication = await composeCommunication(
        {
          intent: "clarify",
          userMessage: parsed.data.message,
          fallbackMessage: presentation.message,
          facts: result.appliedFields.map((field) => `${field} was extracted from the user's message`),
          events: presentation.events,
          availableActions: presentation.actions,
        },
        model && apiKey
          ? createOpenAICommunicationModel({ model, apiKey, timeoutMs: 2_500 })
          : undefined,
      );
      return NextResponse.json({
        kind: "intake",
        result,
        interaction: applyCommunication(presentation, communication),
      });
    }

    const deterministicIntent = /\b(?:why|explain|how much|what|when|where|reason|breakdown)\b/i.test(parsed.data.message) &&
      !/\b(?:change|replace|remove|add|cheaper|lock|unlock|update|make)\b/i.test(parsed.data.message)
      ? "explain_trip" as const
      : "modify_trip" as const;
    const intent = parsed.data.actionHint ?? deterministicIntent;

    if (intent === "explain_trip") {
      const result = await runExplanation(
        {
          question: parsed.data.message,
          trip: parsed.data.trip,
          selectionId: parsed.data.selectionId,
        },
        {
          model: model && apiKey
            ? createOpenAIExplanationModel({ model, apiKey })
            : undefined,
        },
      );
      return NextResponse.json({ kind: "explanation", result });
    }

    const result = await runModification(
      {
        message: parsed.data.message,
        trip: parsed.data.trip,
        targetDate: parsed.data.targetDate,
      },
      {
        model: model && apiKey
          ? createOpenAIModificationModel({ model, apiKey })
          : createDeterministicModificationModel(),
      },
    );
    return NextResponse.json({ kind: "modification", result });
  } catch (error: unknown) {
    if (
      error instanceof NaturalIntakeError ||
      error instanceof ModifyError ||
      error instanceof ExplainError
    ) {
      return NextResponse.json(
        { code: error.code, message: error.message, retryable: error.retryable },
        { status: error.status },
      );
    }
    console.error("Conversation request failed", error);
    return NextResponse.json(
      {
        code: "INTERNAL_ERROR",
        message: "The travel assistant could not complete that request",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
