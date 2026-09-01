import { describe, expect, it } from "vitest";
import {
  createOpenAIClientRequestId,
  getOpenAIModelConfig,
  resolveOpenAIReasoningEffort,
  resolveOpenAITimeoutMs,
} from "@/agent/openai-config.server";

describe("central OpenAI configuration", () => {
  it("uses the recommended timeout for each request kind", () => {
    const environment = {};
    expect(resolveOpenAITimeoutMs("communication", environment)).toBe(20_000);
    expect(resolveOpenAITimeoutMs("context", environment)).toBe(20_000);
    expect(resolveOpenAITimeoutMs("discovery", environment)).toBe(25_000);
    expect(resolveOpenAITimeoutMs("planning", environment)).toBe(30_000);
  });

  it("lets a request-specific timeout override the global timeout", () => {
    const environment = {
      OPENAI_TIMEOUT_MS: "18000",
      OPENAI_COMMUNICATION_TIMEOUT_MS: "9000",
    };
    expect(resolveOpenAITimeoutMs("communication", environment)).toBe(9_000);
    expect(resolveOpenAITimeoutMs("planning", environment)).toBe(18_000);
  });

  it("uses shallow reasoning for latency-sensitive requests", () => {
    expect(resolveOpenAIReasoningEffort("communication", {})).toBe("minimal");
    expect(resolveOpenAIReasoningEffort("context", {})).toBe("minimal");
    expect(resolveOpenAIReasoningEffort("discovery", {})).toBe("low");
    expect(resolveOpenAIReasoningEffort("planning", {})).toBe("low");
  });

  it("lets a request-specific reasoning effort override the global effort", () => {
    const environment = {
      OPENAI_REASONING_EFFORT: "medium",
      OPENAI_COMMUNICATION_REASONING_EFFORT: "minimal",
    };
    expect(resolveOpenAIReasoningEffort("communication", environment)).toBe("minimal");
    expect(resolveOpenAIReasoningEffort("planning", environment)).toBe("medium");
    expect(resolveOpenAIReasoningEffort("planning", {
      OPENAI_PLANNING_REASONING_EFFORT: "unsupported",
    })).toBe("low");
  });

  it("ignores invalid or unsafe timeout values", () => {
    expect(resolveOpenAITimeoutMs("communication", {
      OPENAI_COMMUNICATION_TIMEOUT_MS: "250.5",
      OPENAI_TIMEOUT_MS: "not-a-number",
    })).toBe(20_000);
    expect(resolveOpenAITimeoutMs("planning", {
      OPENAI_PLANNING_TIMEOUT_MS: "999999",
    })).toBe(30_000);
  });

  it("returns a complete server configuration only with both credentials", () => {
    expect(getOpenAIModelConfig("planning", {
      OPENAI_MODEL: "gpt-test",
      OPENAI_API_KEY: "secret",
    })).toEqual({
      model: "gpt-test",
      apiKey: "secret",
      timeoutMs: 30_000,
      reasoningEffort: "low",
    });
    expect(getOpenAIModelConfig("planning", { OPENAI_MODEL: "gpt-test" })).toBeUndefined();
    expect(getOpenAIModelConfig("planning", { OPENAI_API_KEY: "secret" })).toBeUndefined();
  });

  it("creates unique ASCII client request IDs with a diagnostic schema prefix", () => {
    const first = createOpenAIClientRequestId("travel interaction/copy");
    const second = createOpenAIClientRequestId("travel interaction/copy");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^travel-travel-interaction-copy-[A-Za-z0-9-]+$/);
    expect(first.length).toBeLessThanOrEqual(512);
  });
});
