import { handleLiveConversation, handleLiveSelection } from "@/live/handler.server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  if (body?.phase === "live") return handleLiveConversation(body, request);
  if (body?.phase === "live-selection") return handleLiveSelection(body, request);
  return Response.json({ message: "Unsupported planning request." }, { status: 400 });
}
