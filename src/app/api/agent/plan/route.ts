import { NextResponse, type NextRequest } from "next/server";
import { createOpenAIPlannerModel } from "@/agent/model";
import { createDeterministicPlannerModel } from "@/agent/deterministic-planner";
import {
  runSpecifiedPlanApi,
  SpecifiedPlanApiError,
} from "@/agent/plan-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const modelName = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const deterministicModel = createDeterministicPlannerModel();
  const hasModelConfiguration = Boolean(modelName && apiKey);

  try {
    const result = await runSpecifiedPlanApi(body, {
      model: hasModelConfiguration
        ? createOpenAIPlannerModel({ model: modelName!, apiKey: apiKey! })
        : deterministicModel,
      fallbackModel: hasModelConfiguration ? deterministicModel : undefined,
      modelMode: hasModelConfiguration ? "ai" : "deterministic_fallback",
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof SpecifiedPlanApiError) {
      return NextResponse.json(
        {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
        { status: error.status },
      );
    }
    console.error("Specified PLAN request failed", error);
    return NextResponse.json(
      {
        code: "INTERNAL_ERROR",
        message: "The travel planner could not complete the request",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
