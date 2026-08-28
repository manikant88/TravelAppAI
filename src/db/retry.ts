export interface DatabaseFetchRetryOptions {
  attempts?: number;
  delaysMs?: number[];
  fetchFn?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (event: { attempt: number; delayMs: number; reason: string }) => void;
}

const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryReason(value: Response | unknown): string {
  if (value instanceof Response) return `HTTP ${value.status}`;
  return value instanceof Error ? value.message : "network failure";
}

function requestWasAborted(request: Request): boolean {
  return request.signal.aborted;
}

export function createRetryingDatabaseFetch(
  options: DatabaseFetchRetryOptions = {},
): typeof fetch {
  const attempts = options.attempts ?? 3;
  const delaysMs = options.delaysMs ?? [400, 1_000];
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Database fetch attempts must be a positive integer");
  }

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (requestWasAborted(request)) throw request.signal.reason;
      try {
        const response = await fetchFn(request.clone());
        if (!transientStatuses.has(response.status) || attempt === attempts) return response;
        lastError = response;
        await response.body?.cancel().catch(() => undefined);
      } catch (error: unknown) {
        if (requestWasAborted(request)) throw error;
        lastError = error;
        if (attempt === attempts) throw error;
      }

      const delayMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      options.onRetry?.({ attempt, delayMs, reason: retryReason(lastError) });
      if (delayMs > 0) await sleep(delayMs);
    }

    if (lastError instanceof Response) return lastError;
    throw lastError;
  };
}
