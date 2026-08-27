import { describe, expect, it, vi } from "vitest";
import {
  buildExplanationFactBundle,
  explanationIsGrounded,
  runExplanation,
} from "@/agent/explain";
import type { ExplanationModel } from "@/agent/explanation-contracts";
import type { PlannableTripRequest, TripState } from "@/domain/model";
import type { TripProjection } from "@/domain/trip";
import type { StayOffer } from "@/inventory/contracts";

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "city:udaipur" },
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  travellers: [{ id: "traveller:1", type: "adult" }, { id: "traveller:2", type: "adult" }],
  preferences: { pace: "balanced", interests: ["heritage"] },
  constraints: [],
};

const offer: StayOffer = {
  id: "offer:stay:lake-house",
  roomOfferId: "room:lake-house",
  propertyId: "property:lake-house",
  locationId: "city:udaipur",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  rooms: 1,
  propertyFacts: {
    name: "Lake House",
    rating: 4.5,
    reviewCount: 240,
    amenities: ["wifi", "breakfast"],
    accessibility: ["elevator"],
    tags: ["heritage"],
    imageAssetKey: "lake-house",
  },
  roomFacts: {
    roomLabel: "Double",
    maxOccupancy: 2,
    mealPlan: "breakfast",
    refundable: true,
  },
  price: { amount: 6_000, currency: "INR", unit: "per_room_per_night" },
};

const trip: TripState = {
  id: "trip:udaipur",
  inventoryVersion: "travel-seed-v1",
  request,
  route: {
    marketId: "city:udaipur",
    stops: [{ locationId: "city:udaipur", checkIn: "2026-10-10", checkOut: "2026-10-12" }],
  },
  selectedTravel: [],
  selectedStays: [
    {
      id: "selection:stay:lake-house",
      kind: "stay",
      offerId: offer.id,
      travellerIds: ["traveller:1", "traveller:2"],
      locked: true,
      checkIn: "2026-10-10",
      checkOut: "2026-10-12",
      rooms: 1,
    },
  ],
  selectedActivities: [],
  version: 2,
};

const projection: TripProjection = {
  hydratedSelections: [
    { selectionId: "selection:stay:lake-house", kind: "stay", offer },
  ],
  budget: {
    total: { amount: 12_000, currency: "INR" },
    breakdown: {
      travel: { amount: 0, currency: "INR" },
      stays: { amount: 12_000, currency: "INR" },
      activities: { amount: 0, currency: "INR" },
    },
  },
  itinerary: [],
  validation: { valid: true, issues: [] },
  badgesByCandidateId: {},
};

describe("grounded EXPLAIN", () => {
  it("returns model prose only when every sentence is grounded", async () => {
    const model: ExplanationModel = {
      explain: vi.fn(async (input: Parameters<ExplanationModel["explain"]>[0]) => {
        const { factBundle } = input;
        const name = factBundle.facts.find(
          (fact) => fact.subjectId === offer.id && fact.dimension === "property_name",
        )!;
        return {
          sentences: [
            {
              text: `The selected property is ${String(name.value)}.`,
              supportingFactIds: [name.id],
            },
          ],
        };
      }),
    };
    const result = await runExplanation(
      { question: "Why this stay?", trip, selectionId: "selection:stay:lake-house" },
      { model, loadProjection: vi.fn(async () => projection) },
    );

    expect(result.usedFallback).toBe(false);
    expect(result.message).toBe("The selected property is Lake House.");
    expect(result.supportingFactIds).toHaveLength(1);
    expect(result.targetSelectionId).toBe("selection:stay:lake-house");
  });

  it("uses deterministic copy when model facts, comparisons, or numbers are unsafe", async () => {
    const factBundle = buildExplanationFactBundle(
      trip,
      projection,
      "selection:stay:lake-house",
    );
    const propertyFact = factBundle.facts.find(
      (fact) => fact.subjectId === offer.id && fact.dimension === "property_name",
    )!;
    expect(
      explanationIsGrounded(
        {
          sentences: [{ text: "This is cheaper than every alternative.", supportingFactIds: [propertyFact.id] }],
        },
        factBundle,
        offer.id,
      ),
    ).toBe(false);
    expect(
      explanationIsGrounded(
        {
          sentences: [{ text: "It costs ₹99,999.", supportingFactIds: [propertyFact.id] }],
        },
        factBundle,
        offer.id,
      ),
    ).toBe(false);

    const result = await runExplanation(
      { question: "Was this the cheapest stay?", trip, selectionId: "selection:stay:lake-house" },
      {
        model: { explain: vi.fn(async () => ({ sentences: [{ text: "Definitely cheapest.", supportingFactIds: ["fact:invented"] }] })) },
        loadProjection: vi.fn(async () => projection),
      },
    );
    expect(result.usedFallback).toBe(true);
    expect(result.message).toContain("Lake House covers 2026-10-10 to 2026-10-12");
    expect(result.message).not.toContain("cheapest");
  });

  it("falls back when the model is unavailable and never mutates the supplied trip", async () => {
    const before = structuredClone(trip);
    const result = await runExplanation(
      { question: "Explain this trip", trip },
      {
        model: { explain: vi.fn(async () => { throw new Error("offline"); }) },
        loadProjection: vi.fn(async () => projection),
      },
    );
    expect(result.usedFallback).toBe(true);
    expect(result.message).toContain("validated total of ₹12,000");
    expect(trip).toEqual(before);
  });

  it("rejects an unknown selection target deterministically", async () => {
    await expect(
      runExplanation(
        { question: "Why this?", trip, selectionId: "selection:missing" },
        { loadProjection: vi.fn(async () => projection) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  });
});
