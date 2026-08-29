import { NextResponse, type NextRequest } from "next/server";
import { NaturalIntakeError, runNaturalIntake } from "@/agent/natural-intake";
import { createOpenAINaturalIntakeModel } from "@/agent/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const modelName = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  try {
    return NextResponse.json(
      await runNaturalIntake(body, {
        model: modelName && apiKey
          ? createOpenAINaturalIntakeModel({ model: modelName, apiKey })
          : undefined,
      }),
    );
  } catch (error: unknown) {
    if (error instanceof NaturalIntakeError) {
      return NextResponse.json(
        { code: error.code, message: error.message, retryable: error.retryable },
        { status: error.status },
      );
    }
    console.error("Natural-language intake failed", error);
    return NextResponse.json(
      {
        code: "INTERNAL_ERROR",
        message: "The travel planner could not interpret that trip brief",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
