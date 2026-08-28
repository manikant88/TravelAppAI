import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { runNaturalIntake, NaturalIntakeError } from "@/agent/natural-intake";
import { runModification, ModifyError } from "@/agent/modify";
import { runExplanation, ExplainError } from "@/agent/explain";
import {
  createOpenAIConversationRouterModel,
  createOpenAIExplanationModel,
  createOpenAIModificationModel,
  createOpenAINaturalIntakeModel,
} from "@/agent/model";
import { tripRequestSchema } from "@/domain/request";
import { tripStateSchema } from "@/domain/trip";
import type { TripState } from "@/domain/model";

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
  if (!model || !apiKey) {
    return NextResponse.json(
      {
        code: "CONFIGURATION_ERROR",
        message: "The travel planner model is not configured",
        retryable: false,
      },
      { status: 503 },
    );
  }

  try {
    if (parsed.data.phase === "draft") {
      const result = await runNaturalIntake(
        {
          message: parsed.data.message,
          currentRequest: parsed.data.currentRequest,
        },
        { model: createOpenAINaturalIntakeModel({ model, apiKey }) },
      );
      return NextResponse.json({ kind: "intake", result });
    }

    const intent = parsed.data.actionHint ?? (
      await createOpenAIConversationRouterModel({ model, apiKey }).classify({
        message: parsed.data.message,
        trip: parsed.data.trip as TripState,
      })
    ).intent;

    if (intent === "explain_trip") {
      const result = await runExplanation(
        {
          question: parsed.data.message,
          trip: parsed.data.trip,
          selectionId: parsed.data.selectionId,
        },
        { model: createOpenAIExplanationModel({ model, apiKey }) },
      );
      return NextResponse.json({ kind: "explanation", result });
    }

    const result = await runModification(
      {
        message: parsed.data.message,
        trip: parsed.data.trip,
        targetDate: parsed.data.targetDate,
      },
      { model: createOpenAIModificationModel({ model, apiKey }) },
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
