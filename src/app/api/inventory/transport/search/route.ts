import { NextResponse, type NextRequest } from "next/server";
import {
  databaseFailureSchema,
  requestValidationErrorSchema,
  transportSearchRequestSchema,
  transportSearchResponseSchema,
} from "@/inventory/contracts";
import { createInventoryRepository } from "@/inventory/repository";
import { searchTransport } from "@/inventory/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsedRequest = transportSearchRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      requestValidationErrorSchema.parse({
        code: "INVALID_REQUEST",
        message: parsedRequest.error.issues[0]?.message ?? "Invalid transport search request",
        retryable: false,
      }),
      { status: 400 },
    );
  }

  try {
    const response = await searchTransport(parsedRequest.data, createInventoryRepository());
    return NextResponse.json(transportSearchResponseSchema.parse(response));
  } catch (error: unknown) {
    console.error("Transport inventory search failed", error);
    return NextResponse.json(
      databaseFailureSchema.parse({
        code: "DATABASE_FAILURE",
        message: "Transport inventory is temporarily unavailable",
        retryable: true,
      }),
      { status: 503 },
    );
  }
}
