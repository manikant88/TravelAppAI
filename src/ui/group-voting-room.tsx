"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { decisionResult, type GroupCandidate, type GroupDecision, type PublicGroupRoom } from "@/collaboration/model";
import {
  addLocalActivityDecision,
  addLocalCandidate,
  joinLocalInvitation,
  readLocalGroupRoom,
  readLocalViewer,
  reconcileCandidateOrder,
  removeLocalGroupRoom,
  subscribeToLocalGroupRoom,
  toggleLocalSelectionLock,
  toggleLocalVote,
  withLocalViewer,
  writeLocalGroupRoom,
  writeLocalViewer,
  type LocalGroupViewer,
} from "@/collaboration/local-room";
import type { HydratedSelection } from "@/domain/trip";
import type { ActivityOffer, SearchResponse, StayOffer, TransportOffer } from "@/inventory/contracts";
import { Badge, Button, Card, IconButton, TextInput } from "@/ui/components/primitives";
import { PriceSummary } from "@/ui/patterns/price-summary";
import { ActivityCard, StayCard, TravelCard } from "@/ui/workspace";

interface ChatEntry { id: string; role: "user" | "assistant"; text: string }
interface PendingRecommendation { decisionId?: string; offerId: string; label: string }
type RecommendationTarget = { decisionId: string } | { date: string; locationId: string };

function messageId(): string { return `group-message:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`; }
function displayLocation(id: string): string { return (id.split(":").at(-1) ?? id).split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
function formatMoney(amount: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount); }
function formatDate(date: string): string { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function isTransport(offer: HydratedSelection["offer"]): offer is TransportOffer { return "serviceId" in offer; }
function isStay(offer: HydratedSelection["offer"]): offer is StayOffer { return "roomOfferId" in offer; }
function isActivity(offer: HydratedSelection["offer"]): offer is ActivityOffer { return "sessionId" in offer; }
function overlaps(left: ActivityOffer, right: ActivityOffer): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt) && Date.parse(right.startsAt) < Date.parse(left.endsAt);
}

function overlappingActivityDecision(room: PublicGroupRoom, offer: ActivityOffer): GroupDecision | undefined {
  return room.decisions.find((item) => {
    if (item.kind !== "activity" || item.mode === "add") return false;
    const current = item.candidates.find((candidate) => candidate.offerId === item.currentOfferId)?.offer;
    return current && isActivity(current) ? overlaps(offer, current) : false;
  });
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The shared trip could not be updated");
  return body;
}

function voteCount(room: PublicGroupRoom, decisionId: string, candidateId: string): number {
  return room.votes.filter((vote) => vote.decisionId === decisionId && vote.candidateId === candidateId).length;
}

function candidateOfferId(proposal: { operations?: Array<Record<string, unknown>> }): { selectionId?: string; offerId: string } | undefined {
  for (const operation of proposal.operations ?? []) {
    if ((operation.type === "replace_travel" || operation.type === "replace_stay" || operation.type === "replace_activity") && typeof operation.selectionId === "string" && typeof operation.nextOfferId === "string") {
      return { selectionId: operation.selectionId, offerId: operation.nextOfferId };
    }
    if (operation.type === "add_activity" && typeof operation.nextOfferId === "string") return { offerId: operation.nextOfferId };
  }
  return undefined;
}

function FullCandidateCard({ candidate, decision, travellerCount }: { candidate: GroupCandidate; decision: GroupDecision; travellerCount: number }) {
  const offer = candidate.offer;
  if (!offer) return <Card className="group-candidate-fallback"><h4>{candidate.summary.title}</h4><p>{candidate.summary.detail}</p><strong>{candidate.summary.priceLabel}</strong></Card>;
  const item: HydratedSelection = { selectionId: decision.selectionId ?? decision.id, kind: decision.kind, offer };
  if (isTransport(offer)) return <TravelCard item={item} grounding={candidate.summary.explanation} />;
  if (isStay(offer)) return <StayCard item={item} travellerCount={travellerCount} grounding={candidate.summary.explanation} />;
  return <ActivityCard item={item} grounding={candidate.summary.explanation} />;
}

function ChoiceCarousel({ room, decision, participantId, organizer, busy, onVote, onRecommend, onAskAi, onToggleLock }: {
  room: PublicGroupRoom;
  decision: GroupDecision;
  participantId?: string;
  organizer: boolean;
  busy: boolean;
  onVote(candidateId: string): void;
  onRecommend(): void;
  onAskAi(candidate: GroupCandidate): void;
  onToggleLock(selectionId: string): void;
}) {
  const result = decisionResult(room, decision.id);
  const [order, setOrder] = useState(() => [...decision.candidates].sort((left, right) => voteCount(room, decision.id, right.id) - voteCount(room, decision.id, left.id) || Number(right.source === "itinerary") - Number(left.source === "itinerary") || left.createdAt.localeCompare(right.createdAt)).map((candidate) => candidate.id)); // Intentionally stable while this decision is mounted.
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const available = decision.candidates.map((candidate) => candidate.id);
    const timer = window.setTimeout(() => setOrder((current) => {
      const next = reconcileCandidateOrder(current, available);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    }), 0);
    return () => window.clearTimeout(timer);
  }, [decision.candidates]);

  const orderedCandidates = reconcileCandidateOrder(order, decision.candidates.map((item) => item.id)).flatMap((id) => { const candidate = decision.candidates.find((item) => item.id === id); return candidate ? [candidate] : []; });
  const candidate = orderedCandidates[Math.min(activeIndex, Math.max(0, orderedCandidates.length - 1))] ?? decision.candidates[0];
  if (!candidate) return null;
  const myVote = room.votes.find((vote) => vote.decisionId === decision.id && vote.participantId === participantId)?.candidateId;
  const leading = decision.finalizedCandidateId ?? result.leaderCandidateId;
  const conflicts = candidate.summary.conflicts ?? [];
  const groupCostDelta = candidate.summary.costDelta ?? 0;
  const voters = room.votes
    .filter((vote) => vote.decisionId === decision.id && vote.candidateId === candidate.id)
    .flatMap((vote) => room.participants.find((participant) => participant.id === vote.participantId) ?? []);
  const selection = decision.selectionId
    ? [...room.trip.selectedTravel, ...room.trip.selectedStays, ...room.trip.selectedActivities].find((item) => item.id === decision.selectionId)
    : undefined;
  const recommender = room.participants.find((person) => person.id === candidate.recommendedByParticipantId)?.displayName;

  const excludedAfterFinalization = room.status === "finalized" && decision.mode === "add" && !decision.finalizedCandidateId;

  return <section className="group-choice" aria-label={`Vote on ${decision.label}`}>
    <header className="group-choice-header"><div><span>{decision.kind}</span><h4>{decision.label}</h4><p>{decision.mode === "add" ? "Vote to include this recommended activity" : decision.candidates.length > 1 ? `Choose one of ${decision.candidates.length} competing options` : "Vote to keep this itinerary choice"}</p></div><div className="group-choice-actions">{organizer && selection ? <Button variant="text" size="sm" disabled={busy} onClick={() => onToggleLock(selection.id)}>{selection.locked ? "Unlock" : "Lock"}</Button> : null}{room.status === "voting" && participantId ? <Button variant="text" size="sm" disabled={busy} onClick={onRecommend}>Change</Button> : null}{excludedAfterFinalization ? <Badge>Not selected</Badge> : result.tied ? <Badge tone="warning">Tie</Badge> : leading ? <Badge tone="success">{room.status === "finalized" ? "Final choice" : "Group choice"}</Badge> : <Badge>Awaiting votes</Badge>}</div></header>
    {decision.candidates.length > 1 ? <div className="group-choice-index" aria-label="Competing options">{orderedCandidates.map((option, index) => <button type="button" className={candidate.id === option.id ? "is-active" : undefined} key={option.id} onClick={() => setActiveIndex(index)}><span>{option.summary.title}</span><strong>{voteCount(room, decision.id, option.id)} vote{voteCount(room, decision.id, option.id) === 1 ? "" : "s"}</strong>{leading === option.id ? <i>Leading</i> : null}</button>)}</div> : null}
    <div className="group-choice-viewport"><div className="group-candidate-labels"><span>{candidate.source === "itinerary" ? "Current itinerary" : `Recommended by ${room.participants.find((person) => person.id === candidate.recommendedByParticipantId)?.displayName ?? "participant"}`}</span><div>{leading === candidate.id ? <Badge tone="success">Leading</Badge> : null}<Badge tone={conflicts.length ? "warning" : "neutral"}>{conflicts.length ? "Conflict" : `${voteCount(room, decision.id, candidate.id)} votes`}</Badge></div></div><FullCandidateCard candidate={candidate} decision={decision} travellerCount={room.trip.request.travellers.length} />
      {conflicts.length ? <div className="group-conflict-notice"><strong>Schedule conflict</strong>{conflicts.map((conflict) => <span key={conflict}>{conflict}</span>)}<small>This option remains open for voting. The organizer must resolve the conflict before finalizing.</small></div> : null}
      {groupCostDelta !== 0 ? <p className={`group-cost-delta ${groupCostDelta > 0 ? "is-more" : "is-less"}`}>{formatMoney(Math.abs(groupCostDelta))} {groupCostDelta > 0 ? "more" : "less"} for the group than the current selection</p> : null}
      <footer className="group-vote-layer"><div className="group-vote-summary">{recommender ? <span>{recommender} recommended this {decision.kind}</span> : null}<strong>{voters.length ? `${voters.map((person) => person.id === participantId ? "You" : person.displayName).join(", ")} voted for this` : excludedAfterFinalization ? "Not included in the finalized trip" : "Awaiting votes"}</strong>{orderedCandidates.length > 1 ? <div className="group-carousel-controls"><Button variant="secondary" size="sm" disabled={activeIndex === 0} onClick={() => setActiveIndex((index) => Math.max(0, index - 1))} aria-label="Previous option">←</Button><span>{activeIndex + 1} of {orderedCandidates.length}</span><Button variant="secondary" size="sm" disabled={activeIndex >= orderedCandidates.length - 1} onClick={() => setActiveIndex((index) => Math.min(orderedCandidates.length - 1, index + 1))} aria-label="Next option">→</Button></div> : null}</div><div><Button variant="text" size="sm" onClick={() => onAskAi(candidate)}>Ask AI</Button>{room.status === "voting" && participantId ? <Button size="sm" variant={myVote === candidate.id ? "text" : "primary"} disabled={busy} onClick={() => onVote(candidate.id)}>{myVote === candidate.id ? "Remove vote" : "Vote"}</Button> : null}</div></footer>
    </div>
  </section>;
}

function RecommendationPicker({ room, target, participantId, onUpdated, onRecommended, onClose }: {
  room: PublicGroupRoom;
  target: RecommendationTarget;
  participantId: string;
  onUpdated(room: PublicGroupRoom): void;
  onRecommended(candidate: GroupCandidate): void;
  onClose(): void;
}) {
  const decision = "decisionId" in target ? room.decisions.find((item) => item.id === target.decisionId) : undefined;
  const [offers, setOffers] = useState<Array<TransportOffer | StayOffer | ActivityOffer>>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "saving">("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function loadAlternatives() {
      let endpoint: string;
      let body: object;
      if (!decision && "date" in target) {
        endpoint = "/api/inventory/activities/search";
        body = { locationId: target.locationId, startDate: target.date, endDate: target.date, travellers: room.trip.request.travellers, interests: room.trip.request.preferences.interests ?? [], constraints: room.trip.request.constraints };
      } else {
        const currentOffer = decision?.mode === "add"
          ? decision.candidates.find((candidate) => candidate.offerId === decision.currentOfferId)?.offer
          : decision?.selectionId ? room.projection.hydratedSelections.find((item) => item.selectionId === decision.selectionId)?.offer : undefined;
        if (!currentOffer) throw new Error("The current inventory option is unavailable.");
        if (isTransport(currentOffer)) { endpoint = "/api/inventory/transport/search"; body = { from: currentOffer.from, to: currentOffer.to, date: currentOffer.departureAt.slice(0, 10), travellers: room.trip.request.travellers, constraints: room.trip.request.constraints }; }
        else if (isStay(currentOffer)) { endpoint = "/api/inventory/stays/search"; body = { locationId: currentOffer.locationId, checkIn: currentOffer.checkIn, checkOut: currentOffer.checkOut, travellers: room.trip.request.travellers, constraints: room.trip.request.constraints }; }
        else if (isActivity(currentOffer)) { const date = currentOffer.startsAt.slice(0, 10); endpoint = "/api/inventory/activities/search"; body = { locationId: currentOffer.locationId, startDate: date, endDate: date, travellers: room.trip.request.travellers, interests: room.trip.request.preferences.interests ?? [], constraints: room.trip.request.constraints }; }
        else throw new Error("This type of option is not open for recommendations.");
      }
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await responseJson<SearchResponse<TransportOffer | StayOffer | ActivityOffer>>(response);
      setOffers(result.results.filter((offer) => !decision?.candidates.some((candidate) => candidate.offerId === offer.id)).slice(0, 4));
    }
    void loadAlternatives().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Alternatives are unavailable")).finally(() => setStatus("idle"));
  }, [decision, room, target]);

  async function recommend(offer: TransportOffer | StayOffer | ActivityOffer) {
    setStatus("saving"); setError(undefined);
    try {
      let competingDecision = decision;
      if (!competingDecision && isActivity(offer)) {
        competingDecision = overlappingActivityDecision(room, offer);
      }
      const payload = competingDecision
        ? { room, participantId, offerId: offer.id, decisionId: competingDecision.id }
        : { room, participantId, offerId: offer.id, ...target };
      const response = await fetch("/api/group-recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const candidate = await responseJson<GroupCandidate>(response);
      const next = competingDecision
        ? addLocalCandidate(room, competingDecision.id, candidate)
        : "date" in target ? addLocalActivityDecision(room, candidate, target.date, target.locationId) : room;
      onUpdated(next);
      onRecommended(candidate);
      onClose();
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "The recommendation could not be added"); }
    finally { setStatus("idle"); }
  }

  return <div className="inventory-drawer-overlay" role="presentation"><aside className="inventory-drawer group-inventory-drawer" role="dialog" aria-modal="true" aria-labelledby="group-inventory-title"><header className="inventory-drawer-header"><div><small>Inventory-backed alternatives</small><h2 id="group-inventory-title">{decision ? `Recommend for ${decision.label}` : "Add an activity recommendation"}</h2></div><span /><IconButton aria-label="Close alternatives" onClick={onClose}>×</IconButton></header><p className="inventory-drawer-filter">Recommendations may conflict with another itinerary item. We will show the consequence without hiding the option.</p><div className="inventory-drawer-list">{status === "loading" ? <p className="inventory-picker-status">Checking alternatives…</p> : null}{error ? <p className="inventory-picker-status error">{error}</p> : null}{status !== "loading" && offers.length === 0 && !error ? <p className="inventory-picker-status">No other inventory options are available.</p> : null}{offers.map((offer) => { const title = isTransport(offer) ? `${offer.operator} · ${offer.mode}` : isStay(offer) ? offer.propertyFacts.name : offer.activityFacts.name; const detail = isTransport(offer) ? `${new Date(offer.departureAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · ${offer.stops === 0 ? "Non-stop" : `${offer.stops} stop`}` : isStay(offer) ? `${offer.roomFacts.roomLabel} · ${offer.propertyFacts.rating.toFixed(1)} rating` : new Date(offer.startsAt).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" }); return <Card className="drawer-option group-drawer-option" key={offer.id}><div className="drawer-option-media">{isTransport(offer) ? "✈" : isStay(offer) && offer.propertyFacts.imageUrl ? <Image src={offer.propertyFacts.imageUrl} alt="" fill sizes="180px" /> : isActivity(offer) && offer.activityFacts.imageUrl ? <Image src={offer.activityFacts.imageUrl} alt="" fill sizes="180px" /> : "◈"}</div><div className="drawer-option-content"><h3>{title}</h3><p>{detail}</p><small>We will calculate cost and schedule consequences before sharing it.</small></div><div className="drawer-option-action"><Button size="sm" disabled={status === "saving"} onClick={() => void recommend(offer)}>Recommend</Button></div></Card>; })}</div></aside></div>;
}

function GroupItinerary({ room, participantId, organizer, busy, onVote, onRecommend, onAddActivity, onAskAi, onToggleLock }: {
  room: PublicGroupRoom;
  participantId?: string;
  organizer: boolean;
  busy: boolean;
  onVote(decisionId: string, candidateId: string): void;
  onRecommend(decisionId: string): void;
  onAddActivity(date: string, locationId: string): void;
  onAskAi(decision: GroupDecision, candidate: GroupCandidate): void;
  onToggleLock(selectionId: string): void;
}) {
  const hydrated = new Map(room.projection.hydratedSelections.map((item) => [item.selectionId, item]));
  const decisionBySelection = new Map(room.decisions.map((decision) => [decision.selectionId, decision]));
  return (
    <section className="itinerary-section" aria-labelledby="itinerary-heading">
      <div className="timeline">
        {room.projection.itinerary.map((day) => (
          <article className="timeline-day" id={`itinerary-day-${day.date}`} key={day.date}>
            <div className="day-marker"><strong>{day.dayNumber}</strong><i /></div>
            <div className="day-content">
              <header><div><h3>{displayLocation(day.locationId)}</h3><span>{formatDate(day.date)}</span></div>{participantId && room.status === "voting" ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => onAddActivity(day.date, day.locationId)}>+ Add activity</Button> : null}</header>
              <div className="day-events">
                {day.events.map((event) => {
                  if (event.type === "free_time") return <div className="free-time-card" key={event.id}><span aria-hidden="true">◉</span><strong>{event.title}</strong></div>;
                  const item = event.selectionId ? hydrated.get(event.selectionId) : undefined;
                  if (!item || !event.selectionId) return null;
                  const decision = decisionBySelection.get(event.selectionId);
                  if (decision) return <ChoiceCarousel key={event.id} room={room} decision={decision} participantId={participantId} organizer={organizer} busy={busy} onVote={(candidateId) => onVote(decision.id, candidateId)} onRecommend={() => onRecommend(decision.id)} onAskAi={(candidate) => onAskAi(decision, candidate)} onToggleLock={onToggleLock} />;
                  return <div className="itinerary-selection" key={event.id}><TravelCard item={item} /></div>;
                })}
                {room.decisions.filter((decision) => decision.mode === "add" && decision.date === day.date).map((decision) => <ChoiceCarousel key={decision.id} room={room} decision={decision} participantId={participantId} organizer={organizer} busy={busy} onVote={(candidateId) => onVote(decision.id, candidateId)} onRecommend={() => onRecommend(decision.id)} onAskAi={(candidate) => onAskAi(decision, candidate)} onToggleLock={onToggleLock} />)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function GroupVotingRoom({ roomId, organizerToken, inviteId }: { roomId: string; organizerToken?: string; inviteId?: string }) {
  const [room, setRoom] = useState<PublicGroupRoom>();
  const [viewer, setViewer] = useState<LocalGroupViewer | undefined>(() => typeof window === "undefined" ? undefined : readLocalViewer(roomId));
  const [displayName, setDisplayName] = useState("");
  const [activeRecommendation, setActiveRecommendation] = useState<RecommendationTarget>();
  const [messages, setMessages] = useState<ChatEntry[]>([{ id: "group-welcome", role: "assistant", text: "I can explain the shared itinerary, compare choices, and find grounded travel, stay, or activity alternatives for you to recommend." }]);
  const [composer, setComposer] = useState("");
  const [pendingRecommendation, setPendingRecommendation] = useState<PendingRecommendation>();
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string>();
  const conversationRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const stored = readLocalGroupRoom(roomId);
    if (!stored) {
      setError("This local voting room is unavailable. Open an invite from the organizer tab in this browser.");
      return;
    }
    let currentViewer = readLocalViewer(roomId);
    if (organizerToken) {
      currentViewer = { participantId: stored.organizerParticipantId, role: "organizer" };
      writeLocalViewer(roomId, currentViewer);
    }
    if (inviteId) {
      const invite = stored.invitations.find((item) => item.id === inviteId);
      if (invite?.displayName) setDisplayName(invite.displayName);
    }
    setViewer(currentViewer);
    setRoom(withLocalViewer(stored, currentViewer));
    return subscribeToLocalGroupRoom(roomId, (next) => {
      const tabViewer = readLocalViewer(roomId);
      setViewer(tabViewer);
      setRoom(withLocalViewer(next, tabViewer));
    });
  }, [inviteId, organizerToken, roomId]);
  useEffect(() => { const target = conversationRef.current; if (!target) return; const frame = window.requestAnimationFrame(() => target.scrollTo({ top: target.scrollHeight, behavior: "smooth" })); return () => window.cancelAnimationFrame(frame); }, [messages, pendingRecommendation]);

  function persist(next: PublicGroupRoom, nextViewer = viewer) { writeLocalGroupRoom(next); setRoom(withLocalViewer(next, nextViewer)); }
  async function join(event: FormEvent) { event.preventDefault(); if (!room || !inviteId || !displayName.trim()) return; setBusy(true); setError(undefined); try { const result = joinLocalInvitation(room, inviteId, displayName); writeLocalViewer(roomId, result.viewer); setViewer(result.viewer); persist(result.room, result.viewer); } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "You could not join this trip"); } finally { setBusy(false); } }
  async function vote(decisionId: string, candidateId: string) { if (!room || !viewer) return; setError(undefined); try { persist(toggleLocalVote(room, viewer.participantId, decisionId, candidateId)); } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Your vote could not be saved"); } }
  async function finalize() { if (!room || viewer?.role !== "organizer") return; setBusy(true); setError(undefined); try { const response = await fetch("/api/group-finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room: { ...room, viewer: undefined } }) }); const next = await responseJson<PublicGroupRoom>(response); persist(next); setMessages((current) => [...current, { id: messageId(), role: "assistant", text: "The winning choices passed the complete itinerary validation and are now finalized and locked." }]); } catch (cause: unknown) { const message = cause instanceof Error ? cause.message : "The trip could not be finalized"; setError(message); setMessages((current) => [...current, { id: messageId(), role: "assistant", text: `Finalization is blocked: ${message}` }]); } finally { setBusy(false); } }
  function toggleLock(selectionId: string) { if (!room || viewer?.role !== "organizer") return; persist(toggleLocalSelectionLock(room, selectionId)); }

  function askAiAbout(decision: GroupDecision, candidate: GroupCandidate) { if (candidate.summary.explanation) { setMessages((current) => [...current, { id: messageId(), role: "user", text: `Explain ${candidate.summary.title} for ${decision.label}.` }, { id: messageId(), role: "assistant", text: candidate.summary.explanation! }]); return; } setComposer(`Explain the current ${decision.label} choice.`); }

  async function submitChat(event?: FormEvent) {
    event?.preventDefault(); const message = composer.trim(); if (!message || !room || chatBusy) return;
    setMessages((current) => [...current, { id: messageId(), role: "user", text: message }]); setComposer(""); setPendingRecommendation(undefined); setChatBusy(true);
    try {
      const response = await fetch(`/api/group-rooms/${room.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, participantId: viewer?.participantId, room: { ...room, viewer: undefined }, conversationHistory: messages.slice(-8).map(({ role, text }) => ({ role, text })) }) });
      const envelope = await responseJson<{ kind?: string; message?: string; result?: Record<string, unknown> }>(response); const result = envelope.result;
      const assistantText = typeof envelope.message === "string" ? envelope.message : typeof result?.message === "string" ? result.message : "I found the relevant trip context.";
      setMessages((current) => [...current, { id: messageId(), role: "assistant", text: assistantText }]);
      if ((envelope.kind === "modification" || envelope.kind === "suggestion") && result) {
        const proposals = result.type === "proposal" ? [result.proposal] : result.type === "alternatives" ? (result.options as Array<{ proposal?: unknown }> | undefined)?.map((option) => option.proposal) ?? [] : [];
        const candidate = proposals.flatMap((proposal) => proposal && typeof proposal === "object" ? [candidateOfferId(proposal as { operations?: Array<Record<string, unknown>> })] : []).find(Boolean);
        const decision = candidate?.selectionId ? room.decisions.find((item) => item.selectionId === candidate.selectionId) : undefined;
        if (candidate) setPendingRecommendation({ decisionId: decision?.id, offerId: candidate.offerId, label: decision?.label ?? "the day itinerary" });
      }
    } catch (cause: unknown) { setMessages((current) => [...current, { id: messageId(), role: "assistant", text: cause instanceof Error ? cause.message : "I couldn’t complete that request. The shared trip is unchanged." }]); }
    finally { setChatBusy(false); }
  }

  async function confirmAiRecommendation() { if (!pendingRecommendation || !viewer || !room) return; setChatBusy(true); try { const response = await fetch("/api/group-recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room: { ...room, viewer: undefined }, participantId: viewer.participantId, offerId: pendingRecommendation.offerId, ...(pendingRecommendation.decisionId ? { decisionId: pendingRecommendation.decisionId } : { addActivity: true }) }) }); const recommended = await responseJson<GroupCandidate>(response); let next: PublicGroupRoom; if (pendingRecommendation.decisionId) next = addLocalCandidate(room, pendingRecommendation.decisionId, recommended); else if (recommended.offer && isActivity(recommended.offer)) { const competing = overlappingActivityDecision(room, recommended.offer); next = competing ? addLocalCandidate(room, competing.id, recommended) : addLocalActivityDecision(room, recommended, recommended.offer.startsAt.slice(0, 10), recommended.offer.locationId); } else throw new Error("The AI recommendation is not an activity"); persist(next); setMessages((current) => [...current, { id: messageId(), role: "assistant", text: recommended.summary.explanation ?? "The option is now shared with the group and open for voting." }]); setPendingRecommendation(undefined); } catch (cause: unknown) { setMessages((current) => [...current, { id: messageId(), role: "assistant", text: cause instanceof Error ? cause.message : "The recommendation could not be shared." }]); } finally { setChatBusy(false); } }

  const participantId = room?.viewer?.participantId;
  const destination = room?.trip.request.destination.kind === "specified" ? displayLocation(room.trip.request.destination.locationId) : "Shared trip";
  const perPerson = room ? Math.round(room.projection.budget.total.amount / room.trip.request.travellers.length) : 0;
  if (!room) return <main className="group-room-loading">{error ?? "Opening the shared trip…"}</main>;

  return <main className="workspace-shell group-workspace"><div className="workspace-layout"><aside className="planner-panel"><header className="chat-panel-header"><Link className="mmt-logo-link" href="/" onClick={() => { if (viewer?.role === "organizer") removeLocalGroupRoom(room.id); }}><Image className="mmt-logo" src="/figma/itinerary/mmt-logo.png" alt="MakeMyTrip" width={169} height={40} priority /></Link><Badge tone={room.status === "finalized" ? "success" : "info"}>{room.status === "finalized" ? "Finalized" : "Voting open"}</Badge></header><section ref={conversationRef} className="conversation" aria-label="Personal AI conversation">{messages.map((entry) => <div className={`message message-${entry.role}`} key={entry.id}><p>{entry.text}</p></div>)}{pendingRecommendation ? <div className="group-ai-confirm"><strong>Share this AI recommendation?</strong><span>It will be added to {pendingRecommendation.label} for everyone to vote on.</span><div><Button size="sm" disabled={!participantId || chatBusy} onClick={() => void confirmAiRecommendation()}>Recommend to group</Button><Button variant="text" size="sm" onClick={() => setPendingRecommendation(undefined)}>Not now</Button></div></div> : null}{chatBusy ? <div className="interaction-progress"><div className="interaction-step is-active"><i /><span>Checking the shared itinerary and grounded inventory</span></div></div> : null}</section><div className="conversation-actions"><Button variant="secondary" size="sm" onClick={() => setComposer("Which group choices are leading and are any tied?")}>Summarize votes</Button><Button variant="secondary" size="sm" onClick={() => setComposer("Find a cheaper alternative for the group stay.")}>Find cheaper stay</Button></div><form className="conversation-composer" onSubmit={submitChat}><label htmlFor="group-chat-message">Ask about this shared trip</label><div><textarea id="group-chat-message" rows={2} value={composer} placeholder="Compare options or find an alternative…" onChange={(event) => setComposer(event.target.value)} /><IconButton type="submit" aria-label="Send message" disabled={chatBusy || composer.trim().length < 2}><Image src="/figma/arrow-up.svg" alt="" width={24} height={24} /></IconButton></div><small>Your chat is personal. Only confirmed recommendations are shared.</small></form></aside><div className="workspace-stage"><section className="trip-brief-bar group-trip-brief" aria-label="Shared Trip Brief"><div className="trip-fact"><span>From city</span><strong>{displayLocation(room.trip.request.origin)}</strong></div><div className="trip-fact"><span>To city / country</span><strong>{destination}</strong></div><div className="trip-fact"><span>Travel dates</span><strong>{formatDate(room.trip.request.startDate)} – {formatDate(room.trip.request.endDate)}</strong></div><div className="trip-fact"><span>Guests</span><strong>{room.trip.request.travellers.length} travellers</strong></div><div className="trip-fact"><span>Group room</span><strong>{room.participants.length} joined</strong></div>{room.viewer?.organizer && room.status === "voting" ? <Button className="trip-update-button" disabled={busy} onClick={() => void finalize()}>Finalize</Button> : <Badge tone={room.status === "finalized" ? "success" : "info"}>{room.status === "finalized" ? "Read only" : "Vote below"}</Badge>}</section><section className="workspace-main"><div className="trip-review"><header className="itinerary-overview"><div><p>Shared itinerary</p><h1 id="itinerary-heading">{destination} group trip</h1></div><div className="trip-review-actions"><Badge tone={room.status === "finalized" ? "success" : "info"}>{room.status === "finalized" ? "Choices locked" : `${room.participants.length} joined`}</Badge></div></header>{error ? <p className="group-error group-page-error" role="alert">{error}</p> : null}<GroupItinerary room={room} participantId={participantId} organizer={Boolean(room.viewer?.organizer)} busy={busy} onVote={(decisionId, candidateId) => void vote(decisionId, candidateId)} onRecommend={(decisionId) => setActiveRecommendation({ decisionId })} onAddActivity={(date, locationId) => setActiveRecommendation({ date, locationId })} onAskAi={askAiAbout} onToggleLock={toggleLock} /><PriceSummary metrics={[{ label: "Trip total", amount: formatMoney(room.projection.budget.total.amount), detail: `${formatMoney(perPerson)} per person` }, { label: "Travel total", amount: formatMoney(room.projection.budget.breakdown.travel.amount) }, { label: "Stays total", amount: formatMoney(room.projection.budget.breakdown.stays.amount) }, { label: "Activities total", amount: formatMoney(room.projection.budget.breakdown.activities.amount) }]} actions={<div className="checkout-actions">{room.viewer?.organizer && room.status === "voting" ? <Button disabled={busy} onClick={() => void finalize()}>Finalize choices</Button> : <Badge tone={room.status === "finalized" ? "success" : "neutral"}>{room.status === "finalized" ? "Trip finalized" : "Organizer finalizes"}</Badge>}</div>} /></div></section></div></div>{!participantId && room.status === "voting" ? <div className="group-join-overlay"><form className="group-join-dialog" onSubmit={join}><small>Shared group trip</small><h2>Join {destination}</h2><p>{inviteId ? "Confirm your name to vote, chat with AI, and recommend itinerary options." : "Open the participant invitation created by the organizer to join this trip."}</p>{inviteId ? <><TextInput autoFocus aria-label="Your name" placeholder="Your name" maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><Button type="submit" disabled={busy || !displayName.trim()}>Join trip</Button></> : null}</form></div> : null}{activeRecommendation && participantId ? <RecommendationPicker room={room} target={activeRecommendation} participantId={participantId} onUpdated={persist} onRecommended={(candidate) => setMessages((current) => [...current, { id: messageId(), role: "assistant", text: candidate.summary.explanation ?? "The recommendation is now open for voting." }])} onClose={() => setActiveRecommendation(undefined)} /> : null}</main>;
}
