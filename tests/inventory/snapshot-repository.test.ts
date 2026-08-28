import { describe, expect, it, vi } from "vitest";
import {
  createHybridInventoryRepository,
  type InventoryRepository,
} from "@/inventory/repository";
import { createSnapshotInventoryRepository } from "@/inventory/snapshot-repository";
import { travelInventorySeed } from "@/db/seed/data";

describe("bundled inventory snapshot", () => {
  it("exposes the complete versioned market catalog without a database", async () => {
    const repository = createSnapshotInventoryRepository();
    const [meta, catalog, markets, locations] = await Promise.all([
      repository.getInventoryMeta(),
      repository.getPlannerCatalog(),
      repository.getDestinationMarketProfiles(),
      repository.searchLocations("delhi"),
    ]);

    expect(meta).toEqual({
      version: "travel-seed-v2",
      supportedFrom: "2026-08-28",
      supportedUntil: "2027-03-31",
    });
    expect(markets.length).toBeGreaterThanOrEqual(20);
    expect(catalog.marketIds.length).toBeGreaterThanOrEqual(20);
    expect(catalog.marketIds).toEqual(expect.arrayContaining([
      "city:bengaluru",
      "city:chennai",
      "city:hyderabad",
      "city:kolkata",
      "city:mumbai",
    ]));
    expect(locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "city:delhi" }),
      expect.objectContaining({ id: "airport:del" }),
    ]));
  });

  it("resolves transport, stay, activity, and transfer records through the same repository contract", async () => {
    const repository = createSnapshotInventoryRepository();
    const [transport, bengaluruToGoa, stays, activities, transfers] = await Promise.all([
      repository.findTransportServices(["airport:del"], ["airport:gox"]),
      repository.findTransportServices(["airport:blr"], ["airport:gox"]),
      repository.findStayOffers(["city:goa"]),
      repository.findActivitySessions(["city:goa"]),
      repository.findTransfers("airport:gox", "city:goa"),
    ]);

    expect(transport.length).toBeGreaterThanOrEqual(2);
    expect(bengaluruToGoa.length).toBeGreaterThanOrEqual(2);
    expect(stays.length).toBeGreaterThanOrEqual(4);
    expect(activities.length).toBeGreaterThanOrEqual(5);
    expect(transfers.length).toBeGreaterThanOrEqual(2);
  });

  it("hydrates image metadata when image assets are present in the snapshot", async () => {
    const repository = createSnapshotInventoryRepository({
      ...travelInventorySeed,
      imageAssets: [
        {
          key: "stay-goa-central",
          source: "pexels",
          sourceId: "123",
          url: "https://images.pexels.com/photos/123/pexels-photo-123.jpeg",
          photographer: "Demo Photographer",
          photographerUrl: "https://www.pexels.com/@demo",
          sourceUrl: "https://www.pexels.com/photo/demo-123/",
          altText: "A bright coastal hotel",
          width: 1600,
          height: 900,
        },
      ],
    });

    const [offer] = await repository.findStayOffers(["city:goa"]);
    expect(offer?.imageAssetKey).toBe("stay-goa-central");
    expect(offer?.imageUrl).toBe("https://images.pexels.com/photos/123/pexels-photo-123.jpeg");
    expect(offer?.imageCredit).toBe("Demo Photographer");
  });

  it("falls back to the snapshot when the hybrid primary repository is unavailable", async () => {
    const snapshot = createSnapshotInventoryRepository();
    const failedMeta = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const primary = { ...snapshot, getInventoryMeta: failedMeta } satisfies InventoryRepository;
    const hybrid = createHybridInventoryRepository(primary, snapshot);

    await expect(hybrid.getInventoryMeta()).resolves.toMatchObject({ version: "travel-seed-v2" });
    expect(failedMeta).toHaveBeenCalledTimes(1);
  });
});
