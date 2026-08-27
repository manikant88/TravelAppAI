import { NextResponse, type NextRequest } from "next/server";
import { runModification, ModifyError } from "@/agent/modify";
import { createOpenAIModificationModel } from "@/agent/model";

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
      await runModification(body, {
        model: createOpenAIModificationModel({ model: modelName, apiKey }),
      }),
    );
  } catch (error: unknown) {
    if (error instanceof ModifyError) {
      return NextResponse.json(
        { code: error.code, message: error.message, retryable: error.retryable },
        { status: error.status },
      );
    }
    console.error("MODIFY request failed", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "The trip could not be modified", retryable: true },
      { status: 500 },
    );
  }
}
