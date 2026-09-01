import type { SpecifiedPlanApiResult } from "@/agent/plan-api";
import type { DestinationDiscoveryApiResult } from "@/agent/discovery";
import type { TripRequest, TripState } from "@/domain/model";
import type { TripProjection } from "@/domain/trip";
import type { ModificationResult } from "@/agent/modification-contracts";
import type { ProposalPreview, TripProposal } from "@/domain/proposals";
import type { ExplanationResult } from "@/agent/explanation-contracts";
import type { NaturalIntakeResponse } from "@/agent/natural-intake-contracts";
import type { InteractionPresentation } from "@/agent/interaction-contracts";
import type { ActiveInteraction } from "@/agent/conversation-contracts";
import { deriveActiveInteraction } from "@/agent/conversation-context";

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

export interface StoredProposal {
  proposal: TripProposal;
  preview: ProposalPreview;
  projection: TripProjection;
  message: string;
}

/**
 * The single durable itinerary document owned by the workspace.
 *
 * `request` is the current user-authored brief. Once a validated trip exists,
 * successful planning and proposal application replace all three members
 * atomically so the header, itinerary, and totals cannot describe different
 * revisions. `projection` is derived from `trip`; it is stored only to avoid
 * re-resolving inventory during rendering.
 */
export interface WorkspaceItinerary {
  request: TripRequest;
  trip?: TripState;
  projection?: TripProjection;
}

export interface WorkspaceState {
  itinerary: WorkspaceItinerary;
  proposals: Record<string, StoredProposal>;
  modificationConflict?: Extract<ModificationResult, { type: "conflict" }>;
  latestOutcome?: Exclude<SpecifiedPlanApiResult, { type: "trip_ready" }>;
  destinationDiscovery?: DestinationDiscoveryApiResult;
  latestExplanation?: ExplanationResult;
  latestIntake?: NaturalIntakeResponse;
  conversation: ConversationEntry[];
  interaction?: InteractionPresentation;
  activeInteraction?: ActiveInteraction;
  asyncStatus: "idle" | "interpreting" | "discovering" | "planning" | "modifying" | "explaining" | "applying" | "error";
  error?: WorkspaceError;
  optionalClarificationUsed: boolean;
}

export type WorkspaceAction =
  | { type: "workspace_restored"; state: WorkspaceState }
  | { type: "replace_request"; request: TripRequest }
  | { type: "conversation_entry_added"; entry: ConversationEntry }
  | { type: "interaction_updated"; interaction: InteractionPresentation }
  | { type: "interaction_cleared" }
  | { type: "conversation_started"; entry: ConversationEntry }
  | { type: "conversation_reply_received"; entry: ConversationEntry }
  | { type: "intake_started"; entry: ConversationEntry }
  | { type: "intake_received"; result: NaturalIntakeResponse; entry: ConversationEntry }
  | { type: "intake_failed"; error: WorkspaceError; entry: ConversationEntry }
  | { type: "discovery_started"; entry?: ConversationEntry }
  | {
      type: "discovery_received";
      result: DestinationDiscoveryApiResult;
      entry: ConversationEntry;
    }
  | { type: "destination_selected"; request: TripRequest }
  | { type: "planning_started"; entry?: ConversationEntry }
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
  | { type: "modification_started"; entry: ConversationEntry }
  | { type: "modification_options_received"; result?: Extract<ModificationResult, { type: "proposal" | "alternatives" }>; entry: ConversationEntry }
  | { type: "modification_conflict"; result: Extract<ModificationResult, { type: "conflict" }>; entry: ConversationEntry }
  | { type: "explanation_started"; entry: ConversationEntry }
  | { type: "explanation_received"; result: ExplanationResult; entry: ConversationEntry }
  | { type: "proposal_apply_started" }
  | { type: "proposal_applied"; trip: TripState; projection: TripProjection; entry: ConversationEntry }
  | { type: "adaptive_outcome_dismissed" }
  | { type: "clear_error" };

export const initialWorkspaceState: WorkspaceState = {
  itinerary: {
    request: {
      travellers: [],
      preferences: { interests: [] },
      constraints: [],
    },
  },
  proposals: {},
  conversation: [],
  asyncStatus: "idle",
  optionalClarificationUsed: false,
};

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "workspace_restored":
      return {
        ...action.state,
        asyncStatus: "idle",
        error: undefined,
      };
    case "replace_request":
      return {
        ...state,
        itinerary: { ...state.itinerary, request: action.request },
        destinationDiscovery: undefined,
      };
    case "conversation_entry_added":
      return {
        ...state,
        conversation: [...state.conversation, action.entry],
      };
    case "interaction_updated":
      return {
        ...state,
        interaction: action.interaction,
        activeInteraction: deriveActiveInteraction(state.itinerary.request, action.interaction),
      };
    case "interaction_cleared":
      return { ...state, interaction: undefined, activeInteraction: undefined };
    case "conversation_started":
      return {
        ...state,
        asyncStatus: "interpreting",
        error: undefined,
        latestExplanation: undefined,
        interaction: undefined,
        activeInteraction: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "conversation_reply_received":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "intake_started":
      return {
        ...state,
        asyncStatus: "interpreting",
        error: undefined,
        latestOutcome: undefined,
        destinationDiscovery: undefined,
        latestIntake: undefined,
        interaction: undefined,
        activeInteraction: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "intake_received":
      return {
        ...state,
        itinerary: { ...state.itinerary, request: action.result.request },
        latestIntake: action.result,
        interaction: state.interaction,
        asyncStatus: "idle",
        error: undefined,
        destinationDiscovery: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "intake_failed":
      return {
        ...state,
        asyncStatus: "error",
        error: action.error,
        conversation: [...state.conversation, action.entry],
      };
    case "discovery_started":
      return {
        ...state,
        asyncStatus: "discovering",
        error: undefined,
        latestOutcome: undefined,
        destinationDiscovery: undefined,
        modificationConflict: undefined,
        latestExplanation: undefined,
        interaction: undefined,
        activeInteraction: undefined,
        conversation: action.entry ? [...state.conversation, action.entry] : state.conversation,
      };
    case "discovery_received":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        destinationDiscovery: action.result,
        conversation: [...state.conversation, action.entry],
      };
    case "destination_selected":
      return {
        ...state,
        itinerary: { ...state.itinerary, request: action.request },
        destinationDiscovery: undefined,
        error: undefined,
      };
    case "planning_started":
      return {
        ...state,
        asyncStatus: "planning",
        error: undefined,
        latestOutcome: undefined,
        modificationConflict: undefined,
        latestExplanation: undefined,
        interaction: undefined,
        activeInteraction: undefined,
        conversation: action.entry ? [...state.conversation, action.entry] : state.conversation,
      };
    case "planning_succeeded":
      return {
        ...state,
        itinerary: {
          request: action.result.trip.request,
          trip: action.result.trip,
          projection: action.result.projection,
        },
        latestOutcome: undefined,
        asyncStatus: "idle",
        error: undefined,
        proposals: {},
        modificationConflict: undefined,
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
    case "modification_started":
      return {
        ...state,
        asyncStatus: "modifying",
        error: undefined,
        latestOutcome: undefined,
        modificationConflict: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "modification_options_received": {
      const options = action.result?.type === "alternatives"
        ? action.result.options
        : action.result ? [{
            proposal: action.result.proposal,
            preview: action.result.preview,
            projection: action.result.projection,
            message: action.result.message,
          }] : [];
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        modificationConflict: undefined,
        proposals: {
          ...state.proposals,
          ...Object.fromEntries(options.map((option) => [option.proposal.id, option])),
        },
        conversation: [...state.conversation, action.entry],
      };
    }
    case "modification_conflict":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        modificationConflict: action.result,
        proposals: {
          ...state.proposals,
          ...Object.fromEntries(
            action.result.proposals.map((option) => [
              option.proposal.id,
              {
                proposal: option.proposal,
                preview: option.preview,
                projection: option.projection,
                message: option.message,
              },
            ]),
          ),
        },
        conversation: [...state.conversation, action.entry],
      };
    case "explanation_started":
      return {
        ...state,
        asyncStatus: "explaining",
        error: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "explanation_received":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        latestExplanation: action.result,
        conversation: [...state.conversation, action.entry],
      };
    case "proposal_apply_started":
      return { ...state, asyncStatus: "applying", error: undefined };
    case "proposal_applied":
      return {
        ...state,
        itinerary: {
          request: action.trip.request,
          trip: action.trip,
          projection: action.projection,
        },
        proposals: {},
        modificationConflict: undefined,
        latestExplanation: undefined,
        interaction: undefined,
        activeInteraction: undefined,
        asyncStatus: "idle",
        error: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "adaptive_outcome_dismissed":
      return {
        ...state,
        latestOutcome:
          state.latestOutcome?.type === "conflict" ? undefined : state.latestOutcome,
        modificationConflict: undefined,
      };
    case "clear_error":
      return { ...state, asyncStatus: "idle", error: undefined };
  }
}
