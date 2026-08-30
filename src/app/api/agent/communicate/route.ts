import { NextResponse, type NextRequest } from "next/server";
import { communicationContextSchema } from "@/agent/interaction-contracts";
import { generateAssistantCommunication } from "@/agent/assistant-message.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsed = communicationContextSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid communication context" }, { status: 400 });
  }
  const result = await generateAssistantCommunication(parsed.data);
  return NextResponse.json(result);
}
