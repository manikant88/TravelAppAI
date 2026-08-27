import { NextResponse, type NextRequest } from "next/server";
import {
  DestinationDiscoveryError,
  runDestinationDiscovery,
} from "@/agent/discovery";
import { createOpenAIDestinationDiscoveryModel } from "@/agent/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const modelName = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!modelName || !apiKey) {
    return NextResponse.json(
      {
        code: "CONFIGURATION_ERROR",
        message: "The travel planner model is not configured",
        retryable: false,
      },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(
      await runDestinationDiscovery(body, {
        model: createOpenAIDestinationDiscoveryModel({ model: modelName, apiKey }),
      }),
    );
  } catch (error: unknown) {
    if (error instanceof DestinationDiscoveryError) {
      return NextResponse.json(
        { code: error.code, message: error.message, retryable: error.retryable },
        { status: error.status },
      );
    }
    console.error("Destination discovery request failed", error);
    return NextResponse.json(
      {
        code: "INTERNAL_ERROR",
        message: "Destination discovery could not complete",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
