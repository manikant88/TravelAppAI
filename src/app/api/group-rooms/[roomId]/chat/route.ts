import { z } from "zod";
import { composeCommunication } from "@/agent/communication";
import { createDeterministicModificationModel } from "@/agent/deterministic-modification";
import { runExplanation } from "@/agent/explain";
import { createOpenAICommunicationModel, createOpenAIExplanationModel, createOpenAIModificationModel } from "@/agent/model";
import { runModification } from "@/agent/modify";
import { decisionResult } from "@/collaboration/model";
import { getGroupRoom } from "@/collaboration/store";
import type { PublicGroupRoom } from "@/collaboration/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(800),
  participantToken: z.string().trim().min(1).optional(),
  organizerToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  room: z.unknown().optional(),
  conversationHistory: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(800) }).strict()).max(8).optional(),
}).strict();

function selectionForMessage(message: string, room: PublicGroupRoom): string | undefined {
  const kind = /\b(?:hotel|stay|room|accommodation)\b/i.test(message) ? "stay"
    : /\b(?:flight|train|bus|travel|transport)\b/i.test(message) ? "travel"
      : /\b(?:activit(?:y|ies)|experience|tour)\b/i.test(message) ? "activity"
        : undefined;
  const decisions = kind ? room.decisions.filter((decision) => decision.kind === kind) : [];
  return decisions.length === 1 ? decisions[0]?.selectionId : undefined;
}

export async function POST(request: Request, context: RouteContext<"/api/group-rooms/[roomId]/chat">) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid chat request" }, { status: 400 });
    const { roomId } = await context.params;
    const room = parsed.data.room
      ? parsed.data.room as PublicGroupRoom
      : getGroupRoom(roomId, parsed.data.participantToken, parsed.data.organizerToken);
    const participantId = parsed.data.participantId ?? room.viewer?.participantId;
    if (!participantId && !room.viewer?.organizer) return Response.json({ message: "Join the trip before using its AI assistant" }, { status: 403 });

    const modelName = process.env.OPENAI_MODEL?.trim();
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const message = parsed.data.message;

    if (/\b(?:vote|votes|voting|leading|leader|tie|tied|group choice|group choices)\b/i.test(message)) {
      const summaries = room.decisions.map((decision) => {
        const result = decisionResult(room, decision.id);
        const leader = decision.candidates.find((candidate) => candidate.id === result.leaderCandidateId)?.summary.title;
        return result.tied
          ? `${decision.label}: tied at ${result.highestVoteCount} votes with ${result.totalVotes} total votes`
          : `${decision.label}: ${leader ?? "no leader yet"}, ${result.highestVoteCount} leading votes, ${result.totalVotes} total votes`;
      });
      const tiedCount = room.decisions.filter((decision) => decisionResult(room, decision.id).tied).length;
      const fallback = tiedCount
        ? `${tiedCount} group decision${tiedCount === 1 ? " is" : "s are"} tied. Review the highlighted choice groups before finalizing.`
        : `There are no tied decisions. Each leading option is marked directly in the itinerary; decisions with no votes keep the current itinerary choice.`;
      const output = await composeCommunication({ intent: "explain", userMessage: message, fallbackMessage: fallback, facts: summaries, events: [], availableActions: [] }, modelName && apiKey ? createOpenAICommunicationModel({ model: modelName, apiKey, timeoutMs: 2_500 }) : undefined);
      return Response.json({ kind: "reply", message: output.message });
    }

    if (/\b(?:find|recommend|suggest|cheaper|later|earlier|alternative|replace|change)\b/i.test(message)) {
      const result = await runModification({ message, trip: room.trip }, { model: modelName && apiKey ? createOpenAIModificationModel({ model: modelName, apiKey }) : createDeterministicModificationModel() });
      return Response.json({ kind: "modification", result });
    }

    const result = await runExplanation({ question: message, trip: room.trip, selectionId: selectionForMessage(message, room) }, { model: modelName && apiKey ? createOpenAIExplanationModel({ model: modelName, apiKey }) : undefined });
    return Response.json({ kind: "explanation", result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "The group assistant could not complete that request";
    return Response.json({ message }, { status: /Join the trip/i.test(message) ? 403 : 422 });
  }
}
