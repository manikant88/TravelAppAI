import { describe, expect, it, vi } from "vitest";
import { checkInventoryReadiness } from "@/db/readiness";

describe("inventory readiness", () => {
  it("returns only the minimal verified inventory contract", async () => {
    const repository = {
      getInventoryMeta: vi.fn(async () => ({
        version: "travel-seed-v1",
        supportedFrom: "2026-09-01",
        supportedUntil: "2027-03-31",
      })),
    };

    await expect(checkInventoryReadiness(repository)).resolves.toEqual({
      status: "ready",
      inventoryVersion: "travel-seed-v1",
      supportedFrom: "2026-09-01",
      supportedUntil: "2027-03-31",
      source: "snapshot",
    });
    expect(repository.getInventoryMeta).toHaveBeenCalledTimes(1);
  });

  it("does not convert database failure into a false ready state", async () => {
    const repository = {
      getInventoryMeta: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    };

    await expect(checkInventoryReadiness(repository)).rejects.toThrow("fetch failed");
  });
});
