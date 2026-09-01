import { randomUUID } from "node:crypto";

export type OpenAIRequestKind =
  | "communication"
  | "context"
  | "discovery"
  | "planning";

export type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";

type OpenAIEnvironment = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS: Record<OpenAIRequestKind, number> = {
  communication: 20_000,
  context: 20_000,
  discovery: 25_000,
  planning: 30_000,
};

const TIMEOUT_ENV_NAME: Record<OpenAIRequestKind, string> = {
  communication: "OPENAI_COMMUNICATION_TIMEOUT_MS",
  context: "OPENAI_CONTEXT_TIMEOUT_MS",
  discovery: "OPENAI_DISCOVERY_TIMEOUT_MS",
  planning: "OPENAI_PLANNING_TIMEOUT_MS",
};

const DEFAULT_REASONING_EFFORT: Record<OpenAIRequestKind, OpenAIReasoningEffort> = {
  communication: "minimal",
  context: "minimal",
  discovery: "low",
  planning: "low",
};

const REASONING_ENV_NAME: Record<OpenAIRequestKind, string> = {
  communication: "OPENAI_COMMUNICATION_REASONING_EFFORT",
  context: "OPENAI_CONTEXT_REASONING_EFFORT",
  discovery: "OPENAI_DISCOVERY_REASONING_EFFORT",
  planning: "OPENAI_PLANNING_REASONING_EFFORT",
};

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export interface OpenAIModelConfig {
  model: string;
  apiKey: string;
  timeoutMs: number;
  reasoningEffort: OpenAIReasoningEffort;
}

function validTimeout(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const timeout = Number(value);
  if (!Number.isInteger(timeout)) return undefined;
  if (timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) return undefined;
  return timeout;
}

function validReasoningEffort(
  value: string | undefined,
): OpenAIReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }
  return undefined;
}

/**
 * A request-specific timeout wins over the global timeout. Invalid values fail
 * safe to the recommended default instead of disabling the request deadline.
 */
export function resolveOpenAITimeoutMs(
  kind: OpenAIRequestKind,
  environment: OpenAIEnvironment = process.env,
): number {
  return (
    validTimeout(environment[TIMEOUT_ENV_NAME[kind]]) ??
    validTimeout(environment.OPENAI_TIMEOUT_MS) ??
    DEFAULT_TIMEOUT_MS[kind]
  );
}

/**
 * Small copy/context tasks should not pay the latency cost of deep reasoning.
 * Planning and discovery retain low reasoning for their larger decisions.
 */
export function resolveOpenAIReasoningEffort(
  kind: OpenAIRequestKind,
  environment: OpenAIEnvironment = process.env,
): OpenAIReasoningEffort {
  return (
    validReasoningEffort(environment[REASONING_ENV_NAME[kind]]) ??
    validReasoningEffort(environment.OPENAI_REASONING_EFFORT) ??
    DEFAULT_REASONING_EFFORT[kind]
  );
}

/** Server-only model configuration. An incomplete credential pair disables AI. */
export function getOpenAIModelConfig(
  kind: OpenAIRequestKind,
  environment: OpenAIEnvironment = process.env,
): OpenAIModelConfig | undefined {
  const model = environment.OPENAI_MODEL?.trim();
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!model || !apiKey) return undefined;
  return {
    model,
    apiKey,
    timeoutMs: resolveOpenAITimeoutMs(kind, environment),
    reasoningEffort: resolveOpenAIReasoningEffort(kind, environment),
  };
}

/**
 * OpenAI documents X-Client-Request-Id as an ASCII, per-request diagnostic ID.
 * Prefixing the UUID with the schema makes local logs easier to correlate.
 */
export function createOpenAIClientRequestId(schemaName: string): string {
  const safeSchema = schemaName
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64) || "structured-response";
  return `travel-${safeSchema}-${randomUUID()}`;
}
