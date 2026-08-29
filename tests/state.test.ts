import { describe, expect, it } from "vitest";
import type { PlannableTripRequest, TripRequest, TripState } from "@/domain/model";
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
  it("starts without assuming a traveller count or pace", () => {
    expect(initialWorkspaceState.itinerary.request.travellers).toEqual([]);
    expect(initialWorkspaceState.itinerary.request.preferences.pace).toBeUndefined();
    expect(initialWorkspaceState.conversation).toEqual([]);
  });

  it("populates only the draft when natural-language intake succeeds", () => {
    const interpreted: TripRequest = {
      ...request,
      destination: { kind: "open" },
    };
    const started = workspaceReducer(initialWorkspaceState, {
      type: "intake_started",
      entry: entry("message:natural", "user"),
    });
    const next = workspaceReducer(started, {
      type: "intake_received",
      result: {
        request: interpreted,
        resolvedLocations: {
          origin: { id: "city:delhi", label: "Delhi" },
          destination: { id: "destination:open", label: "Open to recommendations" },
        },
        appliedFields: ["origin", "destination", "dates", "travellers"],
        missingRequired: [],
        suggestedDateRanges: [],
        issues: [],
        message: "Review the trip brief.",
      },
      entry: entry("message:interpreted", "assistant"),
    });

    expect(started.asyncStatus).toBe("interpreting");
    expect(next.asyncStatus).toBe("idle");
    expect(next.itinerary.request).toEqual(interpreted);
    expect(next.itinerary.trip).toBeUndefined();
    expect(next.latestIntake?.appliedFields).toContain("destination");
  });

  it("starts planning without discarding a committed trip", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      itinerary: { request: trip.request, trip, projection },
      asyncStatus: "error",
      error: { code: "MODEL_FAILURE", message: "Unavailable", retryable: true },
    };

    const next = workspaceReducer(state, {
      type: "planning_started",
      entry: entry("message:request", "user"),
    });

    expect(next.asyncStatus).toBe("planning");
    expect(next.error).toBeUndefined();
    expect(next.itinerary.trip).toBe(trip);
    expect(next.itinerary.projection).toBe(projection);
    expect(next.conversation.at(-1)?.id).toBe("message:request");
  });

  it("commits only a successful validated trip result", () => {
    const previousRequest: TripRequest = {
      ...request,
      destination: { kind: "open" },
    };
    const next = workspaceReducer(
      {
        ...initialWorkspaceState,
        itinerary: { request: previousRequest },
      },
      {
      type: "planning_succeeded",
      result: {
        type: "trip_ready",
        trip,
        projection,
        message: "Ready",
        actionSummary: [],
      },
      entry: entry("message:ready", "assistant"),
      },
    );

    expect(next.asyncStatus).toBe("idle");
    expect(next.itinerary.trip).toBe(trip);
    expect(next.itinerary.projection).toBe(projection);
    expect(next.itinerary.request).toBe(trip.request);
    expect(next.latestOutcome).toBeUndefined();
  });

  it("preserves canonical trip state when planning fails", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      itinerary: { request: trip.request, trip, projection },
    };

    const next = workspaceReducer(state, {
      type: "planning_failed",
      error: { code: "MODEL_FAILURE", message: "Unavailable", retryable: true },
      entry: entry("message:error", "assistant"),
    });

    expect(next.asyncStatus).toBe("error");
    expect(next.itinerary.trip).toBe(trip);
    expect(next.itinerary.projection).toBe(projection);
    expect(next.itinerary.request).toBe(state.itinerary.request);
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

  it("stores destination options without mutating an existing committed trip", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      itinerary: {
        request: { ...request, destination: { kind: "open" } },
        trip,
        projection,
      },
    };
    const result = {
      type: "destination_options" as const,
      block: {
        type: "option_comparison" as const,
        entityType: "destination" as const,
        choices: [{ optionId: "city:goa" }, { optionId: "city:udaipur" }],
        emphasis: {
          recommendedId: "city:goa",
          comparisonDimensions: ["price"],
          supportingFactIds: ["fact:goa:price"],
        },
      },
      factBundle: {
        facts: [
          {
            id: "fact:goa:price",
            subjectType: "market" as const,
            subjectId: "city:goa",
            dimension: "price_floor",
            label: "Price floor",
            value: 40_000,
          },
        ],
        allowedComparisonDimensions: ["price"],
        allowedFollowUpActions: [],
      },
      options: [
        { id: "city:goa", name: "Goa", countryCode: "IN", region: "india" as const, tags: ["beaches"] },
        { id: "city:udaipur", name: "Udaipur", countryCode: "IN", region: "india" as const, tags: ["heritage"] },
      ],
      message: "Choose a destination.",
    };

    const next = workspaceReducer(state, {
      type: "discovery_received",
      result,
      entry: entry("message:options", "assistant"),
    });

    expect(next.destinationDiscovery).toBe(result);
    expect(next.itinerary.trip).toBe(trip);
    expect(next.itinerary.projection).toBe(projection);
    expect(next.itinerary.request.destination).toEqual({ kind: "open" });
  });

  it("applies a selected destination only to the draft before PLAN", () => {
    const openDraft: TripRequest = { ...request, destination: { kind: "open" } };
    const selectedDraft: TripRequest = {
      ...openDraft,
      destination: { kind: "specified", locationId: "city:goa" },
    };
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      itinerary: { request: openDraft, trip, projection },
    };

    const next = workspaceReducer(state, {
      type: "destination_selected",
      request: selectedDraft,
    });

    expect(next.itinerary.request).toBe(selectedDraft);
    expect(next.itinerary.trip).toBe(trip);
    expect(next.itinerary.projection).toBe(projection);
    expect(next.destinationDiscovery).toBeUndefined();
  });

  it("commits an approved version and removes every now-stale proposal", () => {
    const nextTrip = {
      ...trip,
      version: 2,
      request: {
        ...trip.request,
        constraints: [
          {
            id: "constraint:budget:all",
            category: "budget" as const,
            priority: "hard" as const,
            value: { maxTotal: { amount: 60_000, currency: "INR" as const } },
          },
        ],
      },
    };
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      itinerary: { request: trip.request, trip, projection },
      proposals: {
        "proposal:one": {
          proposal: {
            id: "proposal:one",
            baseTripVersion: 1,
            operations: [
              {
                type: "set_selection_lock",
                selectionId: "selection:stay",
                locked: true,
              },
            ],
          },
          preview: {
            proposalId: "proposal:one",
            nextTrip,
            changedSelectionIds: ["selection:stay"],
            preservedSelectionIds: [],
            changedCategories: ["locks"],
            budgetDelta: { amount: 0, currency: "INR" },
            validation: projection.validation,
          },
          projection,
          message: "Review lock",
        },
      },
    };

    const next = workspaceReducer(state, {
      type: "proposal_applied",
      trip: nextTrip,
      projection,
      entry: entry("message:applied", "assistant"),
    });

    expect(next.itinerary.trip).toBe(nextTrip);
    expect(next.itinerary.request).toBe(nextTrip.request);
    expect(next.proposals).toEqual({});
  });

  it("records an explanation without mutating canonical trip state", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      itinerary: { request: trip.request, trip, projection },
    };
    const started = workspaceReducer(state, {
      type: "explanation_started",
      entry: entry("message:why", "user"),
    });
    expect(started.asyncStatus).toBe("explaining");
    expect(started.itinerary.trip).toBe(trip);

    const result = {
      type: "explanation" as const,
      message: "The current trip is valid.",
      supportingFactIds: ["fact:trip:valid"],
      factBundle: {
        facts: [
          {
            id: "fact:trip:valid",
            subjectType: "trip" as const,
            subjectId: trip.id,
            dimension: "validation",
            label: "Current trip validation",
            value: true,
          },
        ],
        allowedComparisonDimensions: ["validation"],
        allowedFollowUpActions: [],
      },
      usedFallback: false,
    };
    const explained = workspaceReducer(started, {
      type: "explanation_received",
      result,
      entry: entry("message:because", "assistant"),
    });
    expect(explained.asyncStatus).toBe("idle");
    expect(explained.latestExplanation).toBe(result);
    expect(explained.itinerary.trip).toBe(trip);
    expect(explained.itinerary.projection).toBe(projection);
  });

  it("returns to idle when modification alternatives are ready", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      itinerary: { request: trip.request, trip, projection },
      asyncStatus: "modifying",
    };

    const next = workspaceReducer(state, {
      type: "modification_options_received",
      entry: entry("message:alternatives", "assistant"),
    });

    expect(next.asyncStatus).toBe("idle");
    expect(next.conversation.at(-1)?.id).toBe("message:alternatives");
    expect(next.itinerary.trip).toBe(trip);
  });
});
