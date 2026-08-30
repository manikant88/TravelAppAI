import { createRoomSchema } from "@/collaboration/model";
import { createGroupRoom } from "@/collaboration/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = createRoomSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid shared trip" }, { status: 400 });
    }
    return Response.json(createGroupRoom(parsed.data.trip, parsed.data.projection), { status: 201 });
  } catch (error: unknown) {
    return Response.json({ message: error instanceof Error ? error.message : "The trip room could not be created" }, { status: 422 });
  }
}
