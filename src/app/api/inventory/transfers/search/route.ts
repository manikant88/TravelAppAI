import { NextResponse, type NextRequest } from "next/server";
import {
  databaseFailureSchema,
  requestValidationErrorSchema,
  transferSearchRequestSchema,
  transferSearchResponseSchema,
} from "@/inventory/contracts";
import { createInventoryRepository } from "@/inventory/repository";
import { searchTransfers } from "@/inventory/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsedRequest = transferSearchRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    return NextResponse.json(
      requestValidationErrorSchema.parse({
        code: "INVALID_REQUEST",
        message: parsedRequest.error.issues[0]?.message ?? "Invalid transfer search request",
        retryable: false,
      }),
      { status: 400 },
    );
  }

  try {
    const response = await searchTransfers(parsedRequest.data, createInventoryRepository());
    return NextResponse.json(transferSearchResponseSchema.parse(response));
  } catch (error: unknown) {
    console.error("Transfer inventory search failed", error);
    return NextResponse.json(
      databaseFailureSchema.parse({
        code: "DATABASE_FAILURE",
        message: "Transfer inventory is temporarily unavailable",
        retryable: true,
      }),
      { status: 503 },
    );
  }
}
