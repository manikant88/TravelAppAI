import { z } from "zod";
import { finalizeGroupRoomSnapshot } from "@/collaboration/store";
import type { PublicGroupRoom } from "@/collaboration/model";

export const runtime = "nodejs";

const requestSchema = z.object({ room: z.unknown() }).strict();

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ message: "Invalid shared itinerary" }, { status: 400 });
    return Response.json(await finalizeGroupRoomSnapshot(parsed.data.room as PublicGroupRoom));
  } catch (error: unknown) {
    return Response.json({ message: error instanceof Error ? error.message : "The trip could not be finalized" }, { status: 422 });
  }
}
