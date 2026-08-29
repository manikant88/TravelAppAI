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
  createOpenAITravelContextModel,
} from "@/agent/model";
import { tripRequestSchema } from "@/domain/request";
import { tripStateSchema } from "@/domain/trip";
import { createDeterministicModificationModel } from "@/agent/deterministic-modification";
import { createInventoryRepository } from "@/inventory/repository";
import { intakePresentation } from "@/agent/interaction-guidance";
import { applyCommunication, composeCommunication } from "@/agent/communication";
import { classifyCommittedConversation, contextualizedMessage } from "@/agent/conversation-routing";

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
    conversationHistory: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().trim().min(1).max(800),
    }).strict()).max(8).optional(),
  })
  .strict();

const conversationRequestSchema = z.discriminatedUnion("phase", [
  draftConversationSchema,
  committedConversationSchema,
]);

function suggestedActivityDay(trip: z.infer<typeof tripStateSchema>, message: string): number {
  const explicit = Number(message.match(/\bday\s*(\d+)\b/i)?.[1]);
  const days = Math.round((Date.parse(`${trip.request.endDate}T12:00:00Z`) - Date.parse(`${trip.request.startDate}T12:00:00Z`)) / 86_400_000) + 1;
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= days) return explicit;
  const counts = new Map<number, number>();
  for (const activity of trip.selectedActivities) {
    const day = Math.round((Date.parse(`${activity.date}T12:00:00Z`) - Date.parse(`${trip.request.startDate}T12:00:00Z`)) / 86_400_000) + 1;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const candidates = Array.from({ length: days }, (_, index) => index + 1)
    .filter((day) => days <= 2 || (day > 1 && day < days));
  return candidates.sort((left, right) => (counts.get(left) ?? 0) - (counts.get(right) ?? 0) || left - right)[0] ?? 1;
}

function contextLabel(locationId: string): string {
  const value = locationId.split(":").at(-1) ?? locationId;
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
        model && apiKey && result.missingRequired.length === 0
          ? createOpenAICommunicationModel({ model, apiKey, timeoutMs: 2_500 })
          : undefined,
      );
      return NextResponse.json({
        kind: "intake",
        result,
        interaction: applyCommunication(presentation, communication),
      });
    }

    const effectiveMessage = contextualizedMessage(parsed.data.message, parsed.data.conversationHistory);
    const intent = parsed.data.actionHint ?? classifyCommittedConversation(effectiveMessage, parsed.data.trip);

    if (intent === "activity_suggestion") {
      const day = suggestedActivityDay(parsed.data.trip, effectiveMessage);
      const themes = /\b(?:food|eat|restaurant|cafe|market)\b/i.test(effectiveMessage) ? " food market" : "";
      const result = await runModification(
        {
          message: `Add 1 activity on day ${day}${themes}. Suggest grounded options and preserve the current itinerary.`,
          trip: parsed.data.trip,
        },
        { model: createDeterministicModificationModel() },
      );
      return NextResponse.json({ kind: "suggestion", result });
    }

    if (/^(?:hi|hello|hey|thanks|thank you|help|what can you do)[!.?\s]*$/i.test(effectiveMessage)) {
      return NextResponse.json({
        kind: "reply",
        message: "I can explain any current choice, compare the trip total, or suggest schedule-valid activities near your stay. Ask about a day or an itinerary card whenever you like.",
      });
    }

    if (intent === "travel_context") {
      const fallback = /\b(?:weather|forecast|temperature|rain)\b/i.test(effectiveMessage)
        ? "I can’t check live weather in this prototype. Please check a current forecast closer to travel; I can still help adjust the itinerary around the conditions you expect."
        : "I can help with itinerary facts and grounded options, but I can’t verify that extra place information right now.";
      if (!model || !apiKey) return NextResponse.json({ kind: "reply", message: fallback });
      try {
        const answer = await createOpenAITravelContextModel({ model, apiKey, timeoutMs: 2_500 }).answer({
          question: effectiveMessage,
          origin: contextLabel(parsed.data.trip.request.origin),
          destination: contextLabel(parsed.data.trip.route.marketId),
          routeStops: parsed.data.trip.route.stops.map((stop) => contextLabel(stop.locationId)),
          startDate: parsed.data.trip.request.startDate,
          endDate: parsed.data.trip.request.endDate,
        });
        return NextResponse.json({ kind: "reply", message: answer });
      } catch {
        return NextResponse.json({ kind: "reply", message: fallback });
      }
    }

    if (intent === "unsupported") {
      return NextResponse.json({
        kind: "reply",
        message: "I’m sorry, I can’t help with that request right now. I can help with this trip’s route, travel, stays, activities, schedule, and cost.",
      });
    }

    if (intent === "explain_trip") {
      const result = await runExplanation(
        {
          question: effectiveMessage,
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
        message: effectiveMessage,
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
