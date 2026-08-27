import { describe, expect, it } from "vitest";
import type { TransferSearchRequest } from "@/inventory/contracts";
import type {
  TransferCatalogOffer,
  TransferInventoryRepository,
} from "@/inventory/repository";
import { resolveOffer, searchTransfers } from "@/inventory/service";

const catalog: TransferCatalogOffer[] = [
  {
    id: "transfer:udr-old-city-car",
    fromLocationId: "airport:udr",
    toLocationId: "neighborhood:udaipur-old-city",
    mode: "car",
    durationMinutes: 45,
    capacity: 3,
    priceAmount: 1_200,
    currency: "INR",
    priceUnit: "per_vehicle",
  },
  {
    id: "transfer:udr-old-city-van",
    fromLocationId: "airport:udr",
    toLocationId: "neighborhood:udaipur-old-city",
    mode: "van",
    durationMinutes: 55,
    operatingStartLocalTime: "06:00",
    operatingEndLocalTime: "23:00",
    capacity: 6,
    priceAmount: 1_800,
    currency: "INR",
    priceUnit: "per_vehicle",
  },
];

function createRepository(
  transfers: TransferCatalogOffer[] = catalog,
): TransferInventoryRepository {
  return {
    async getInventoryMeta() {
      return {
        version: "travel-seed-v1",
        supportedFrom: "2026-09-01",
        supportedUntil: "2027-03-31",
      };
    },
    async getActiveLocationGraph() {
      return [
        { id: "country:in", timezone: "Asia/Kolkata" },
        { id: "city:udaipur", parentId: "country:in", timezone: "Asia/Kolkata" },
        { id: "airport:udr", parentId: "city:udaipur", timezone: "Asia/Kolkata" },
        {
          id: "neighborhood:udaipur-old-city",
          parentId: "city:udaipur",
          timezone: "Asia/Kolkata",
        },
        {
          id: "neighborhood:udaipur-pichola",
          parentId: "city:udaipur",
          timezone: "Asia/Kolkata",
        },
      ];
    },
    async findTransfers(fromLocationId, toLocationId) {
      return transfers.filter(
        (transfer) =>
          transfer.fromLocationId === fromLocationId && transfer.toLocationId === toLocationId,
      );
    },
    async findTransferById(transferId) {
      return transfers.find((transfer) => transfer.id === transferId);
    },
  };
}

function request(travellerCount = 2): TransferSearchRequest {
  return {
    from: "airport:udr",
    to: "neighborhood:udaipur-old-city",
    travellers: Array.from({ length: travellerCount }, (_, index) => ({
      id: `traveller:${index + 1}`,
      type: "adult" as const,
    })),
  };
}

describe("transfer inventory search", () => {
  it("returns stable offers with explicit capacity and per-vehicle price", async () => {
    const response = await searchTransfers(request(), createRepository());

    expect(response.coverage).toEqual({ status: "available" });
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toMatchObject({
      transferId: "transfer:udr-old-city-car",
      from: "airport:udr",
      to: "neighborhood:udaipur-old-city",
      mode: "car",
      durationMinutes: 45,
      capacity: 3,
      price: { amount: 1_200, currency: "INR", unit: "per_vehicle" },
    });
  });

  it("orders by deterministic whole-group vehicle cost", async () => {
    const response = await searchTransfers(request(4), createRepository());

    expect(response.results.map((offer) => offer.mode)).toEqual(["van", "car"]);
  });

  it("distinguishes unsupported locations from unsupported routes", async () => {
    const repository = createRepository();
    const unsupportedLocation = await searchTransfers(
      { ...request(), from: "airport:missing" },
      repository,
    );
    const unsupportedRoute = await searchTransfers(
      { ...request(), to: "neighborhood:udaipur-pichola" },
      repository,
    );

    expect(unsupportedLocation.coverage).toEqual({
      status: "unsupported_location",
      locationId: "airport:missing",
    });
    expect(unsupportedRoute.coverage).toEqual({ status: "unsupported_route" });
  });

  it("reconstructs offers from current database facts and rejects tampering", async () => {
    const repository = createRepository();
    const response = await searchTransfers(request(), repository);
    const offer = response.results[0];

    await expect(resolveOffer(offer.id, repository)).resolves.toEqual(offer);
    await expect(resolveOffer(`${offer.id}tampered`, repository)).rejects.toThrow(
      "Invalid transfer offer ID",
    );
  });

  it("includes traveller scope in stable query identity", async () => {
    const repository = createRepository();
    const twoTravellers = await searchTransfers(request(2), repository);
    const fourTravellers = await searchTransfers(request(4), repository);

    expect(twoTravellers.queryId).not.toBe(fourTravellers.queryId);
    expect(
      (await searchTransfers(request(2), repository)).queryId,
    ).toBe(twoTravellers.queryId);
  });
});
