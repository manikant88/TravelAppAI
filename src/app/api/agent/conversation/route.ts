import { NextResponse, type NextRequest } from "next/server";
import { NaturalIntakeError } from "@/agent/natural-intake";
import { ModifyError } from "@/agent/modify";
import { ExplainError } from "@/agent/explain";
import { conversationRequestSchema } from "@/agent/conversation-contracts";
import { runConversationTurn } from "@/agent/conversation-orchestrator.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsed = conversationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "INVALID_REQUEST",
        message: parsed.error.issues[0]?.message ?? "Invalid conversation request",
        retryable: false,
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await runConversationTurn(parsed.data));
  } catch (error: unknown) {
    if (
      error instanceof NaturalIntakeError ||
      error instanceof ModifyError ||
      error instanceof ExplainError
    ) {
      return NextResponse.json(
        { code: error.code, message: error.message, retryable: error.retryable },
        { status: error.status },
      );
    }
    console.error("Conversation request failed", error);
    return NextResponse.json(
      {
        code: "INTERNAL_ERROR",
        message: "The travel assistant could not complete that request",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
