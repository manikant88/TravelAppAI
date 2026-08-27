import { NextResponse, type NextRequest } from "next/server";
import {
  commitProposal,
  ProposalServiceError,
} from "@/domain/proposal-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  try {
    return NextResponse.json(await commitProposal(body));
  } catch (error: unknown) {
    if (error instanceof ProposalServiceError) {
      return NextResponse.json(
        { code: error.code, message: error.message, retryable: false },
        { status: error.status },
      );
    }
    console.error("Proposal application failed", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "The proposal could not be applied", retryable: true },
      { status: 500 },
    );
  }
}
