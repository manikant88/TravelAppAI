import { randomUUID } from "node:crypto";

export interface ConversationTraceSummary {
  traceId: string;
  degraded: boolean;
}

export class ConversationTurnTrace {
  readonly traceId = `conversation:${randomUUID()}`;
  private readonly startedAt = Date.now();
  private route?: string;
  private executor?: string;
  private degraded = false;

  constructor(
    private readonly clientTurnId: string,
    private readonly phase: "draft" | "committed",
  ) {}

  routed(route: string, degraded = false): void {
    this.route = route;
    this.degraded ||= degraded;
  }

  executed(executor: string): void {
    this.executor = executor;
  }

  complete(outcome: string): ConversationTraceSummary {
    console.info("Conversation turn completed", {
      traceId: this.traceId,
      clientTurnId: this.clientTurnId,
      phase: this.phase,
      route: this.route,
      executor: this.executor,
      outcome,
      degraded: this.degraded,
      durationMs: Date.now() - this.startedAt,
    });
    return { traceId: this.traceId, degraded: this.degraded };
  }

  failed(error: unknown): void {
    console.error("Conversation turn failed", {
      traceId: this.traceId,
      clientTurnId: this.clientTurnId,
      phase: this.phase,
      route: this.route,
      executor: this.executor,
      degraded: this.degraded,
      durationMs: Date.now() - this.startedAt,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
