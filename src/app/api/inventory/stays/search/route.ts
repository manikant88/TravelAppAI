import { NextResponse, type NextRequest } from "next/server";
import {
  databaseFailureSchema,
  requestValidationErrorSchema,
  staySearchRequestSchema,
  staySearchResponseSchema,
} from "@/inventory/contracts";
import { createInventoryRepository } from "@/inventory/repository";
import { searchStays } from "@/inventory/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsedRequest = staySearchRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      requestValidationErrorSchema.parse({
        code: "INVALID_REQUEST",
        message: parsedRequest.error.issues[0]?.message ?? "Invalid stay search request",
        retryable: false,
      }),
      { status: 400 },
    );
  }

  try {
    const response = await searchStays(parsedRequest.data, createInventoryRepository());
    return NextResponse.json(staySearchResponseSchema.parse(response));
  } catch (error: unknown) {
    console.error("Stay inventory search failed", error);
    return NextResponse.json(
      databaseFailureSchema.parse({
        code: "DATABASE_FAILURE",
        message: "Stay inventory is temporarily unavailable",
        retryable: true,
      }),
      { status: 503 },
    );
  }
}
