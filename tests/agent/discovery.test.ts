import { describe, expect, it, vi } from "vitest";
import {
  runDestinationDiscovery,
  type DestinationDiscoveryModel,
} from "@/agent/discovery";
import type { PlannableTripRequest } from "@/domain/model";
import type { DestinationDiscoveryResult } from "@/inventory/discovery";
import type { createInventoryRepository } from "@/inventory/repository";

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "open" },
  startDate: "2026-11-10",
  endDate: "2026-11-14",
  travellers: [{ id: "traveller:1", type: "adult" }],
  preferences: { pace: "balanced", interests: ["beaches"] },
  constraints: [],
};

function candidate(id: string, name: string, price: number) {
  return {
    profile: {
      id,
      name,
      countryCode: id.includes("goa") ? "IN" : "TH",
      region: id.includes("goa") ? ("india" as const) : ("international" as const),
      displayOrder: id.includes("goa") ? 1 : 11,
      tags: ["beaches"],
    },
    facts: [
      {
        id: `fact:${id}:price`,
        subjectType: "market" as const,
        subjectId: id,
        dimension: "price_floor",
        label: "Conservative trip price floor (INR)",
        value: price,
      },
      {
        id: `fact:${id}:duration`,
        subjectType: "market" as const,
        subjectId: id,
        dimension: "travel_minutes",
        label: "Fastest observed return travel minutes",
        value: 300,
      },
    ],
  };
}

function discoveryResult(ids = ["city:goa", "region:thailand-andaman"]): DestinationDiscoveryResult {
  const available = [
    candidate("city:goa", "Goa", 42_000),
    candidate("region:thailand-andaman", "Thailand — Phuket & Krabi", 89_000),
  ].filter((item) => ids.includes(item.profile.id));
  return {
    observation: {
      queryId: "query:discovery",
      toolName: "discover_destinations",
      coverage: available.length ? { status: "available" } : { status: "no_availability" },
      candidates: available.map((item) => ({
        candidateId: item.profile.id,
        facts: item.facts,
      })),
      rejectedSummary: [],
    },
    factBundle: {
      facts: available.flatMap((item) => item.facts),
      allowedComparisonDimensions: ["price", "duration"],
      allowedFollowUpActions: [],
    },
    profiles: available.map((item) => item.profile),
    matchingDestinationCount: available.length,
    inventoryVersion: "travel-seed-v1",
  };
}

const repository = {} as ReturnType<typeof createInventoryRepository>;

describe("open-ended destination discovery", () => {
  it("returns a grounded comparison and permits evidence from selected alternatives", async () => {
    const model: DestinationDiscoveryModel = {
      recommendDestinations: vi.fn().mockResolvedValue({
        candidateMarketIds: ["city:goa", "region:thailand-andaman"],
        recommendedMarketId: "city:goa",
        supportingFactIds: [
          "fact:city:goa:price",
          "fact:region:thailand-andaman:duration",
        ],
        comparisonDimensions: ["price", "duration"],
      }),
    };

    const result = await runDestinationDiscovery(request, {
      model,
      repository,
      discover: vi.fn().mockResolvedValue(discoveryResult()),
    });

    expect(result.type).toBe("destination_options");
    if (result.type !== "destination_options") return;
    expect(result.block.type).toBe("option_comparison");
    expect(result.block.emphasis?.recommendedId).toBe("city:goa");
    expect(result.options.map((option) => option.id)).toEqual([
      "city:goa",
      "region:thailand-andaman",
    ]);
  });

  it("returns an honest conflict without asking the model to compare one candidate", async () => {
    const recommendDestinations = vi.fn();
    const result = await runDestinationDiscovery(request, {
      model: { recommendDestinations },
      repository,
      discover: vi.fn().mockResolvedValue(discoveryResult(["city:goa"])),
    });

    expect(result).toMatchObject({
      type: "conflict",
      reason: "insufficient_market_coverage",
      availableCandidateCount: 1,
    });
    expect(recommendDestinations).not.toHaveBeenCalled();
  });

  it("falls back to a deterministic grounded recommendation when model output is invalid", async () => {
    const result = await runDestinationDiscovery(request, {
        model: {
          recommendDestinations: vi.fn().mockResolvedValue({
            candidateMarketIds: ["city:goa", "region:thailand-andaman"],
            recommendedMarketId: "city:goa",
            supportingFactIds: ["fact:invented"],
            comparisonDimensions: ["price"],
          }),
        },
        repository,
        discover: vi.fn().mockResolvedValue(discoveryResult()),
      });
    expect(result.type).toBe("destination_options");
    if (result.type !== "destination_options") return;
    expect(result.block.emphasis?.recommendedId).toBe("city:goa");
  });

  it("reports the full match count while keeping model evidence bounded", async () => {
    const discovery = discoveryResult();
    discovery.matchingDestinationCount = 13;
    const result = await runDestinationDiscovery(request, {
      repository,
      discover: vi.fn().mockResolvedValue(discovery),
    });
    expect(result).toMatchObject({
      type: "destination_options",
      matchingDestinationCount: 13,
    });
  });
});
