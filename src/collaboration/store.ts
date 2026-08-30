import { randomUUID } from "node:crypto";
import {
  addRecommendation,
  buildFinalizationProposal,
  decisionResult,
  publicRoom,
  voteForCandidate,
  type CandidateSummary,
  type GroupDecision,
  type GroupDecisionKind,
  type GroupRoom,
  type PublicGroupRoom,
} from "@/collaboration/model";
import type { TripState } from "@/domain/model";
import { commitProposal } from "@/domain/proposal-service";
import { tripStateSchema, type HydratedSelection, type TripProjection } from "@/domain/trip";
import type { ActivityOffer, StayOffer, TransferOffer, TransportOffer } from "@/inventory/contracts";
import { createInventoryRepository } from "@/inventory/repository";
import { resolveOffer } from "@/inventory/service";
import { composeCommunication } from "@/agent/communication";
import { createOpenAICommunicationModel } from "@/agent/model";

declare global {
  var __groupVotingRooms: Map<string, GroupRoom> | undefined;
}

const rooms = globalThis.__groupVotingRooms ?? new Map<string, GroupRoom>();
globalThis.__groupVotingRooms = rooms;

function money(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours}h` : undefined, rest ? `${rest}m` : undefined].filter(Boolean).join(" ");
}

function isTransport(offer: HydratedSelection["offer"]): offer is TransportOffer {
  return "serviceId" in offer;
}

function isTransfer(offer: HydratedSelection["offer"]): offer is TransferOffer {
  return "transferId" in offer;
}

function isStay(offer: HydratedSelection["offer"]): offer is StayOffer {
  return "roomOfferId" in offer;
}

function isActivity(offer: HydratedSelection["offer"]): offer is ActivityOffer {
  return "sessionId" in offer;
}

type CandidateOffer = TransportOffer | StayOffer | ActivityOffer;

function costFor(offer: CandidateOffer, travellerCount: number): number {
  if (isStay(offer)) {
    const nights = Math.max(1, Math.round(
      (Date.parse(`${offer.checkOut}T00:00:00Z`) - Date.parse(`${offer.checkIn}T00:00:00Z`)) / 86_400_000,
    ));
    return offer.price.amount * offer.rooms * nights;
  }
  return offer.price.amount * travellerCount;
}

function overlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  return Date.parse(leftStart) < Date.parse(rightEnd) && Date.parse(rightStart) < Date.parse(leftEnd);
}

function consequenceFacts(
  room: Pick<GroupRoom, "projection" | "trip">,
  decision: GroupDecision,
  offer: CandidateOffer,
): Pick<CandidateSummary, "conflicts" | "costDelta"> {
  const current = room.projection.hydratedSelections.find((item) => item.selectionId === decision.selectionId)?.offer;
  if (!current || isTransfer(current)) return { conflicts: [] };
  const conflicts: string[] = [];
  if (isActivity(offer)) {
    for (const item of room.projection.hydratedSelections) {
      if (item.selectionId === decision.selectionId || !isActivity(item.offer)) continue;
      if (overlap(offer.startsAt, offer.endsAt, item.offer.startsAt, item.offer.endsAt)) {
        const minutes = Math.max(1, Math.round(
          (Math.min(Date.parse(offer.endsAt), Date.parse(item.offer.endsAt)) - Math.max(Date.parse(offer.startsAt), Date.parse(item.offer.startsAt))) / 60_000,
        ));
        conflicts.push(`Overlaps ${item.offer.activityFacts.name} by ${minutes} minutes`);
      }
    }
  }
  if (isTransport(offer)) {
    for (const item of room.projection.hydratedSelections) {
      if (!isActivity(item.offer)) continue;
      if (overlap(offer.departureAt, offer.arrivalAt, item.offer.startsAt, item.offer.endsAt)) {
        conflicts.push(`Overlaps ${item.offer.activityFacts.name}`);
      }
    }
  }
  return {
    conflicts,
    costDelta: costFor(offer, room.trip.request.travellers.length) - costFor(current as CandidateOffer, room.trip.request.travellers.length),
  };
}

function assertCandidateMatchesDecision(room: Pick<GroupRoom, "projection">, decision: GroupDecision, offer: HydratedSelection["offer"]): asserts offer is CandidateOffer {
  const current = room.projection.hydratedSelections.find((item) => item.selectionId === decision.selectionId)?.offer;
  if (!current) throw new Error("The current itinerary option is unavailable");
  if (decision.kind === "travel") {
    if (!isTransport(offer) || !isTransport(current) || offer.from !== current.from || offer.to !== current.to || offer.departureAt.slice(0, 10) !== current.departureAt.slice(0, 10)) {
      throw new Error("The recommended travel option does not match this route and date");
    }
    return;
  }
  if (decision.kind === "stay") {
    if (!isStay(offer) || !isStay(current) || offer.locationId !== current.locationId || offer.checkIn !== current.checkIn || offer.checkOut !== current.checkOut) {
      throw new Error("The recommended stay does not match this stop and date range");
    }
    return;
  }
  if (!isActivity(offer) || !isActivity(current) || offer.locationId !== current.locationId || offer.startsAt.slice(0, 10) !== current.startsAt.slice(0, 10)) {
    throw new Error("The recommended activity does not match this itinerary day");
  }
}

async function explainCandidate(summary: CandidateSummary): Promise<string> {
  const delta = summary.costDelta ?? 0;
  const fallback = summary.conflicts?.length
    ? `${summary.title} is available as an alternative, but ${summary.conflicts[0]!.charAt(0).toLowerCase()}${summary.conflicts[0]!.slice(1)}. The organizer will need to resolve this before finalizing.`
    : delta === 0
      ? `${summary.title} keeps the group cost unchanged and is available as an alternative for this itinerary slot.`
      : `${summary.title} changes the group total by ${money(Math.abs(delta))} ${delta < 0 ? "less" : "more"} for this selection.`;
  const modelName = process.env.OPENAI_MODEL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const output = await composeCommunication({
    intent: "explain",
    fallbackMessage: fallback,
    facts: [summary.title, summary.detail, summary.priceLabel, `Group cost delta INR ${delta}`, ...(summary.conflicts ?? [])],
    events: [],
    availableActions: [],
  }, modelName && apiKey ? createOpenAICommunicationModel({ model: modelName, apiKey, timeoutMs: 2_500 }) : undefined);
  return output.message;
}

export function candidateSummary(offer: HydratedSelection["offer"]): CandidateSummary {
  if (isTransport(offer)) {
    return {
      title: `${offer.operator} · ${offer.mode}`,
      detail: `${offer.from.split(":").at(-1)?.toUpperCase()} → ${offer.to.split(":").at(-1)?.toUpperCase()} · ${duration(offer.durationMinutes)} · ${offer.stops === 0 ? "Non-stop" : `${offer.stops} stop`}`,
      priceLabel: `${money(offer.price.amount)} per traveller`,
    };
  }
  if (isTransfer(offer)) {
    return {
      title: `${offer.mode === "shared" ? "Shared" : "Private"} transfer`,
      detail: `${offer.from.split(":").at(-1)} → ${offer.to.split(":").at(-1)} · ${duration(offer.durationMinutes)}`,
      priceLabel: `${money(offer.price.amount)} per vehicle`,
    };
  }
  if (isStay(offer)) {
    const nights = Math.max(1, Math.round(
      (Date.parse(`${offer.checkOut}T00:00:00Z`) - Date.parse(`${offer.checkIn}T00:00:00Z`)) / 86_400_000,
    ));
    return {
      title: offer.propertyFacts.name,
      detail: `${offer.roomFacts.roomLabel} · ${offer.rooms} room${offer.rooms === 1 ? "" : "s"} · ${offer.propertyFacts.rating.toFixed(1)} rating`,
      priceLabel: `${money(offer.price.amount * offer.rooms * nights)} total stay`,
      imageUrl: offer.propertyFacts.imageUrl,
    };
  }
  return {
    title: offer.activityFacts.name,
    detail: `${new Date(offer.startsAt).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} · ${duration(Math.round((Date.parse(offer.endsAt) - Date.parse(offer.startsAt)) / 60_000))}`,
    priceLabel: `${money(offer.price.amount)} per person`,
    imageUrl: offer.activityFacts.imageUrl,
  };
}

function decisionLabel(kind: GroupDecisionKind, index: number, offer: HydratedSelection["offer"]): string {
  if (kind === "travel" && isTransport(offer)) {
    return `${index === 0 ? "Outbound" : "Return"} ${offer.mode}`;
  }
  if (kind === "stay") return "Group stay";
  if (kind === "activity" && isActivity(offer)) {
    return `Activity · ${new Date(offer.startsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`;
  }
  return kind;
}

function initialDecisions(trip: TripState, projection: TripProjection, now: string): GroupDecision[] {
  const selected = [
    ...trip.selectedTravel.filter((item) => item.offerKind === "transport").map((item) => ({ kind: "travel" as const, selection: item })),
    ...trip.selectedStays.map((item) => ({ kind: "stay" as const, selection: item })),
    ...trip.selectedActivities.map((item) => ({ kind: "activity" as const, selection: item })),
  ];
  const travelIndexes = new Map<string, number>();
  let travelIndex = 0;
  for (const item of selected.filter((entry) => entry.kind === "travel")) {
    travelIndexes.set(item.selection.id, travelIndex++);
  }
  return selected.map(({ kind, selection }) => {
    const hydrated = projection.hydratedSelections.find((item) => item.selectionId === selection.id);
    if (!hydrated) throw new Error(`Missing projection for ${selection.id}`);
    const decisionId = `decision:${randomUUID()}`;
    return {
      id: decisionId,
      selectionId: selection.id,
      kind,
      label: decisionLabel(kind, travelIndexes.get(selection.id) ?? 0, hydrated.offer),
      currentOfferId: selection.offerId,
      candidates: [{
        id: `candidate:${randomUUID()}`,
        offerId: selection.offerId,
        offer: isTransfer(hydrated.offer) ? undefined : hydrated.offer,
        summary: candidateSummary(hydrated.offer),
        source: "itinerary",
        createdAt: now,
      }],
    };
  });
}

function requireRoom(roomId: string): GroupRoom {
  const room = rooms.get(roomId);
  if (!room) throw new Error("This shared trip room is unavailable");
  return room;
}

export function createGroupRoom(rawTrip: unknown, rawProjection: unknown): {
  room: PublicGroupRoom;
  organizerToken: string;
} {
  const trip = tripStateSchema.parse(rawTrip) as TripState;
  const projection = rawProjection as TripProjection;
  if (!projection || !Array.isArray(projection.hydratedSelections) || !projection.budget) {
    throw new Error("A valid trip projection is required");
  }
  const id = randomUUID().slice(0, 10);
  const organizerToken = randomUUID();
  const now = new Date().toISOString();
  const organizerParticipantId = `participant:${randomUUID()}`;
  const room: GroupRoom = {
    id,
    organizerToken,
    status: "voting",
    trip,
    projection,
    decisions: initialDecisions(trip, projection, now),
    organizerParticipantId,
    invitations: Array.from({ length: Math.max(0, trip.request.travellers.length - 1) }, () => ({
      id: `invite:${randomUUID()}`,
      createdAt: now,
    })),
    participants: [{
      id: organizerParticipantId,
      displayName: "You",
      token: organizerToken,
      joinedAt: now,
    }],
    votes: [],
    createdAt: now,
    revision: 1,
  };
  rooms.set(id, room);
  return { room: publicRoom(room, organizerToken, organizerToken), organizerToken };
}

export function getGroupRoom(roomId: string, participantToken?: string, organizerToken?: string): PublicGroupRoom {
  return publicRoom(requireRoom(roomId), participantToken, organizerToken);
}

export function joinGroupRoom(roomId: string, displayName: string): { room: PublicGroupRoom; participantToken: string } {
  const room = requireRoom(roomId);
  if (room.status !== "voting") throw new Error("This trip has already been finalized");
  const token = randomUUID();
  const participant = {
    id: `participant:${randomUUID()}`,
    displayName: displayName.trim(),
    token,
    joinedAt: new Date().toISOString(),
  };
  const next = { ...room, participants: [...room.participants, participant], revision: room.revision + 1 };
  rooms.set(roomId, next);
  return { room: publicRoom(next, token), participantToken: token };
}

export function castGroupVote(roomId: string, participantToken: string, decisionId: string, candidateId: string): PublicGroupRoom {
  const next = voteForCandidate(requireRoom(roomId), participantToken, decisionId, candidateId);
  rooms.set(roomId, next);
  return publicRoom(next, participantToken);
}

export async function recommendGroupCandidate(
  roomId: string,
  participantToken: string,
  decisionId: string,
  offerId: string,
): Promise<PublicGroupRoom> {
  const room = requireRoom(roomId);
  const decision = room.decisions.find((item) => item.id === decisionId);
  if (!decision) throw new Error("Unknown voting decision");
  const offer = await resolveOffer(offerId, createInventoryRepository());
  assertCandidateMatchesDecision(room, decision, offer);
  const facts = consequenceFacts(room, decision, offer);
  const summary = { ...candidateSummary(offer), ...facts };
  summary.explanation = await explainCandidate(summary);
  const current = requireRoom(roomId);
  if (current.revision !== room.revision) throw new Error("The voting room changed; try again");
  const next = addRecommendation(current, participantToken, decisionId, offerId, summary, `candidate:${randomUUID()}`, offer);
  rooms.set(roomId, next);
  return publicRoom(next, participantToken);
}

export async function finalizeGroupRoom(roomId: string, organizerToken: string): Promise<PublicGroupRoom> {
  const room = requireRoom(roomId);
  if (organizerToken !== room.organizerToken) throw new Error("Only the organizer can finalize this trip");
  let committed: { trip: TripState; projection: TripProjection };
  try {
    const proposal = buildFinalizationProposal(room);
    committed = await commitProposal({ trip: room.trip, proposal });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Every group choice is already finalized") {
      committed = { trip: room.trip, projection: room.projection };
    } else {
      const winningConflicts = room.decisions.flatMap((decision) => {
        const result = decisionResult(room, decision.id);
        const winner = decision.candidates.find((candidate) => candidate.id === (result.leaderCandidateId ?? decision.candidates[0]?.id));
        return (winner?.summary.conflicts ?? []).map((conflict) => `${decision.label}: ${conflict}`);
      });
      if (winningConflicts.length > 0) {
        throw new Error(`Winning choices still conflict. ${winningConflicts.join("; ")}. Change a vote or recommend another option.`);
      }
      throw error;
    }
  }
  const current = requireRoom(roomId);
  if (current.revision !== room.revision) throw new Error("A vote changed while finalizing; review the latest result");
  const now = new Date().toISOString();
  const next: GroupRoom = {
    ...room,
    trip: committed.trip,
    projection: committed.projection,
    status: "finalized",
    finalizedAt: now,
    revision: room.revision + 1,
    decisions: room.decisions.map((decision) => ({
      ...decision,
      finalizedCandidateId: decisionResult(room, decision.id).leaderCandidateId ?? decision.candidates[0]?.id,
    })),
  };
  rooms.set(roomId, next);
  return publicRoom(next, undefined, organizerToken);
}

export async function prepareGroupRecommendation(
  room: PublicGroupRoom,
  participantId: string,
  offerId: string,
  target: { decisionId: string } | { date: string; locationId: string } | { addActivity: true },
): Promise<import("@/collaboration/model").GroupCandidate> {
  if (room.status !== "voting") throw new Error("Recommendations are closed for this trip");
  if (!room.participants.some((participant) => participant.id === participantId)) {
    throw new Error("Join the trip before recommending an option");
  }
  const offer = await resolveOffer(offerId, createInventoryRepository());
  let summary: CandidateSummary;
  if ("decisionId" in target) {
    const decision = room.decisions.find((item) => item.id === target.decisionId);
    if (!decision) throw new Error("Unknown voting decision");
    if (decision.mode === "add") {
      const current = decision.candidates.find((candidate) => candidate.offerId === decision.currentOfferId)?.offer;
      if (!isActivity(offer) || !current || !isActivity(current) || offer.locationId !== current.locationId || offer.startsAt.slice(0, 10) !== current.startsAt.slice(0, 10)) {
        throw new Error("The recommended activity does not match this itinerary day");
      }
      const conflicts: string[] = [];
      for (const item of room.projection.hydratedSelections) {
        if (!isActivity(item.offer) || !overlap(offer.startsAt, offer.endsAt, item.offer.startsAt, item.offer.endsAt)) continue;
        conflicts.push(`Overlaps ${item.offer.activityFacts.name}`);
      }
      summary = {
        ...candidateSummary(offer),
        conflicts,
        costDelta: costFor(offer, room.trip.request.travellers.length) - costFor(current, room.trip.request.travellers.length),
      };
    } else {
      assertCandidateMatchesDecision(room, decision, offer);
      summary = { ...candidateSummary(offer), ...consequenceFacts(room, decision, offer) };
    }
  } else {
    const date = isActivity(offer) ? offer.startsAt.slice(0, 10) : "";
    const expectedDate = "date" in target ? target.date : date;
    const expectedLocation = "locationId" in target ? target.locationId : isActivity(offer) ? offer.locationId : "";
    const validTripDay = date >= room.trip.request.startDate && date <= room.trip.request.endDate
      && room.trip.route.stops.some((stop) => stop.locationId === expectedLocation && date >= stop.checkIn && date <= stop.checkOut);
    if (!isActivity(offer) || offer.locationId !== expectedLocation || date !== expectedDate || !validTripDay) {
      throw new Error("The recommended activity does not match this itinerary day");
    }
    const conflicts: string[] = [];
    for (const item of room.projection.hydratedSelections) {
      if (!isActivity(item.offer) || !overlap(offer.startsAt, offer.endsAt, item.offer.startsAt, item.offer.endsAt)) continue;
      const minutes = Math.max(1, Math.round(
        (Math.min(Date.parse(offer.endsAt), Date.parse(item.offer.endsAt)) - Math.max(Date.parse(offer.startsAt), Date.parse(item.offer.startsAt))) / 60_000,
      ));
      conflicts.push(`Overlaps ${item.offer.activityFacts.name} by ${minutes} minutes`);
    }
    summary = {
      ...candidateSummary(offer),
      conflicts,
      costDelta: costFor(offer, room.trip.request.travellers.length),
    };
  }
  summary.explanation = await explainCandidate(summary);
  return {
    id: `candidate:${randomUUID()}`,
    offerId,
    offer: isTransfer(offer) ? undefined : offer,
    summary,
    source: "recommendation",
    recommendedByParticipantId: participantId,
    createdAt: new Date().toISOString(),
  };
}

export async function finalizeGroupRoomSnapshot(rawRoom: PublicGroupRoom): Promise<PublicGroupRoom> {
  const trip = tripStateSchema.parse(rawRoom.trip) as TripState;
  if (!rawRoom.projection || !Array.isArray(rawRoom.projection.hydratedSelections)) {
    throw new Error("A valid shared itinerary is required");
  }
  const room: GroupRoom = {
    ...rawRoom,
    trip,
    organizerToken: "local-demo",
    participants: rawRoom.participants.map((participant) => ({ ...participant, token: participant.id })),
  };
  let committed: { trip: TripState; projection: TripProjection };
  try {
    committed = await commitProposal({ trip: room.trip, proposal: buildFinalizationProposal(room) });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Every group choice is already finalized") {
      committed = { trip: room.trip, projection: room.projection };
    } else {
      throw error;
    }
  }
  const now = new Date().toISOString();
  return {
    ...rawRoom,
    trip: committed.trip,
    projection: committed.projection,
    status: "finalized",
    finalizedAt: now,
    revision: rawRoom.revision + 1,
    decisions: rawRoom.decisions.map((decision) => ({
      ...decision,
      finalizedCandidateId: decisionResult(room, decision.id).leaderCandidateId
        ?? (decision.mode === "add" ? undefined : decision.candidates[0]?.id),
    })),
    viewer: undefined,
  };
}
