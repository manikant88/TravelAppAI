import { describe, expect, it } from "vitest";
import {
  createOpenAIClientRequestId,
  getOpenAIModelConfig,
  resolveOpenAIReasoningEffort,
  resolveOpenAITimeoutMs,
} from "@/agent/openai-config.server";

describe("live planner OpenAI configuration", () => {
  it("uses bounded planning defaults and deployment overrides", () => {
    expect(resolveOpenAITimeoutMs({})).toBe(30_000);
    expect(resolveOpenAITimeoutMs({ OPENAI_TIMEOUT_MS: "18000", OPENAI_PLANNING_TIMEOUT_MS: "9000" })).toBe(9_000);
    expect(resolveOpenAITimeoutMs({ OPENAI_PLANNING_TIMEOUT_MS: "999999" })).toBe(30_000);
    expect(resolveOpenAIReasoningEffort({})).toBe("low");
    expect(resolveOpenAIReasoningEffort({ OPENAI_REASONING_EFFORT: "medium" })).toBe("medium");
    expect(resolveOpenAIReasoningEffort({ OPENAI_PLANNING_REASONING_EFFORT: "unsupported" })).toBe("low");
  });

  it("returns a complete server configuration only with both credentials", () => {
    expect(getOpenAIModelConfig({ OPENAI_MODEL: "gpt-test", OPENAI_API_KEY: "secret" })).toEqual({
      model: "gpt-test",
      apiKey: "secret",
      timeoutMs: 30_000,
      reasoningEffort: "low",
    });
    expect(getOpenAIModelConfig({ OPENAI_MODEL: "gpt-test" })).toBeUndefined();
    expect(getOpenAIModelConfig({ OPENAI_API_KEY: "secret" })).toBeUndefined();
  });

  it("creates unique ASCII client request IDs with a diagnostic schema prefix", () => {
    const first = createOpenAIClientRequestId("travel interaction/copy");
    const second = createOpenAIClientRequestId("travel interaction/copy");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^travel-travel-interaction-copy-[A-Za-z0-9-]+$/);
  });
});
