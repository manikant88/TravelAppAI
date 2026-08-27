import { describe, expect, it } from "vitest";
import type { Constraint, TripRequest } from "@/domain/model";
import {
  applyConstraintPatch,
  checkRequirements,
  constraintSemanticKey,
  removeConstraint,
  requirePlannableRequest,
  tripRequestSchema,
  upsertConstraint,
} from "@/domain/request";

function draftRequest(): TripRequest {
  return { travellers: [], preferences: {}, constraints: [] };
}

describe("canonical trip request", () => {
  it("returns deterministic required and optional requirement ordering", () => {
    expect(checkRequirements(draftRequest())).toEqual({
      missingRequired: ["origin", "destination_intent", "dates", "travellers"],
      optionalTopics: ["budget", "pace", "mobility", "interests"],
    });

    const request: TripRequest = {
      origin: "city:delhi",
      destination: { kind: "open" },
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      travellers: [{ id: "traveller:1", type: "adult", mobility: "standard" }],
      preferences: { pace: "balanced", interests: ["heritage"] },
      constraints: [
        {
          id: "constraint:budget",
          category: "budget",
          priority: "hard",
          value: { maxTotal: { amount: 50_000, currency: "INR" } },
        },
      ],
    };
    expect(checkRequirements(request)).toEqual({ missingRequired: [], optionalTopics: [] });
    expect(requirePlannableRequest(request)).toEqual(request);
  });

  it("rejects incomplete dates, duplicate semantic constraints, and unknown traveller scopes", () => {
    const base = {
      origin: "city:delhi",
      destination: { kind: "specified" as const, locationId: "city:udaipur" },
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      travellers: [{ id: "traveller:1", type: "adult" as const }],
      preferences: {},
      constraints: [],
    };
    expect(tripRequestSchema.safeParse({ ...base, endDate: "2026-10-10" }).success).toBe(false);
    expect(
      tripRequestSchema.safeParse({
        ...base,
        constraints: [
          { id: "c:1", category: "travel", priority: "hard", value: { maxStops: 1 } },
          { id: "c:2", category: "travel", priority: "strong", value: { allowedModes: ["flight"] } },
        ],
      }).success,
    ).toBe(false);
    expect(
      tripRequestSchema.safeParse({
        ...base,
        constraints: [
          {
            id: "c:1",
            category: "activity",
            priority: "hard",
            travellerIds: ["traveller:missing"],
            value: { maxMobility: "low" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("upserts by category and normalized traveller scope while preserving stable IDs", () => {
    const existing: Constraint = {
      id: "constraint:travel",
      category: "travel",
      priority: "strong",
      travellerIds: ["traveller:2", "traveller:1"],
      value: { maxStops: 1 },
    };
    const incoming: Constraint = {
      id: "constraint:temporary",
      category: "travel",
      priority: "hard",
      travellerIds: ["traveller:1", "traveller:2"],
      value: { allowedModes: ["train", "flight", "flight"] },
    };
    const result = upsertConstraint([existing], incoming);

    expect(constraintSemanticKey(existing)).toBe("travel:traveller:1,traveller:2");
    expect(result).toEqual([
      {
        id: "constraint:travel",
        category: "travel",
        priority: "hard",
        travellerIds: ["traveller:1", "traveller:2"],
        value: { maxStops: 1, allowedModes: ["flight", "train"] },
      },
    ]);
  });

  it("applies typed constraint removals and additions without replacing the request", () => {
    const request: TripRequest = {
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "city:udaipur" },
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      travellers: [{ id: "traveller:1", type: "adult" }],
      preferences: {},
      constraints: [
        { id: "constraint:old", category: "travel", priority: "hard", value: { maxStops: 0 } },
      ],
    };
    const next = applyConstraintPatch(
      request,
      {
        removeConstraintIds: ["constraint:old"],
        upsertConstraints: [
          { category: "stay", priority: "hard", value: { requiredAmenities: [" WiFi "] } },
        ],
      },
      () => "constraint:stay",
    );

    expect(next.origin).toBe(request.origin);
    expect(next.constraints).toEqual([
      {
        id: "constraint:stay",
        category: "stay",
        priority: "hard",
        value: { requiredAmenities: ["wifi"] },
        travellerIds: undefined,
      },
    ]);
    expect(() => removeConstraint(next.constraints, "constraint:missing")).toThrow("Unknown constraint ID");
  });
});
