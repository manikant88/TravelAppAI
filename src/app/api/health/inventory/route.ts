import { NextResponse } from "next/server";
import { checkInventoryReadiness } from "@/db/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await checkInventoryReadiness(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.error("Inventory readiness check failed", error);
    return NextResponse.json(
      {
        status: "unavailable",
        code: "DATABASE_FAILURE",
        message: "Travel inventory is still waking up",
        retryable: true,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
