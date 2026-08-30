export class TravelAgentClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TravelAgentClientError";
  }
}

export async function postAgentJson(
  path: string,
  payload: unknown,
  fallback: { code: string; message: string },
): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return body;
  const error = body as { code?: unknown; message?: unknown; retryable?: unknown } | undefined;
  throw new TravelAgentClientError(
    typeof error?.code === "string" ? error.code : fallback.code,
    typeof error?.message === "string" ? error.message : fallback.message,
    error?.retryable === true,
  );
}
