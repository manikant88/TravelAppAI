import { describe, expect, it, vi } from "vitest";
import { createRetryingDatabaseFetch } from "@/db/retry";

describe("runtime Neon fetch retry", () => {
  it("retries transient network failures with bounded backoff", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ready", { status: 200 }));
    const sleep = vi.fn(async () => undefined);
    const onRetry = vi.fn();
    const retryingFetch = createRetryingDatabaseFetch({
      fetchFn,
      sleep,
      delaysMs: [400, 1_000],
      onRetry,
    });

    const response = await retryingFetch("https://example.test/sql", {
      method: "POST",
      body: "select 1",
    });

    expect(response.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(400);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 400,
      reason: "fetch failed",
    });
  });

  it("retries only transient HTTP statuses", async () => {
    const transientFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("waking", { status: 503 }))
      .mockResolvedValueOnce(new Response("ready", { status: 200 }));
    const retryingTransient = createRetryingDatabaseFetch({
      fetchFn: transientFetch,
      sleep: async () => undefined,
    });
    await expect(retryingTransient("https://example.test/sql")).resolves.toMatchObject({
      status: 200,
    });
    expect(transientFetch).toHaveBeenCalledTimes(2);

    const permanentFetch = vi.fn<typeof fetch>(async () => new Response("bad query", { status: 400 }));
    const retryingPermanent = createRetryingDatabaseFetch({
      fetchFn: permanentFetch,
      sleep: async () => undefined,
    });
    await expect(retryingPermanent("https://example.test/sql")).resolves.toMatchObject({
      status: 400,
    });
    expect(permanentFetch).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured attempt budget", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("still offline");
    });
    const retryingFetch = createRetryingDatabaseFetch({
      attempts: 3,
      fetchFn,
      sleep: async () => undefined,
    });

    await expect(retryingFetch("https://example.test/sql")).rejects.toThrow("still offline");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a caller-aborted request", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const retryingFetch = createRetryingDatabaseFetch({ fetchFn });

    await expect(
      retryingFetch("https://example.test/sql", { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
