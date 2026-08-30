import { describe, expect, it } from "vitest";
import {
  addRecommendation,
  buildFinalizationProposal,
  decisionResult,
  publicRoom,
  voteForCandidate,
  type GroupRoom,
} from "@/collaboration/model";
import { reconcileCandidateOrder } from "@/collaboration/local-room";

function room(): GroupRoom {
  return {
    id: "room:goa",
    organizerToken: "organizer-secret",
    status: "voting",
    trip: {
      id: "trip:goa",
      inventoryVersion: "test",
      request: {
        origin: "city:delhi",
        destination: { kind: "specified", locationId: "city:goa" },
        startDate: "2026-10-10",
        endDate: "2026-10-12",
        travellers: [{ id: "traveller:1", type: "adult" }],
        preferences: {},
        constraints: [],
      },
      route: { marketId: "city:goa", stops: [{ locationId: "city:goa", checkIn: "2026-10-10", checkOut: "2026-10-12" }] },
      selectedTravel: [{ id: "selection:flight", kind: "travel", offerKind: "transport", offerId: "offer:flight:1", travellerIds: ["traveller:1"], locked: false }],
      selectedStays: [],
      selectedActivities: [],
      version: 1,
    },
    projection: { hydratedSelections: [], budget: { total: { amount: 0, currency: "INR" }, breakdown: { travel: { amount: 0, currency: "INR" }, stays: { amount: 0, currency: "INR" }, activities: { amount: 0, currency: "INR" } } }, itinerary: [], validation: { valid: true, issues: [] }, badgesByCandidateId: {} },
    organizerParticipantId: "participant:one",
    invitations: [],
    decisions: [{
      id: "decision:flight",
      selectionId: "selection:flight",
      kind: "travel",
      label: "Outbound flight",
      currentOfferId: "offer:flight:1",
      candidates: [{ id: "candidate:flight:1", offerId: "offer:flight:1", summary: { title: "Flight 1", detail: "10:00–12:00", priceLabel: "₹6,000" }, source: "itinerary", createdAt: "2026-08-30T00:00:00.000Z" }],
    }],
    participants: [
      { id: "participant:one", displayName: "One", token: "token-one", joinedAt: "2026-08-30T00:00:00.000Z" },
      { id: "participant:two", displayName: "Two", token: "token-two", joinedAt: "2026-08-30T00:00:00.000Z" },
    ],
    votes: [],
    createdAt: "2026-08-30T00:00:00.000Z",
    revision: 1,
  };
}

describe("group voting", () => {
  it("keeps carousel candidate order stable and removes duplicate notifications", () => {
    expect(reconcileCandidateOrder(
      ["candidate:current", "candidate:new", "candidate:new"],
      ["candidate:current", "candidate:new"],
    )).toEqual(["candidate:current", "candidate:new"]);
    expect(reconcileCandidateOrder(
      ["candidate:current"],
      ["candidate:current", "candidate:new"],
    )).toEqual(["candidate:current", "candidate:new"]);
  });

  it("keeps one mutable vote per participant and reports a unique leader", () => {
    let next = addRecommendation(room(), "token-one", "decision:flight", "offer:flight:2", { title: "Flight 2", detail: "11:00–13:00", priceLabel: "₹6,500" }, "candidate:flight:2");
    next = voteForCandidate(next, "token-one", "decision:flight", "candidate:flight:1");
    next = voteForCandidate(next, "token-two", "decision:flight", "candidate:flight:2");
    expect(decisionResult(next, "decision:flight").tied).toBe(true);
    next = voteForCandidate(next, "token-one", "decision:flight", "candidate:flight:2");
    expect(next.votes).toHaveLength(2);
    expect(decisionResult(next, "decision:flight")).toMatchObject({ leaderCandidateId: "candidate:flight:2", highestVoteCount: 2, tied: false });
  });

  it("allows only one recommendation per participant per decision", () => {
    const next = addRecommendation(room(), "token-one", "decision:flight", "offer:flight:2", { title: "Flight 2", detail: "Later", priceLabel: "₹6,500" }, "candidate:flight:2");
    expect(() => addRecommendation(next, "token-one", "decision:flight", "offer:flight:3", { title: "Flight 3", detail: "Latest", priceLabel: "₹7,000" }, "candidate:flight:3")).toThrow(/one option/);
  });

  it("builds a replacement followed by a canonical lock for the winning option", () => {
    let next = addRecommendation(room(), "token-one", "decision:flight", "offer:flight:2", { title: "Flight 2", detail: "Later", priceLabel: "₹6,500" }, "candidate:flight:2");
    next = voteForCandidate(next, "token-one", "decision:flight", "candidate:flight:2");
    const proposal = buildFinalizationProposal(next);
    expect(proposal.operations).toEqual([
      { type: "replace_travel", selectionId: "selection:flight", nextOfferId: "offer:flight:2" },
      { type: "set_selection_lock", selectionId: "selection:flight", locked: true },
    ]);
  });

  it("blocks finalization while a decision is tied", () => {
    let next = addRecommendation(room(), "token-one", "decision:flight", "offer:flight:2", { title: "Flight 2", detail: "Later", priceLabel: "₹6,500" }, "candidate:flight:2");
    next = voteForCandidate(next, "token-one", "decision:flight", "candidate:flight:1");
    next = voteForCandidate(next, "token-two", "decision:flight", "candidate:flight:2");
    expect(() => buildFinalizationProposal(next)).toThrow(/tied vote/);
  });

  it("does not expose organizer or participant capability tokens", () => {
    const shared = publicRoom(room(), "token-one", "organizer-secret");
    expect(shared.viewer).toEqual({ participantId: "participant:one", organizer: true });
    expect(shared).not.toHaveProperty("organizerToken");
    expect(shared.participants[0]).not.toHaveProperty("token");
  });

  it("rejects vote changes after finalization", () => {
    const finalized = { ...room(), status: "finalized" as const };
    expect(() => voteForCandidate(finalized, "token-one", "decision:flight", "candidate:flight:1")).toThrow(/closed/);
  });

  it("caps a decision at four candidates", () => {
    const base = room();
    base.decisions[0]!.candidates.push(
      { id: "candidate:2", offerId: "offer:2", summary: { title: "Two", detail: "Two", priceLabel: "₹2" }, source: "recommendation", recommendedByParticipantId: "participant:two", createdAt: base.createdAt },
      { id: "candidate:3", offerId: "offer:3", summary: { title: "Three", detail: "Three", priceLabel: "₹3" }, source: "recommendation", createdAt: base.createdAt },
      { id: "candidate:4", offerId: "offer:4", summary: { title: "Four", detail: "Four", priceLabel: "₹4" }, source: "recommendation", createdAt: base.createdAt },
    );
    expect(() => addRecommendation(base, "token-one", "decision:flight", "offer:5", { title: "Five", detail: "Five", priceLabel: "₹5" }, "candidate:5")).toThrow(/maximum of four/);
  });

  it("finalizes a voted additive activity without replacing an existing selection", () => {
    const base = room();
    base.decisions.push({
      id: "decision:activity:add",
      kind: "activity",
      mode: "add",
      date: "2026-10-11",
      locationId: "city:goa",
      label: "Recommended activity · 11 Oct",
      currentOfferId: "offer:activity:2",
      candidates: [{
        id: "candidate:activity:2",
        offerId: "offer:activity:2",
        summary: { title: "Sunset cruise", detail: "17:00–19:00", priceLabel: "₹1,200" },
        source: "recommendation",
        recommendedByParticipantId: "participant:one",
        createdAt: base.createdAt,
      }],
    });
    const next = voteForCandidate(base, "token-one", "decision:activity:add", "candidate:activity:2");
    expect(buildFinalizationProposal(next).operations).toContainEqual({
      type: "add_activity",
      nextOfferId: "offer:activity:2",
      travellerIds: ["traveller:1"],
    });
  });
});
