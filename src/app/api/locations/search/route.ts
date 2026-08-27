import { NextResponse, type NextRequest } from "next/server";
import {
  databaseFailureSchema,
  locationSearchQuerySchema,
  locationSearchResponseSchema,
  requestValidationErrorSchema,
} from "@/inventory/contracts";
import { createInventoryRepository } from "@/inventory/repository";
import { searchLocations } from "@/inventory/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const parsedQuery = locationSearchQuerySchema.safeParse({
    q: request.nextUrl.searchParams.get("q"),
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      requestValidationErrorSchema.parse({
        code: "INVALID_REQUEST",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid location query",
        retryable: false,
      }),
      { status: 400 },
    );
  }

  try {
    const response = await searchLocations(parsedQuery.data, createInventoryRepository());
    return NextResponse.json(locationSearchResponseSchema.parse(response));
  } catch (error: unknown) {
    console.error("Location inventory search failed", error);
    return NextResponse.json(
      databaseFailureSchema.parse({
        code: "DATABASE_FAILURE",
        message: "Location inventory is temporarily unavailable",
        retryable: true,
      }),
      { status: 503 },
    );
  }
}
