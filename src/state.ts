import type { SpecifiedPlanApiResult } from "@/agent/plan-api";
import type { DestinationDiscoveryApiResult } from "@/agent/discovery";
import type { TripRequest, TripState } from "@/domain/model";
import type { TripProjection } from "@/domain/trip";
import type { ModificationResult } from "@/agent/modification-contracts";
import type { ProposalPreview, TripProposal } from "@/domain/proposals";
import type { ExplanationResult } from "@/agent/explanation-contracts";
import type { NaturalIntakeResponse } from "@/agent/natural-intake-contracts";

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

export interface WorkspaceState {
  draftRequest: TripRequest;
  committedTrip?: TripState;
  projection?: TripProjection;
  proposals: Record<string, StoredProposal>;
  activeProposalId?: string;
  modificationConflict?: Extract<ModificationResult, { type: "conflict" }>;
  modificationAlternatives?: Extract<ModificationResult, { type: "alternatives" }>;
  latestOutcome?: Exclude<SpecifiedPlanApiResult, { type: "trip_ready" }>;
  destinationDiscovery?: DestinationDiscoveryApiResult;
  latestExplanation?: ExplanationResult;
  latestIntake?: NaturalIntakeResponse;
  conversation: ConversationEntry[];
  asyncStatus: "idle" | "interpreting" | "discovering" | "planning" | "modifying" | "explaining" | "applying" | "error";
  error?: WorkspaceError;
  optionalClarificationUsed: boolean;
}

export type WorkspaceAction =
  | { type: "replace_draft"; request: TripRequest }
  | { type: "conversation_entry_added"; entry: ConversationEntry }
  | { type: "conversation_started"; entry: ConversationEntry }
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
  | { type: "proposal_received"; result: Extract<ModificationResult, { type: "proposal" }>; entry: ConversationEntry }
  | { type: "alternatives_received"; result: Extract<ModificationResult, { type: "alternatives" }>; entry: ConversationEntry }
  | { type: "alternative_selected"; proposalId: string }
  | { type: "modification_conflict"; result: Extract<ModificationResult, { type: "conflict" }>; entry: ConversationEntry }
  | { type: "explanation_started"; entry: ConversationEntry }
  | { type: "explanation_received"; result: ExplanationResult; entry: ConversationEntry }
  | { type: "proposal_preview_started" }
  | { type: "proposal_previewed"; stored: StoredProposal; entry: ConversationEntry }
  | { type: "proposal_apply_started" }
  | { type: "proposal_applied"; trip: TripState; projection: TripProjection; entry: ConversationEntry }
  | { type: "proposal_dismissed"; proposalId: string }
  | { type: "adaptive_outcome_dismissed" }
  | { type: "clear_error" };

export const initialWorkspaceState: WorkspaceState = {
  draftRequest: {
    travellers: [],
    preferences: { interests: [] },
    constraints: [],
  },
  proposals: {},
  conversation: [
    {
      id: "message:welcome",
      role: "assistant",
      text: "I’d love to help you build a great trip. Tell me where you’re leaving from and where you’d like to go—or ask me to suggest a destination.",
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
      return {
        ...state,
        draftRequest: action.request,
        destinationDiscovery: undefined,
      };
    case "conversation_entry_added":
      return {
        ...state,
        conversation: [...state.conversation, action.entry],
      };
    case "conversation_started":
      return {
        ...state,
        asyncStatus: "interpreting",
        error: undefined,
        latestExplanation: undefined,
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
        conversation: [...state.conversation, action.entry],
      };
    case "intake_received":
      return {
        ...state,
        draftRequest: action.result.request,
        latestIntake: action.result,
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
        modificationAlternatives: undefined,
        latestExplanation: undefined,
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
        draftRequest: action.request,
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
        modificationAlternatives: undefined,
        latestExplanation: undefined,
        conversation: action.entry ? [...state.conversation, action.entry] : state.conversation,
      };
    case "planning_succeeded":
      return {
        ...state,
        committedTrip: action.result.trip,
        projection: action.result.projection,
        latestOutcome: undefined,
        asyncStatus: "idle",
        error: undefined,
        proposals: {},
        activeProposalId: undefined,
        modificationConflict: undefined,
        modificationAlternatives: undefined,
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
        modificationAlternatives: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "proposal_received":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        modificationConflict: undefined,
        modificationAlternatives: undefined,
        activeProposalId: action.result.proposal.id,
        proposals: {
          ...state.proposals,
          [action.result.proposal.id]: {
            proposal: action.result.proposal,
            preview: action.result.preview,
            projection: action.result.projection,
            message: action.result.message,
          },
        },
        conversation: [...state.conversation, action.entry],
      };
    case "alternatives_received":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        modificationConflict: undefined,
        modificationAlternatives: action.result,
        activeProposalId: undefined,
        proposals: {
          ...state.proposals,
          ...Object.fromEntries(
            action.result.options.map((option) => [
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
    case "alternative_selected":
      return state.proposals[action.proposalId]
        ? {
            ...state,
            activeProposalId: action.proposalId,
            modificationAlternatives: undefined,
            modificationConflict: undefined,
          }
        : state;
    case "modification_conflict":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        modificationConflict: action.result,
        modificationAlternatives: undefined,
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
    case "proposal_preview_started":
      return { ...state, asyncStatus: "modifying", error: undefined };
    case "proposal_previewed":
      return {
        ...state,
        asyncStatus: "idle",
        error: undefined,
        activeProposalId: action.stored.proposal.id,
        proposals: {
          ...state.proposals,
          [action.stored.proposal.id]: action.stored,
        },
        conversation: [...state.conversation, action.entry],
      };
    case "proposal_apply_started":
      return { ...state, asyncStatus: "applying", error: undefined };
    case "proposal_applied":
      return {
        ...state,
        draftRequest: action.trip.request,
        committedTrip: action.trip,
        projection: action.projection,
        proposals: {},
        activeProposalId: undefined,
        modificationConflict: undefined,
        modificationAlternatives: undefined,
        latestExplanation: undefined,
        asyncStatus: "idle",
        error: undefined,
        conversation: [...state.conversation, action.entry],
      };
    case "proposal_dismissed": {
      const proposals = { ...state.proposals };
      delete proposals[action.proposalId];
      return {
        ...state,
        draftRequest: state.committedTrip?.request ?? state.draftRequest,
        proposals,
        activeProposalId:
          state.activeProposalId === action.proposalId
            ? undefined
            : state.activeProposalId,
      };
    }
    case "adaptive_outcome_dismissed":
      return {
        ...state,
        latestOutcome:
          state.latestOutcome?.type === "conflict" ? undefined : state.latestOutcome,
        modificationConflict: undefined,
        modificationAlternatives: undefined,
      };
    case "clear_error":
      return { ...state, asyncStatus: "idle", error: undefined };
  }
}
