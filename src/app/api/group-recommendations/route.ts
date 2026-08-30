import { z } from "zod";
import { prepareGroupRecommendation } from "@/collaboration/store";
import type { PublicGroupRoom } from "@/collaboration/model";

export const runtime = "nodejs";

const requestSchema = z.object({
  room: z.unknown(),
  participantId: z.string().trim().min(1).max(240),
  offerId: z.string().trim().min(1).max(240),
  decisionId: z.string().trim().min(1).max(240).optional(),
  date: z.string().date().optional(),
  locationId: z.string().trim().min(1).max(240).optional(),
  addActivity: z.literal(true).optional(),
}).strict().refine((value) => Boolean(value.decisionId || (value.date && value.locationId) || value.addActivity), {
  message: "A voting choice or itinerary day is required",
});

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ message: parsed.error.issues[0]?.message ?? "Invalid recommendation" }, { status: 400 });
    const { room, participantId, offerId, decisionId, date, locationId, addActivity } = parsed.data;
    const target = decisionId ? { decisionId } : addActivity ? { addActivity: true as const } : { date: date!, locationId: locationId! };
    return Response.json(await prepareGroupRecommendation(room as PublicGroupRoom, participantId, offerId, target));
  } catch (error: unknown) {
    return Response.json({ message: error instanceof Error ? error.message : "The recommendation could not be prepared" }, { status: 422 });
  }
}
