import { NextResponse, type NextRequest } from "next/server";
import { runModification, ModifyError } from "@/agent/modify";
import { createOpenAIModificationModel } from "@/agent/model";
import { getOpenAIModelConfig } from "@/agent/openai-config.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const config = getOpenAIModelConfig("planning");
  try {
    return NextResponse.json(
      await runModification(body, {
        model: config
          ? createOpenAIModificationModel(config)
          : undefined,
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
