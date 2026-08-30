import { NextResponse, type NextRequest } from "next/server";
import {
  DestinationDiscoveryError,
  runDestinationDiscovery,
} from "@/agent/discovery";
import {
  createOpenAIDestinationDiscoveryModel,
} from "@/agent/model";
import { generateAssistantMessage } from "@/agent/assistant-message.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const modelName = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  try {
    const result = await runDestinationDiscovery(body, {
      model: modelName && apiKey
        ? createOpenAIDestinationDiscoveryModel({ model: modelName, apiKey, timeoutMs: 2_500 })
        : undefined,
    });
    const recommendationExplanation = result.type === "destination_options"
      ? result.recommendationExplanation
      : undefined;
    const fallbackMessage = recommendationExplanation
      ? `${result.message} ${recommendationExplanation}`
      : result.message;
    const message = await generateAssistantMessage(fallbackMessage, {
        intent: result.type === "destination_options" ? "plan_trip" : "recover",
        facts: [result.message, ...(recommendationExplanation ? [recommendationExplanation] : [])],
        events: [],
        availableActions: [],
      });
    return NextResponse.json(
      { ...result, message, recommendationExplanation: undefined },
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
