import type { SpecifiedPlanApiResult } from "@/agent/plan-api";
import type { TripRequest, TripState } from "@/domain/model";
import type { TripProjection } from "@/domain/trip";

export interface ConversationEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface WorkspaceError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface WorkspaceState {
  draftRequest: TripRequest;
  committedTrip?: TripState;
  projection?: TripProjection;
  proposals: Record<string, never>;
  latestOutcome?: Exclude<SpecifiedPlanApiResult, { type: "trip_ready" }>;
  conversation: ConversationEntry[];
  asyncStatus: "idle" | "planning" | "error";
  error?: WorkspaceError;
  optionalClarificationUsed: boolean;
}

export type WorkspaceAction =
  | { type: "replace_draft"; request: TripRequest }
  | { type: "planning_started"; entry: ConversationEntry }
  | {
      type: "planning_succeeded";
      result: Extract<SpecifiedPlanApiResult, { type: "trip_ready" }>;
      entry: ConversationEntry;
    }
  | {
      type: "outcome_received";
      outcome: Exclude<SpecifiedPlanApiResult, { type: "trip_ready" }>;
      entry: ConversationEntry;
    }
  | { type: "planning_failed"; error: WorkspaceError; entry: ConversationEntry }
  | { type: "clear_error" };

export const initialWorkspaceState: WorkspaceState = {
  draftRequest: {
    travellers: [
      { id: "traveller:1", type: "adult" },
      { id: "traveller:2", type: "adult" },
    ],
    preferences: { pace: "balanced", interests: [] },
    constraints: [],
  },
  proposals: {},
  conversation: [
    {
      id: "message:welcome",
      role: "assistant",
      text: "Tell me the trip essentials. I’ll search grounded inventory, assemble a connected plan, and validate it before anything becomes your trip.",
    },
  ],
  asyncStatus: "idle",
  optionalClarificationUsed: false,
};

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "replace_draft":
      return { ...state, draftRequest: action.request };
    case "planning_started":
      return {
        ...state,
        asyncStatus: "planning",
        error: undefined,
        latestOutcome: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "planning_succeeded":
      return {
        ...state,
        committedTrip: action.result.trip,
        projection: action.result.projection,
        latestOutcome: undefined,
        asyncStatus: "idle",
        error: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "outcome_received":
      return {
        ...state,
        latestOutcome: action.outcome,
        asyncStatus: "idle",
        error: undefined,
        optionalClarificationUsed:
          state.optionalClarificationUsed || action.outcome.type === "clarification",
        conversation: [...state.conversation, action.entry],
      };
    case "planning_failed":
      return {
        ...state,
        asyncStatus: "error",
        error: action.error,
        conversation: [...state.conversation, action.entry],
      };
    case "clear_error":
      return { ...state, asyncStatus: "idle", error: undefined };
  }
}
