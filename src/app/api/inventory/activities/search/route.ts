import { NextResponse, type NextRequest } from "next/server";
import {
  activitySearchRequestSchema,
  activitySearchResponseSchema,
  databaseFailureSchema,
  requestValidationErrorSchema,
} from "@/inventory/contracts";
import { createInventoryRepository } from "@/inventory/repository";
import { searchActivities } from "@/inventory/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsedRequest = activitySearchRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      requestValidationErrorSchema.parse({
        code: "INVALID_REQUEST",
        message: parsedRequest.error.issues[0]?.message ?? "Invalid activity search request",
        retryable: false,
      }),
      { status: 400 },
    );
  }

  try {
    const response = await searchActivities(parsedRequest.data, createInventoryRepository());
    return NextResponse.json(activitySearchResponseSchema.parse(response));
  } catch (error: unknown) {
    console.error("Activity inventory search failed", error);
    return NextResponse.json(
      databaseFailureSchema.parse({
        code: "DATABASE_FAILURE",
        message: "Activity inventory is temporarily unavailable",
        retryable: true,
      }),
      { status: 503 },
    );
  }
}
