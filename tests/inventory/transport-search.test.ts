import { describe, expect, it } from "vitest";
import type { TransportSearchRequest } from "@/inventory/contracts";
import type {
  TransportCatalogService,
  TransportInventoryRepository,
} from "@/inventory/repository";
import { resolveOffer, searchTransport } from "@/inventory/service";

const earlyService: TransportCatalogService = {
  id: "transport:del-udr-early",
  mode: "flight",
  operator: "Air India",
  operatingWeekdays: [0, 1, 2, 3, 4, 5, 6],
  validFrom: "2026-09-01",
  validUntil: "2027-03-31",
  priceAmount: 5_400,
  currency: "INR",
  priceUnit: "per_traveller",
  segments: [
    {
      id: "segment:del-udr-early-0",
      segmentIndex: 0,
      fromLocationId: "airport:del",
      toLocationId: "airport:udr",
      fromTimezone: "Asia/Kolkata",
      toTimezone: "Asia/Kolkata",
      departureLocalTime: "05:50",
      arrivalLocalTime: "07:15",
      arrivalDayOffset: 0,
      durationMinutes: 85,
      operatorNumber: "AI 469",
    },
  ],
};

const morningService: TransportCatalogService = {
  ...earlyService,
  id: "transport:del-udr-morning",
  operator: "IndiGo",
  priceAmount: 6_900,
  segments: [
    {
      ...earlyService.segments[0],
      id: "segment:del-udr-morning-0",
      departureLocalTime: "09:20",
      arrivalLocalTime: "10:45",
      operatorNumber: "6E 2421",
    },
  ],
};

function createRepository(
  services: TransportCatalogService[] = [earlyService, morningService],
): TransportInventoryRepository {
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
        { id: "city:delhi", parentId: "country:in", timezone: "Asia/Kolkata" },
        { id: "airport:del", parentId: "city:delhi", timezone: "Asia/Kolkata" },
        { id: "city:udaipur", parentId: "country:in", timezone: "Asia/Kolkata" },
        { id: "airport:udr", parentId: "city:udaipur", timezone: "Asia/Kolkata" },
      ];
    },
    async findTransportServices(fromLocationIds, toLocationIds) {
      if (!fromLocationIds.includes("airport:del") || !toLocationIds.includes("airport:udr")) {
        return [];
      }
      return services;
    },
    async findTransportServiceById(serviceId) {
      return services.find((service) => service.id === serviceId);
    },
  };
}

function request(constraints: TransportSearchRequest["constraints"] = []): TransportSearchRequest {
  return {
    from: "city:delhi",
    to: "city:udaipur",
    date: "2026-10-10",
    travellers: [
      { id: "traveller:1", type: "adult" },
      { id: "traveller:2", type: "adult" },
    ],
    constraints,
  };
}

describe("dated transport inventory", () => {
  it("constructs explicit dated offers and orders them by objective price facts", async () => {
    const response = await searchTransport(request(), createRepository());

    expect(response.coverage).toEqual({ status: "available" });
    expect(response.results.map((offer) => offer.serviceId)).toEqual([
      "transport:del-udr-early",
      "transport:del-udr-morning",
    ]);
    expect(response.results[0]).toMatchObject({
      from: "airport:del",
      to: "airport:udr",
      departureAt: "2026-10-10T05:50:00+05:30",
      arrivalAt: "2026-10-10T07:15:00+05:30",
      durationMinutes: 85,
      stops: 0,
      price: { amount: 5_400, currency: "INR", unit: "per_traveller" },
    });
  });

  it("enforces hard travel constraints without hiding valid alternatives", async () => {
    const response = await searchTransport(
      request([
        {
          id: "constraint:no-early-flight",
          category: "travel",
          priority: "hard",
          value: { earliestDeparture: "08:00" },
        },
      ]),
      createRepository(),
    );

    expect(response.results.map((offer) => offer.serviceId)).toEqual([
      "transport:del-udr-morning",
    ]);
    expect(response.appliedFilters).toContainEqual({
      type: "hard_constraint",
      label: "Applied travel constraint constraint:no-early-flight",
      constraintId: "constraint:no-early-flight",
    });
  });

  it("reports which hard constraint eliminated every available offer", async () => {
    const response = await searchTransport(
      request([
        {
          id: "constraint:depart-after-noon",
          category: "travel",
          priority: "hard",
          value: { earliestDeparture: "12:00" },
        },
      ]),
      createRepository(),
    );

    expect(response.results).toEqual([]);
    expect(response.coverage).toEqual({
      status: "eliminated_by_constraints",
      constraintIds: ["constraint:depart-after-noon"],
    });
  });

  it("keeps unsupported location, route, window, and availability states distinct", async () => {
    const repository = createRepository();
    const unsupportedLocation = await searchTransport(
      { ...request(), from: "city:unknown" },
      repository,
    );
    const unsupportedRoute = await searchTransport(
      { ...request(), from: "city:udaipur", to: "city:delhi" },
      repository,
    );
    const outsideWindow = await searchTransport(
      { ...request(), date: "2027-04-01" },
      repository,
    );
    const noAvailability = await searchTransport(
      request(),
      createRepository([{ ...morningService, operatingWeekdays: [0] }]),
    );

    expect(unsupportedLocation.coverage).toEqual({
      status: "unsupported_location",
      locationId: "city:unknown",
    });
    expect(unsupportedRoute.coverage).toEqual({ status: "unsupported_route" });
    expect(outsideWindow.coverage).toEqual({ status: "outside_inventory_window" });
    expect(noAvailability.coverage).toEqual({ status: "no_availability" });
  });

  it("resolves every offer from its signed payload and current database facts", async () => {
    const repository = createRepository();
    const response = await searchTransport(request(), repository);
    const offer = response.results[0];
    const resolved = await resolveOffer(offer.id, repository);

    expect(resolved).toEqual(offer);
    await expect(resolveOffer(`${offer.id}tampered`, repository)).rejects.toThrow(
      "Invalid transport offer ID",
    );
  });

  it("normalizes unordered request collections into the same query ID", async () => {
    const firstRequest = request([
      {
        id: "constraint:mode",
        category: "travel",
        priority: "strong",
        value: { allowedModes: ["train", "flight"] },
      },
    ]);
    const secondRequest = {
      ...firstRequest,
      travellers: [...firstRequest.travellers].reverse(),
      constraints: [
        {
          id: "constraint:mode",
          category: "travel" as const,
          priority: "strong" as const,
          value: { allowedModes: ["flight", "train"] },
        },
      ],
    } satisfies TransportSearchRequest;

    const first = await searchTransport(firstRequest, createRepository());
    const second = await searchTransport(secondRequest, createRepository());
    expect(first.queryId).toBe(second.queryId);
  });
});
