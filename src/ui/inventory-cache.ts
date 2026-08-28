const inventoryRequestCache = new Map<string, Promise<unknown>>();

function cacheKey(path: string, body: unknown): string {
  return `${path}:${JSON.stringify(body)}`;
}

export async function cachedInventoryPost<T>(path: string, body: unknown): Promise<T> {
  const key = cacheKey(path, body);
  const existing = inventoryRequestCache.get(key);
  if (existing) return existing as Promise<T>;

  const request = fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const result: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = result && typeof result === "object" && "message" in result && typeof result.message === "string"
        ? result.message
        : "Inventory is unavailable";
      throw new Error(message);
    }
    return result as T;
  }).catch((error: unknown) => {
    inventoryRequestCache.delete(key);
    throw error;
  });

  inventoryRequestCache.set(key, request);
  return request;
}

export function clearInventoryRequestCache(): void {
  inventoryRequestCache.clear();
}
