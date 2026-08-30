import { describe, expect, it } from "vitest";
import { createDeterministicPlannerModel } from "@/agent/deterministic-planner";
import { runDestinationDiscovery } from "@/agent/discovery";
import { runNaturalIntake } from "@/agent/natural-intake";
import { runSpecifiedPlanApi } from "@/agent/plan-api";
import { runModification } from "@/agent/modify";
import type { TripRequest } from "@/domain/model";
import { createSnapshotInventoryRepository } from "@/inventory/snapshot-repository";
import { marketManifest } from "@/db/seed/market-manifest";

const repository = createSnapshotInventoryRepository();

const adults = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `traveller:${index + 1}`,
    type: "adult" as const,
  }));

describe("snapshot-backed travel flows", () => {
  it("builds a valid fully specified balanced trip across every supported market", async () => {
    for (const market of marketManifest) {
      const result = await runSpecifiedPlanApi(
        {
          tripId: `trip:coverage:${market.id}`,
          request: {
            origin: "city:delhi",
            destination: { kind: "specified", locationId: market.id },
            startDate: "2026-10-18",
            endDate: "2026-10-23",
            travellers: adults(4),
            preferences: { pace: "balanced", interests: market.tags.slice(0, 3) },
            constraints: [],
          },
        },
        {
          model: createDeterministicPlannerModel(),
          modelMode: "deterministic_fallback",
          repository,
        },
      );

      expect(result.type, market.id).toBe("trip_ready");
      if (result.type === "trip_ready") {
        expect(result.projection.validation.valid, market.id).toBe(true);
      }
    }
  });

  it("can build every destination presented by discovery with the same request", async () => {
    const openRequest: TripRequest = {
      origin: "city:delhi",
      destination: { kind: "open" },
      startDate: "2026-10-18",
      endDate: "2026-10-23",
      travellers: adults(4),
      preferences: { pace: "balanced", interests: ["food", "relaxed"] },
      constraints: [],
    };
    const discovery = await runDestinationDiscovery(openRequest, { repository });
    expect(discovery.type).toBe("destination_options");
    if (discovery.type !== "destination_options") return;

    for (const option of discovery.options) {
      const result = await runSpecifiedPlanApi(
        {
          tripId: `trip:discovery-contract:${option.id}`,
          request: {
            ...openRequest,
            destination: { kind: "specified", locationId: option.id },
          },
        },
        {
          model: createDeterministicPlannerModel(),
          modelMode: "deterministic_fallback",
          repository,
        },
      );
      expect(result.type, option.id).toBe("trip_ready");
    }
  });

  it("resolves Thailand to its canonical multi-stop market without a model", async () => {
    const result = await runNaturalIntake(
      {
        message:
          "Plan a relaxed trip from Delhi to Thailand for two adults from 10 October 2026 to 15 October 2026 under ₹100,000 with beaches and food.",
        currentRequest: { travellers: [], preferences: {}, constraints: [] },
      },
      { repository, today: () => "2026-08-29" },
    );

    expect(result.issues).toEqual([]);
    expect(result.missingRequired).toEqual([]);
    expect(result.request.destination).toEqual({
      kind: "specified",
      locationId: "region:thailand-andaman",
    });
  });

  it("discovers feasible destinations without a model", async () => {
    const request: TripRequest = {
      origin: "city:delhi",
      destination: { kind: "open" },
      startDate: "2026-12-15",
      endDate: "2026-12-18",
      travellers: adults(2),
      preferences: { pace: "relaxed" },
      constraints: [],
    };

    const result = await runDestinationDiscovery(request, { repository });

    expect(result.type).toBe("destination_options");
    if (result.type !== "destination_options") return;
    expect(result.options.length).toBeGreaterThanOrEqual(2);
    expect(result.options.map((option) => option.id)).toContain(result.block.emphasis?.recommendedId);
  });

  it("parses and discovers the flexible three-day weekend happy path without a model", async () => {
    const intake = await runNaturalIntake(
      {
        message:
          "3-day weekend trip from Delhi this Saturday for 2 people. Budget ₹45K. Flexible destination, relaxing vibe, great food, minimal travel.",
        currentRequest: { travellers: [], preferences: {}, constraints: [] },
      },
      { repository, today: () => "2026-08-29" },
    );

    expect(intake.issues).toEqual([]);
    expect(intake.missingRequired).toEqual([]);
    expect(intake.request).toMatchObject({
      origin: "city:delhi",
      destination: { kind: "open" },
      startDate: "2026-08-29",
      endDate: "2026-08-31",
      travellers: [{ type: "adult" }, { type: "adult" }],
      preferences: { pace: "relaxed" },
      constraints: [
        {
          category: "budget",
          value: { maxTotal: { amount: 45_000, currency: "INR" } },
        },
      ],
    });
    expect(intake.request.preferences.interests).toContain("food");

    const discovery = await runDestinationDiscovery(intake.request, { repository });
    expect(discovery.type).toBe("destination_options");
    if (discovery.type !== "destination_options") return;
    expect(discovery.options.length).toBeGreaterThan(0);
  });

  it("assembles and validates the Thailand multi-stop trip without a model", async () => {
    const result = await runSpecifiedPlanApi(
      {
        tripId: "trip:snapshot-thailand",
        request: {
          origin: "city:delhi",
          destination: { kind: "specified", locationId: "region:thailand-andaman" },
          startDate: "2026-10-10",
          endDate: "2026-10-15",
          travellers: adults(2),
          preferences: { pace: "relaxed", interests: ["beaches", "food"] },
          constraints: [],
        },
      },
      {
        model: createDeterministicPlannerModel(),
        modelMode: "deterministic_fallback",
        repository,
      },
    );

    expect(result.type).toBe("trip_ready");
    if (result.type !== "trip_ready") return;
    expect(result.projection.validation.valid).toBe(true);
    expect(result.trip.route.stops.map((stop) => stop.locationId)).toEqual([
      "city:phuket",
      "city:krabi",
    ]);
  });

  it("assembles a short Sydney trip without scheduling activities before next-day arrival", async () => {
    const result = await runSpecifiedPlanApi(
      {
        tripId: "trip:snapshot-sydney-next-day-arrival",
        request: {
          origin: "city:delhi",
          destination: { kind: "specified", locationId: "city:sydney" },
          startDate: "2026-10-10",
          endDate: "2026-10-12",
          travellers: adults(1),
          preferences: {
            pace: "relaxed",
            interests: ["coast", "architecture", "nature"],
          },
          constraints: [],
        },
      },
      {
        model: createDeterministicPlannerModel(),
        modelMode: "deterministic_fallback",
        repository,
      },
    );

    expect(result.type).toBe("trip_ready");
    if (result.type !== "trip_ready") return;
    expect(result.projection.validation.valid).toBe(true);
    const outboundArrival = result.projection.itinerary
      .flatMap((day) => day.events)
      .find((event) => event.type === "travel" && event.startAt?.slice(0, 10) === "2026-10-10")
      ?.endAt;
    expect(outboundArrival).toBeDefined();
    expect(
      result.projection.itinerary
        .flatMap((day) => day.events)
        .filter((event) => event.type === "activity")
        .every((event) => event.startAt! > outboundArrival!),
    ).toBe(true);
  });

  it("only offers total-price reductions for an explicit cheaper-stay request", async () => {
    const planned = await runSpecifiedPlanApi(
      {
        tripId: "trip:snapshot-cheaper-stay",
        request: {
          origin: "city:delhi",
          destination: { kind: "specified", locationId: "city:goa" },
          startDate: "2026-12-15",
          endDate: "2026-12-19",
          travellers: adults(6),
          preferences: { pace: "relaxed", interests: ["family", "food"] },
          constraints: [],
        },
      },
      {
        model: createDeterministicPlannerModel(),
        modelMode: "deterministic_fallback",
        repository,
      },
    );
    expect(planned.type).toBe("trip_ready");
    if (planned.type !== "trip_ready") return;

    const result = await runModification(
      {
        message: "Find a cheaper stay but preserve my travel selections.",
        trip: planned.trip,
      },
      { repository },
    );

    if (result.type === "conflict") {
      expect(result.message).toMatch(/none is cheaper/i);
      return;
    }
    if (result.type === "proposal") {
      expect(result.preview.budgetDelta.amount).toBeLessThan(0);
      return;
    }
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options.every((option) => option.preview.budgetDelta.amount < 0)).toBe(true);
  });

  it("replaces a day's activity lineup with two validated requested activities", async () => {
    const planned = await runSpecifiedPlanApi(
      {
        tripId: "trip:snapshot-multi-activity",
        request: {
          origin: "city:bengaluru",
          destination: { kind: "specified", locationId: "city:rishikesh" },
          startDate: "2026-09-03",
          endDate: "2026-09-06",
          travellers: adults(1),
          preferences: { pace: "relaxed", interests: ["relaxation"] },
          constraints: [],
        },
      },
      {
        model: createDeterministicPlannerModel(),
        modelMode: "deterministic_fallback",
        repository,
      },
    );
    expect(planned.type).toBe("trip_ready");
    if (planned.type !== "trip_ready") return;

    const result = await runModification(
      {
        message: "Update day 3 with 2 activities, one outdoor adventure and one food and market experience.",
        trip: planned.trip,
      },
      { repository },
    );

    expect(result.type).toBe("proposal");
    if (result.type !== "proposal") return;
    expect(result.projection.validation.valid).toBe(true);
    const targetDay = result.projection.itinerary.find((day) => day.date === "2026-09-05");
    expect(targetDay?.events.filter((event) => event.type === "activity")).toHaveLength(2);
    expect(result.proposal.operations.filter((operation) => operation.type === "add_activity")).toHaveLength(2);
  });
});
