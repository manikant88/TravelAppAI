import { NextResponse, type NextRequest } from "next/server";
import { composeCommunication } from "@/agent/communication";
import { communicationContextSchema } from "@/agent/interaction-contracts";
import { createOpenAICommunicationModel } from "@/agent/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const parsed = communicationContextSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid communication context" }, { status: 400 });
  }
  const modelName = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const result = await composeCommunication(
    parsed.data,
    modelName && apiKey
      ? createOpenAICommunicationModel({ model: modelName, apiKey, timeoutMs: 2_500 })
      : undefined,
  );
  return NextResponse.json(result);
}
