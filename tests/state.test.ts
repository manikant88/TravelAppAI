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

  it("stores destination options without mutating an existing committed trip", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      committedTrip: trip,
      projection,
      draftRequest: { ...request, destination: { kind: "open" } },
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
    expect(next.committedTrip).toBe(trip);
    expect(next.projection).toBe(projection);
    expect(next.draftRequest.destination).toEqual({ kind: "open" });
  });

  it("applies a selected destination only to the draft before PLAN", () => {
    const openDraft: TripRequest = { ...request, destination: { kind: "open" } };
    const selectedDraft: TripRequest = {
      ...openDraft,
      destination: { kind: "specified", locationId: "city:goa" },
    };
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      draftRequest: openDraft,
      committedTrip: trip,
      projection,
    };

    const next = workspaceReducer(state, {
      type: "destination_selected",
      request: selectedDraft,
    });

    expect(next.draftRequest).toBe(selectedDraft);
    expect(next.committedTrip).toBe(trip);
    expect(next.projection).toBe(projection);
    expect(next.destinationDiscovery).toBeUndefined();
  });

  it("stores a proposal without mutating the committed trip", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      committedTrip: trip,
      projection,
    };
    const proposal = {
      id: "proposal:lock",
      baseTripVersion: 1,
      operations: [
        {
          type: "set_selection_lock" as const,
          selectionId: "selection:stay",
          locked: true,
        },
      ],
    };
    const preview = {
      proposalId: proposal.id,
      nextTrip: { ...trip, version: 2 },
      changedSelectionIds: ["selection:stay"],
      preservedSelectionIds: [],
      changedCategories: ["locks" as const],
      budgetDelta: { amount: 0, currency: "INR" as const },
      validation: projection.validation,
    };

    const next = workspaceReducer(state, {
      type: "proposal_previewed",
      stored: { proposal, preview, projection, message: "Review lock" },
      entry: entry("message:proposal", "assistant"),
    });

    expect(next.committedTrip).toBe(trip);
    expect(next.activeProposalId).toBe(proposal.id);
    expect(next.proposals[proposal.id]?.preview).toBe(preview);
  });

  it("stores valid alternatives read-only and opens only the selected proposal", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      committedTrip: trip,
      projection,
    };
    const makeOption = (index: number) => {
      const proposal = {
        id: `proposal:${index}`,
        baseTripVersion: trip.version,
        operations: [{
          type: "set_selection_lock" as const,
          selectionId: `selection:${index}`,
          locked: true,
        }],
      };
      return {
        optionId: `offer:${index}`,
        proposal,
        preview: {
          proposalId: proposal.id,
          nextTrip: { ...trip, version: 2 },
          changedSelectionIds: [`selection:${index}`],
          preservedSelectionIds: [],
          changedCategories: ["locks" as const],
          budgetDelta: { amount: 0, currency: "INR" as const },
          validation: projection.validation,
        },
        projection,
        message: `Option ${index}`,
      };
    };
    const first = makeOption(1);
    const second = makeOption(2);
    const result = {
      type: "alternatives" as const,
      options: [first, second],
      block: {
        type: "option_comparison" as const,
        entityType: "stay" as const,
        choices: [
          { optionId: first.optionId, proposalId: first.proposal.id },
          { optionId: second.optionId, proposalId: second.proposal.id },
        ],
        emphasis: { recommendedId: second.optionId },
      },
      factBundle: {
        facts: [],
        allowedComparisonDimensions: [],
        allowedFollowUpActions: [],
      },
      message: "Compare valid alternatives",
    };

    const compared = workspaceReducer(state, {
      type: "alternatives_received",
      result,
      entry: entry("message:alternatives", "assistant"),
    });
    expect(compared.committedTrip).toBe(trip);
    expect(compared.activeProposalId).toBeUndefined();
    expect(Object.keys(compared.proposals)).toEqual([first.proposal.id, second.proposal.id]);

    const selected = workspaceReducer(compared, {
      type: "alternative_selected",
      proposalId: second.proposal.id,
    });
    expect(selected.committedTrip).toBe(trip);
    expect(selected.activeProposalId).toBe(second.proposal.id);
    expect(selected.modificationAlternatives).toBeUndefined();
  });

  it("commits an approved version and removes every now-stale proposal", () => {
    const nextTrip = { ...trip, version: 2 };
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      committedTrip: trip,
      projection,
      activeProposalId: "proposal:one",
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

    expect(next.committedTrip).toBe(nextTrip);
    expect(next.proposals).toEqual({});
    expect(next.activeProposalId).toBeUndefined();
  });

  it("records an explanation without mutating canonical trip state", () => {
    const state: WorkspaceState = {
      ...initialWorkspaceState,
      committedTrip: trip,
      projection,
    };
    const started = workspaceReducer(state, {
      type: "explanation_started",
      entry: entry("message:why", "user"),
    });
    expect(started.asyncStatus).toBe("explaining");
    expect(started.committedTrip).toBe(trip);

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
    expect(explained.committedTrip).toBe(trip);
    expect(explained.projection).toBe(projection);
  });
});
