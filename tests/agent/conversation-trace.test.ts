import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationTurnTrace } from "@/agent/conversation-trace.server";

describe("conversation turn tracing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("correlates the client turn, route, executor, outcome, and degraded state", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const trace = new ConversationTurnTrace("client:one", "committed");
    trace.routed("modify_trip", true);
    trace.executed("runModification");
    const summary = trace.complete("modification");

    expect(summary.traceId).toMatch(/^conversation:/);
    expect(summary.degraded).toBe(true);
    expect(info).toHaveBeenCalledWith("Conversation turn completed", expect.objectContaining({
      clientTurnId: "client:one",
      phase: "committed",
      route: "modify_trip",
      executor: "runModification",
      outcome: "modification",
      degraded: true,
    }));
  });
});
