import { randomUUID } from "node:crypto";

export type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";
type OpenAIEnvironment = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 30_000;
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
  return Number.isInteger(timeout) && timeout >= MIN_TIMEOUT_MS && timeout <= MAX_TIMEOUT_MS ? timeout : undefined;
}

function validReasoningEffort(value: string | undefined): OpenAIReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "minimal" || normalized === "low" || normalized === "medium" || normalized === "high"
    ? normalized
    : undefined;
}

export function resolveOpenAITimeoutMs(environment: OpenAIEnvironment = process.env): number {
  return validTimeout(environment.OPENAI_PLANNING_TIMEOUT_MS) ?? validTimeout(environment.OPENAI_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
}

export function resolveOpenAIReasoningEffort(environment: OpenAIEnvironment = process.env): OpenAIReasoningEffort {
  return validReasoningEffort(environment.OPENAI_PLANNING_REASONING_EFFORT) ?? validReasoningEffort(environment.OPENAI_REASONING_EFFORT) ?? "low";
}

/** Server-only live-planner configuration. An incomplete credential pair disables AI extraction. */
export function getOpenAIModelConfig(environment: OpenAIEnvironment = process.env): OpenAIModelConfig | undefined {
  const model = environment.OPENAI_MODEL?.trim();
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!model || !apiKey) return undefined;
  return {
    model,
    apiKey,
    timeoutMs: resolveOpenAITimeoutMs(environment),
    reasoningEffort: resolveOpenAIReasoningEffort(environment),
  };
}

export function createOpenAIClientRequestId(schemaName: string, correlationId?: string): string {
  const safeSchema = schemaName.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 64) || "structured-response";
  const safeCorrelation = correlationId?.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 80);
  return `travel-${safeSchema}-${safeCorrelation ? `${safeCorrelation}-` : ""}${randomUUID()}`;
}
