"use client";

import type {
  GroupCandidate,
  GroupDecision,
  PublicGroupRoom,
} from "@/collaboration/model";

const STORAGE_VERSION = 1;
const ROOM_PREFIX = "group-voting:room:";
const VIEWER_PREFIX = "group-voting:viewer:";
const CHANNEL_PREFIX = "group-voting:channel:";

export interface LocalGroupViewer {
  participantId: string;
  role: "organizer" | "participant";
  inviteId?: string;
}

interface StoredRoomEnvelope {
  schemaVersion: number;
  room: PublicGroupRoom;
}

export function reconcileCandidateOrder(current: string[], available: string[]): string[] {
  const availableIds = new Set(available);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of [...current, ...available]) {
    if (!availableIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function roomStorageKey(roomId: string): string {
  return `${ROOM_PREFIX}${roomId}`;
}

export function viewerStorageKey(roomId: string): string {
  return `${VIEWER_PREFIX}${roomId}`;
}

function withoutViewer(room: PublicGroupRoom): PublicGroupRoom {
  return { ...room, viewer: undefined };
}

export function withLocalViewer(room: PublicGroupRoom, viewer?: LocalGroupViewer): PublicGroupRoom {
  return {
    ...room,
    viewer: {
      participantId: viewer?.participantId,
      organizer: viewer?.role === "organizer",
    },
  };
}

export function readLocalGroupRoom(roomId: string): PublicGroupRoom | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(roomStorageKey(roomId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredRoomEnvelope;
    if (parsed.schemaVersion !== STORAGE_VERSION || parsed.room?.id !== roomId) return undefined;
    return withoutViewer(parsed.room);
  } catch {
    return undefined;
  }
}

export function writeLocalGroupRoom(room: PublicGroupRoom): PublicGroupRoom {
  const persisted = withoutViewer(room);
  const envelope: StoredRoomEnvelope = { schemaVersion: STORAGE_VERSION, room: persisted };
  window.localStorage.setItem(roomStorageKey(room.id), JSON.stringify(envelope));
  const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${room.id}`);
  channel.postMessage({ type: "room-updated", roomId: room.id, revision: room.revision });
  channel.close();
  return persisted;
}

export function removeLocalGroupRoom(roomId: string): void {
  window.localStorage.removeItem(roomStorageKey(roomId));
  window.sessionStorage.removeItem(viewerStorageKey(roomId));
}

export function readLocalViewer(roomId: string): LocalGroupViewer | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(viewerStorageKey(roomId));
    if (!raw) return undefined;
    const viewer = JSON.parse(raw) as LocalGroupViewer;
    return viewer?.participantId && (viewer.role === "organizer" || viewer.role === "participant") ? viewer : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalViewer(roomId: string, viewer: LocalGroupViewer): void {
  window.sessionStorage.setItem(viewerStorageKey(roomId), JSON.stringify(viewer));
}

export function subscribeToLocalGroupRoom(roomId: string, onRoom: (room: PublicGroupRoom) => void): () => void {
  const refresh = () => {
    const room = readLocalGroupRoom(roomId);
    if (room) onRoom(room);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === roomStorageKey(roomId)) refresh();
  };
  const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${roomId}`);
  channel.addEventListener("message", refresh);
  window.addEventListener("storage", onStorage);
  return () => {
    channel.removeEventListener("message", refresh);
    channel.close();
    window.removeEventListener("storage", onStorage);
  };
}

export function renameLocalInvitation(room: PublicGroupRoom, inviteId: string, displayName: string): PublicGroupRoom {
  return {
    ...room,
    revision: room.revision + 1,
    invitations: room.invitations.map((invite) => invite.id === inviteId
      ? { ...invite, displayName: displayName.slice(0, 40) || undefined }
      : invite),
  };
}

export function joinLocalInvitation(
  room: PublicGroupRoom,
  inviteId: string,
  displayName: string,
): { room: PublicGroupRoom; viewer: LocalGroupViewer } {
  if (room.status !== "voting") throw new Error("This trip has already been finalized");
  const invite = room.invitations.find((item) => item.id === inviteId);
  if (!invite) throw new Error("This participant invitation is unavailable");
  const existing = invite.participantId
    ? room.participants.find((participant) => participant.id === invite.participantId)
    : undefined;
  const participantId = existing?.id ?? `participant:${globalThis.crypto.randomUUID()}`;
  const name = displayName.trim().slice(0, 40) || invite.displayName || "Guest";
  const next: PublicGroupRoom = {
    ...room,
    revision: room.revision + 1,
    invitations: room.invitations.map((item) => item.id === inviteId
      ? { ...item, participantId, displayName: name }
      : item),
    participants: existing
      ? room.participants.map((participant) => participant.id === participantId ? { ...participant, displayName: name } : participant)
      : [...room.participants, { id: participantId, displayName: name, joinedAt: new Date().toISOString() }],
  };
  return { room: next, viewer: { participantId, role: "participant", inviteId } };
}

export function toggleLocalVote(
  room: PublicGroupRoom,
  participantId: string,
  decisionId: string,
  candidateId: string,
): PublicGroupRoom {
  if (room.status !== "voting") throw new Error("Voting has closed for this trip");
  if (!room.participants.some((participant) => participant.id === participantId)) throw new Error("Join the trip before voting");
  const decision = room.decisions.find((item) => item.id === decisionId);
  if (!decision?.candidates.some((candidate) => candidate.id === candidateId)) throw new Error("This option is unavailable");
  const existing = room.votes.find((vote) => vote.decisionId === decisionId && vote.participantId === participantId);
  const votes = room.votes.filter((vote) => !(vote.decisionId === decisionId && vote.participantId === participantId));
  if (existing?.candidateId !== candidateId) {
    votes.push({ decisionId, participantId, candidateId, updatedAt: new Date().toISOString() });
  }
  return { ...room, revision: room.revision + 1, votes };
}

export function addLocalCandidate(
  room: PublicGroupRoom,
  decisionId: string,
  candidate: GroupCandidate,
): PublicGroupRoom {
  const decision = room.decisions.find((item) => item.id === decisionId);
  if (!decision) throw new Error("This itinerary choice is unavailable");
  if (decision.candidates.some((item) => item.offerId === candidate.offerId)) return room;
  if (decision.candidates.length >= 4) throw new Error("This choice already has four options");
  if (decision.candidates.some((item) => item.recommendedByParticipantId === candidate.recommendedByParticipantId)) {
    throw new Error("You can recommend one option for each choice");
  }
  return {
    ...room,
    revision: room.revision + 1,
    decisions: room.decisions.map((item) => item.id === decisionId
      ? { ...item, candidates: [...item.candidates, candidate] }
      : item),
  };
}

export function addLocalActivityDecision(
  room: PublicGroupRoom,
  candidate: GroupCandidate,
  date: string,
  locationId: string,
): PublicGroupRoom {
  const decision: GroupDecision = {
    id: `decision:${globalThis.crypto.randomUUID()}`,
    kind: "activity",
    mode: "add",
    date,
    locationId,
    label: `Recommended activity · ${new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    currentOfferId: candidate.offerId,
    candidates: [candidate],
  };
  return { ...room, revision: room.revision + 1, decisions: [...room.decisions, decision] };
}

export function toggleLocalSelectionLock(room: PublicGroupRoom, selectionId: string): PublicGroupRoom {
  const toggle = <T extends { id: string; locked: boolean }>(items: T[]) => items.map((item) => item.id === selectionId ? { ...item, locked: !item.locked } : item);
  return {
    ...room,
    revision: room.revision + 1,
    trip: {
      ...room.trip,
      selectedTravel: toggle(room.trip.selectedTravel),
      selectedStays: toggle(room.trip.selectedStays),
      selectedActivities: toggle(room.trip.selectedActivities),
    },
  };
}
