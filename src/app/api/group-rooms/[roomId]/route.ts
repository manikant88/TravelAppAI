import { roomActionSchema } from "@/collaboration/model";
import {
  castGroupVote,
  finalizeGroupRoom,
  getGroupRoom,
  joinGroupRoom,
  recommendGroupCandidate,
} from "@/collaboration/store";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The group trip could not be updated";
  const status = /unavailable/i.test(message) ? 404
    : /only the organizer|join the trip/i.test(message) ? 403
      : /changed|already|closed/i.test(message) ? 409
        : 422;
  return Response.json({ message }, { status });
}

export async function GET(request: Request, context: RouteContext<"/api/group-rooms/[roomId]">) {
  try {
    const { roomId } = await context.params;
    const url = new URL(request.url);
    return Response.json(getGroupRoom(
      roomId,
      url.searchParams.get("participantToken") ?? undefined,
      url.searchParams.get("organizerToken") ?? undefined,
    ));
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext<"/api/group-rooms/[roomId]">) {
  try {
    const { roomId } = await context.params;
    const parsed = roomActionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid room action" }, { status: 400 });
    }
    const action = parsed.data;
    if (action.action === "join") return Response.json(joinGroupRoom(roomId, action.displayName), { status: 201 });
    if (action.action === "vote") return Response.json(castGroupVote(roomId, action.participantToken, action.decisionId, action.candidateId));
    if (action.action === "recommend") return Response.json(await recommendGroupCandidate(roomId, action.participantToken, action.decisionId, action.offerId));
    return Response.json(await finalizeGroupRoom(roomId, action.organizerToken));
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
