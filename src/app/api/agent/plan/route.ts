import { NextResponse, type NextRequest } from "next/server";
import { createDeterministicPlannerModel } from "@/agent/deterministic-planner";
import {
  runSpecifiedPlanApi,
  SpecifiedPlanApiError,
} from "@/agent/plan-api";
import { generateAssistantMessage } from "@/agent/assistant-message.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const deterministicModel = createDeterministicPlannerModel();

  try {
    const result = await runSpecifiedPlanApi(body, {
      // Canonical trip construction is deliberately deterministic. Models may
      // rank complete valid variants in a later bounded step, but they never
      // create selections, prices, schedules, or state mutations.
      model: deterministicModel,
      modelMode: "deterministic_fallback",
    });
    const communicationFacts = result.type === "conflict"
      ? result.factBundle.facts.slice(0, 12).map((fact) =>
          `${fact.label}: ${typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}`,
        )
      : [result.message];
    const message = await generateAssistantMessage(result.message, {
        intent: result.type === "trip_ready" ? "plan_trip" : "recover",
        facts: communicationFacts,
        events: [],
        availableActions: [],
      });
    return NextResponse.json({ ...result, message });
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
