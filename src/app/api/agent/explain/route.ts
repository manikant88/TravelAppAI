import { NextResponse, type NextRequest } from "next/server";
import { ExplainError, runExplanation } from "@/agent/explain";
import { createOpenAIExplanationModel } from "@/agent/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const modelName = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  try {
    return NextResponse.json(
      await runExplanation(body, {
        model:
          modelName && apiKey
            ? createOpenAIExplanationModel({ model: modelName, apiKey })
            : undefined,
      }),
    );
  } catch (error: unknown) {
    if (error instanceof ExplainError) {
      return NextResponse.json(
        { code: error.code, message: error.message, retryable: error.retryable },
        { status: error.status },
      );
    }
    console.error("EXPLAIN request failed", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "The trip could not be explained", retryable: true },
      { status: 500 },
    );
  }
}
