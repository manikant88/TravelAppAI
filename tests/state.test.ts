import { describe, expect, it } from "vitest";
import type { PlannableTripRequest, TripState } from "@/domain/model";
import type { TripProjection } from "@/domain/trip";
import {
  initialWorkspaceState,
  workspaceReducer,
  type ConversationEntry,
  type WorkspaceState,
} from "@/state";

const request: PlannableTripRequest = {
  origin: "city:delhi",
  destination: { kind: "specified", locationId: "city:udaipur" },
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  travellers: [{ id: "traveller:1", type: "adult" }],
  preferences: { pace: "balanced", interests: ["heritage"] },
  constraints: [],
};

const trip: TripState = {
  id: "trip:udaipur",
  inventoryVersion: "travel-seed-v1",
  request,
  route: {
    marketId: "city:udaipur",
    stops: [
      {
        locationId: "city:udaipur",
        checkIn: "2026-10-10",
        checkOut: "2026-10-12",
      },
    ],
  },
  selectedTravel: [],
  selectedStays: [],
  selectedActivities: [],
  version: 1,
};

const projection: TripProjection = {
  hydratedSelections: [],
  budget: {
    total: { amount: 0, currency: "INR" },
    breakdown: {
      travel: { amount: 0, currency: "INR" },
      stays: { amount: 0, currency: "INR" },
      activities: { amount: 0, currency: "INR" },
    },
  },
  itinerary: [],
  validation: { valid: true, issues: [] },
  badgesByCandidateId: {},
};

function entry(id: string, role: ConversationEntry["role"]): ConversationEntry {
  return { id, role, text: id };
}

describe("workspace reducer", () => {
  it("starts planning without discarding a committed trip", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      committedTrip: trip,
      projection,
      asyncStatus: "error",
      error: { code: "MODEL_FAILURE", message: "Unavailable", retryable: true },
    };

    const next = workspaceReducer(state, {
      type: "planning_started",
      entry: entry("message:request", "user"),
    });

    expect(next.asyncStatus).toBe("planning");
    expect(next.error).toBeUndefined();
    expect(next.committedTrip).toBe(trip);
    expect(next.projection).toBe(projection);
    expect(next.conversation.at(-1)?.id).toBe("message:request");
  });

  it("commits only a successful validated trip result", () => {
    const next = workspaceReducer(initialWorkspaceState, {
      type: "planning_succeeded",
      result: {
        type: "trip_ready",
        trip,
        projection,
        message: "Ready",
        actionSummary: [],
      },
      entry: entry("message:ready", "assistant"),
    });

    expect(next.asyncStatus).toBe("idle");
    expect(next.committedTrip).toBe(trip);
    expect(next.projection).toBe(projection);
    expect(next.latestOutcome).toBeUndefined();
  });

  it("preserves canonical trip state when planning fails", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      committedTrip: trip,
      projection,
    };

    const next = workspaceReducer(state, {
      type: "planning_failed",
      error: { code: "MODEL_FAILURE", message: "Unavailable", retryable: true },
      entry: entry("message:error", "assistant"),
    });

    expect(next.asyncStatus).toBe("error");
    expect(next.committedTrip).toBe(trip);
    expect(next.projection).toBe(projection);
    expect(next.draftRequest).toBe(state.draftRequest);
  });

  it("records that the one optional clarification was used", () => {
    const next = workspaceReducer(initialWorkspaceState, {
      type: "outcome_received",
      outcome: {
        type: "clarification",
        config: {
          kind: "optional",
          topic: "interests",
          question: "Which experiences matter most?",
          allowCustomInput: true,
          allowSkip: true,
        },
        message: "One detail could improve the plan.",
      },
      entry: entry("message:clarification", "assistant"),
    });

    expect(next.optionalClarificationUsed).toBe(true);
    expect(next.latestOutcome?.type).toBe("clarification");
    expect(next.asyncStatus).toBe("idle");
  });
});
