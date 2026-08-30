import { z } from "zod";
import type { TripState } from "@/domain/model";
import type { TripProjection } from "@/domain/trip";
import type { TripProposal } from "@/domain/proposals";
import type { ActivityOffer, StayOffer, TransportOffer } from "@/inventory/contracts";

export type GroupRoomStatus = "voting" | "finalized";
export type GroupDecisionKind = "travel" | "stay" | "activity";

export interface CandidateSummary {
  title: string;
  detail: string;
  priceLabel: string;
  imageUrl?: string;
  explanation?: string;
  conflicts?: string[];
  costDelta?: number;
}

export interface GroupCandidate {
  id: string;
  offerId: string;
  offer?: TransportOffer | StayOffer | ActivityOffer;
  summary: CandidateSummary;
  source: "itinerary" | "recommendation";
  recommendedByParticipantId?: string;
  createdAt: string;
}

export interface GroupDecision {
  id: string;
  selectionId?: string;
  kind: GroupDecisionKind;
  mode?: "replace" | "add";
  date?: string;
  locationId?: string;
  label: string;
  currentOfferId: string;
  candidates: GroupCandidate[];
  finalizedCandidateId?: string;
}

export interface GroupParticipant {
  id: string;
  displayName: string;
  token: string;
  joinedAt: string;
}

export interface GroupInvitation {
  id: string;
  displayName?: string;
  participantId?: string;
  createdAt: string;
}

export interface GroupVote {
  decisionId: string;
  participantId: string;
  candidateId: string;
  updatedAt: string;
}

export interface GroupRoom {
  id: string;
  organizerToken: string;
  status: GroupRoomStatus;
  trip: TripState;
  projection: TripProjection;
  decisions: GroupDecision[];
  organizerParticipantId: string;
  invitations: GroupInvitation[];
  participants: GroupParticipant[];
  votes: GroupVote[];
  createdAt: string;
  finalizedAt?: string;
  revision: number;
}

export interface PublicGroupRoom extends Omit<GroupRoom, "organizerToken" | "participants"> {
  participants: Array<Omit<GroupParticipant, "token">>;
  viewer?: {
    participantId?: string;
    organizer: boolean;
  };
}

const idSchema = z.string().trim().min(1).max(240);
export const createRoomSchema = z.object({
  trip: z.unknown(),
  projection: z.unknown(),
}).strict();

export const joinRoomSchema = z.object({
  action: z.literal("join"),
  displayName: z.string().trim().min(1).max(40),
}).strict();

export const voteSchema = z.object({
  action: z.literal("vote"),
  participantToken: idSchema,
  decisionId: idSchema,
  candidateId: idSchema,
}).strict();

export const recommendSchema = z.object({
  action: z.literal("recommend"),
  participantToken: idSchema,
  decisionId: idSchema,
  offerId: idSchema,
}).strict();

export const finalizeSchema = z.object({
  action: z.literal("finalize"),
  organizerToken: idSchema,
}).strict();

export const roomActionSchema = z.discriminatedUnion("action", [
  joinRoomSchema,
  voteSchema,
  recommendSchema,
  finalizeSchema,
]);

export interface DecisionResult {
  leaderCandidateId?: string;
  highestVoteCount: number;
  tied: boolean;
  totalVotes: number;
}

export function decisionResult(room: Pick<GroupRoom, "decisions" | "votes">, decisionId: string): DecisionResult {
  const decision = room.decisions.find((item) => item.id === decisionId);
  if (!decision) return { highestVoteCount: 0, tied: false, totalVotes: 0 };
  const counts = new Map(decision.candidates.map((candidate) => [candidate.id, 0]));
  for (const vote of room.votes.filter((item) => item.decisionId === decisionId)) {
    counts.set(vote.candidateId, (counts.get(vote.candidateId) ?? 0) + 1);
  }
  const highestVoteCount = Math.max(0, ...counts.values());
  const leaders = highestVoteCount > 0
    ? [...counts.entries()].filter(([, count]) => count === highestVoteCount).map(([id]) => id)
    : [];
  return {
    leaderCandidateId: leaders.length === 1 ? leaders[0] : undefined,
    highestVoteCount,
    tied: leaders.length > 1,
    totalVotes: room.votes.filter((item) => item.decisionId === decisionId).length,
  };
}

export function voteForCandidate(
  room: GroupRoom,
  participantToken: string,
  decisionId: string,
  candidateId: string,
  now = new Date().toISOString(),
): GroupRoom {
  if (room.status !== "voting") throw new Error("Voting has closed for this trip");
  const participant = room.participants.find((item) => item.token === participantToken);
  if (!participant) throw new Error("Join the trip before voting");
  const decision = room.decisions.find((item) => item.id === decisionId);
  if (!decision) throw new Error("Unknown voting decision");
  if (!decision.candidates.some((item) => item.id === candidateId)) {
    throw new Error("Unknown candidate");
  }
  return {
    ...room,
    revision: room.revision + 1,
    votes: [
      ...room.votes.filter(
        (item) => !(item.decisionId === decisionId && item.participantId === participant.id),
      ),
      { decisionId, participantId: participant.id, candidateId, updatedAt: now },
    ],
  };
}

export function addRecommendation(
  room: GroupRoom,
  participantToken: string,
  decisionId: string,
  offerId: string,
  summary: CandidateSummary,
  candidateId: string,
  offer?: TransportOffer | StayOffer | ActivityOffer,
  now = new Date().toISOString(),
): GroupRoom {
  if (room.status !== "voting") throw new Error("Recommendations are closed for this trip");
  const participant = room.participants.find((item) => item.token === participantToken);
  if (!participant) throw new Error("Join the trip before recommending an option");
  const decision = room.decisions.find((item) => item.id === decisionId);
  if (!decision) throw new Error("Unknown voting decision");
  if (decision.candidates.some((item) => item.offerId === offerId)) return room;
  if (decision.candidates.length >= 4) {
    throw new Error("This decision already has the maximum of four options");
  }
  if (decision.candidates.some((item) => item.recommendedByParticipantId === participant.id)) {
    throw new Error("You can recommend one option for each decision");
  }
  const candidate: GroupCandidate = {
    id: candidateId,
    offerId,
    offer,
    summary,
    source: "recommendation",
    recommendedByParticipantId: participant.id,
    createdAt: now,
  };
  return {
    ...room,
    revision: room.revision + 1,
    decisions: room.decisions.map((item) => item.id === decisionId
      ? { ...item, candidates: [...item.candidates, candidate] }
      : item),
  };
}

export function buildFinalizationProposal(room: GroupRoom): TripProposal {
  if (room.status !== "voting") throw new Error("This trip is already finalized");
  const operations: TripProposal["operations"] = [];
  const selections = [
    ...room.trip.selectedTravel,
    ...room.trip.selectedStays,
    ...room.trip.selectedActivities,
  ];

  for (const decision of room.decisions) {
    const result = decisionResult(room, decision.id);
    if (result.tied) throw new Error(`${decision.label} has a tied vote`);
    const winner = decision.candidates.find(
      (candidate) => candidate.id === (result.leaderCandidateId ?? decision.candidates[0]?.id),
    );
    if (decision.mode === "add") {
      if (!result.leaderCandidateId || !winner) continue;
      operations.push({
        type: "add_activity",
        nextOfferId: winner.offerId,
        travellerIds: room.trip.request.travellers.map((traveller) => traveller.id),
      });
      continue;
    }
    const selection = selections.find((item) => item.id === decision.selectionId);
    if (!winner || !selection) throw new Error(`Cannot finalize ${decision.label}`);

    if (winner.offerId !== selection.offerId) {
      if (selection.locked) {
        operations.push({ type: "set_selection_lock", selectionId: selection.id, locked: false });
      }
      operations.push(
        decision.kind === "travel"
          ? { type: "replace_travel", selectionId: selection.id, nextOfferId: winner.offerId }
          : decision.kind === "stay"
            ? { type: "replace_stay", selectionId: selection.id, nextOfferId: winner.offerId }
            : { type: "replace_activity", selectionId: selection.id, nextOfferId: winner.offerId },
      );
      operations.push({ type: "set_selection_lock", selectionId: selection.id, locked: true });
    } else if (!selection.locked) {
      operations.push({ type: "set_selection_lock", selectionId: selection.id, locked: true });
    }
  }

  if (operations.length === 0) throw new Error("Every group choice is already finalized");
  return {
    id: `proposal:group-finalize:${room.id}`,
    baseTripVersion: room.trip.version,
    operations,
  };
}

export function publicRoom(
  room: GroupRoom,
  participantToken?: string,
  organizerToken?: string,
): PublicGroupRoom {
  const { organizerToken: _organizerToken, participants, ...safeRoom } = room;
  return {
    ...safeRoom,
    participants: participants.map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      joinedAt: participant.joinedAt,
    })),
    viewer: {
      participantId: participants.find((item) => item.token === participantToken)?.id,
      organizer: Boolean(organizerToken && organizerToken === _organizerToken),
    },
  };
}
