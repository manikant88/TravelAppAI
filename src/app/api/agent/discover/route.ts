import { NextResponse, type NextRequest } from "next/server";
import {
  DestinationDiscoveryError,
  runDestinationDiscovery,
} from "@/agent/discovery";
import {
  createOpenAIDestinationDiscoveryModel,
} from "@/agent/model";
import { generateAssistantMessage } from "@/agent/assistant-message.server";
import { getOpenAIModelConfig } from "@/agent/openai-config.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const config = getOpenAIModelConfig("discovery");
  try {
    const result = await runDestinationDiscovery(body, {
      model: config
        ? createOpenAIDestinationDiscoveryModel(config)
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
