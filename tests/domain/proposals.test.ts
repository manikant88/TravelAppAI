import { describe, expect, it } from "vitest";
import {
  applyProposal,
  deriveProposalPreview,
  type TripProposal,
} from "@/domain/proposals";
import { projectTrip, type ResolvedOffer } from "@/domain/trip";
import type { TripState } from "@/domain/model";
import type {
  ActivityOffer,
  StayOffer,
  TransferOffer,
  TransportOffer,
} from "@/inventory/contracts";

const outbound: TransportOffer = {
  id: "offer:transport:outbound",
  serviceId: "service:outbound",
  mode: "flight",
  from: "city:delhi",
  to: "airport:udr",
  departureAt: "2026-10-10T07:00:00+05:30",
  arrivalAt: "2026-10-10T08:20:00+05:30",
  durationMinutes: 80,
  stops: 0,
  operator: "Example Air",
  segments: [],
  price: { amount: 5_000, currency: "INR", unit: "per_traveller" },
};
const returning: TransportOffer = {
  ...outbound,
  id: "offer:transport:return",
  serviceId: "service:return",
  from: "airport:udr",
  to: "city:delhi",
  departureAt: "2026-10-12T18:00:00+05:30",
  arrivalAt: "2026-10-12T19:20:00+05:30",
};
const arrivalTransfer: TransferOffer = {
  id: "offer:transfer:arrival",
  transferId: "transfer:arrival",
  from: "airport:udr",
  to: "neighborhood:old-city",
  mode: "car",
  durationMinutes: 45,
  capacity: 3,
  price: { amount: 1_200, currency: "INR", unit: "per_vehicle" },
};
const departureTransfer: TransferOffer = {
  ...arrivalTransfer,
  id: "offer:transfer:departure",
  transferId: "transfer:departure",
  from: "neighborhood:old-city",
  to: "airport:udr",
};
const stay: StayOffer = {
  id: "offer:stay:current",
  roomOfferId: "room:current",
  propertyId: "property:current",
  locationId: "neighborhood:old-city",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12",
  rooms: 1,
  propertyFacts: {
    name: "Current House",
    rating: 4.4,
    reviewCount: 100,
    amenities: ["wifi"],
    accessibility: [],
    tags: [],
    imageAssetKey: "current",
  },
  roomFacts: { roomLabel: "Double", maxOccupancy: 2, mealPlan: "none", refundable: true },
  price: { amount: 3_000, currency: "INR", unit: "per_room_per_night" },
};
const cheaperStay: StayOffer = {
  ...stay,
  id: "offer:stay:cheaper",
  roomOfferId: "room:cheaper",
  propertyId: "property:cheaper",
  propertyFacts: { ...stay.propertyFacts, name: "Cheaper House" },
  price: { ...stay.price, amount: 2_000 },
};
const activity: ActivityOffer = {
  id: "offer:activity:walk",
  activityId: "activity:walk",
  sessionId: "session:walk",
  locationId: "neighborhood:old-city",
  startsAt: "2026-10-11T10:00:00+05:30",
  endsAt: "2026-10-11T12:00:00+05:30",
  capacity: 10,
  activityFacts: {
    name: "Heritage walk",
    tags: ["heritage"],
    mobility: "low",
    childFriendly: true,
    seniorFriendly: true,
    imageAssetKey: "walk",
  },
  price: { amount: 500, currency: "INR", unit: "per_participant" },
};
const addedActivity: ActivityOffer = {
  ...activity,
  id: "offer:activity:food",
  activityId: "activity:food",
  sessionId: "session:food",
  startsAt: "2026-10-11T16:00:00+05:30",
  endsAt: "2026-10-11T18:00:00+05:30",
  activityFacts: { ...activity.activityFacts, name: "Food trail", tags: ["food"] },
};

const offers = new Map<string, ResolvedOffer>([
  [outbound.id, outbound],
  [returning.id, returning],
  [arrivalTransfer.id, arrivalTransfer],
  [departureTransfer.id, departureTransfer],
  [stay.id, stay],
  [cheaperStay.id, cheaperStay],
  [activity.id, activity],
  [addedActivity.id, addedActivity],
]);

const context = {
  locationGraph: [
    { id: "country:in" },
    { id: "city:delhi", parentId: "country:in" },
    { id: "city:udaipur", parentId: "country:in" },
    { id: "airport:udr", parentId: "city:udaipur" },
    { id: "neighborhood:old-city", parentId: "city:udaipur" },
  ],
  async resolveOffer(offerId: string) {
    const offer = offers.get(offerId);
    if (!offer) throw new Error("Missing offer");
    return offer;
  },
};

function trip(locked = false): TripState {
  const travellerIds = ["traveller:1", "traveller:2"];
  return {
    id: "trip:1",
    inventoryVersion: "travel-seed-v1",
    request: {
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "city:udaipur" },
      startDate: "2026-10-10",
      endDate: "2026-10-12",
      travellers: [
        { id: travellerIds[0], type: "adult" },
        { id: travellerIds[1], type: "adult" },
      ],
      preferences: { pace: "balanced", interests: ["heritage"] },
      constraints: [],
    },
    route: {
      marketId: "city:udaipur",
      stops: [
        { locationId: "neighborhood:old-city", checkIn: "2026-10-10", checkOut: "2026-10-12" },
      ],
    },
    selectedTravel: [
      { id: "selection:outbound", kind: "travel", offerKind: "transport", offerId: outbound.id, travellerIds, locked: false },
      { id: "selection:return", kind: "travel", offerKind: "transport", offerId: returning.id, travellerIds, locked: false },
      { id: "selection:arrival", kind: "travel", offerKind: "transfer", offerId: arrivalTransfer.id, travellerIds, locked: false },
      { id: "selection:departure", kind: "travel", offerKind: "transfer", offerId: departureTransfer.id, travellerIds, locked: false },
    ],
    selectedStays: [
      { id: "selection:stay", kind: "stay", offerId: stay.id, travellerIds, locked, checkIn: stay.checkIn, checkOut: stay.checkOut, rooms: 1 },
    ],
    selectedActivities: [
      { id: "selection:activity", kind: "activity", offerId: activity.id, travellerIds, locked: false, date: "2026-10-11" },
    ],
    version: 3,
  };
}

async function projection(base: TripState) {
  return projectTrip(base, context);
}

function replaceStay(base: TripState, operations: TripProposal["operations"]): TripProposal {
  return { id: "proposal:stay", baseTripVersion: base.version, operations };
}

describe("canonical trip proposals", () => {
  it("previews a complete validated replan as one typed request change", async () => {
    const base = trip();
    const nextTrip: TripState = {
      ...base,
      request: {
        ...base.request,
        preferences: { ...base.request.preferences, pace: "relaxed" },
      },
      version: 1,
    };
    const proposal: TripProposal = {
      id: "proposal:replan",
      baseTripVersion: base.version,
      operations: [{ type: "replace_trip_plan", nextTrip }],
    };

    const evaluated = await deriveProposalPreview(base, proposal, await projection(base), context);
    expect(evaluated.preview.nextTrip.version).toBe(base.version + 1);
    expect(evaluated.preview.nextTrip.request.preferences.pace).toBe("relaxed");
    expect(evaluated.preview.changedCategories).toEqual(["request"]);
    expect(evaluated.preview.changedSelectionIds).toEqual([]);
    expect(evaluated.preview.preservedSelectionIds).toHaveLength(6);
  });

  it("rejects a complete replan that does not preserve a locked selection", async () => {
    const base = trip(true);
    const nextTrip: TripState = {
      ...base,
      selectedStays: [{ ...base.selectedStays[0], offerId: cheaperStay.id, locked: false }],
      version: 1,
    };

    await expect(
      deriveProposalPreview(
        base,
        {
          id: "proposal:locked-replan",
          baseTripVersion: base.version,
          operations: [{ type: "replace_trip_plan", nextTrip }],
        },
        await projection(base),
        context,
      ),
    ).rejects.toMatchObject({ code: "LOCKED_SELECTION" });
  });

  it("adds a dated activity only through an approved typed operation", async () => {
    const base = trip();
    const proposal: TripProposal = {
      id: "proposal:add-activity",
      baseTripVersion: base.version,
      operations: [{
        type: "add_activity",
        nextOfferId: addedActivity.id,
        travellerIds: base.request.travellers.map((traveller) => traveller.id),
      }],
    };

    const preview = await deriveProposalPreview(base, proposal, await projection(base), context);
    expect(base.selectedActivities).toHaveLength(1);
    expect(preview.preview.nextTrip.selectedActivities).toHaveLength(2);
    expect(preview.preview.changedSelectionIds).toContain(
      `selection:activity:${addedActivity.id}`,
    );
    expect(preview.preview.changedCategories).toEqual(["activities"]);
  });

  it("derives a valid preview and preserves every unrelated selection", async () => {
    const base = trip();
    const result = await deriveProposalPreview(
      base,
      replaceStay(base, [
        { type: "replace_stay", selectionId: "selection:stay", nextOfferId: cheaperStay.id },
      ]),
      await projection(base),
      context,
    );

    expect(result.preview.nextTrip.version).toBe(4);
    expect(result.preview.nextTrip.selectedStays[0].offerId).toBe(cheaperStay.id);
    expect(result.preview.budgetDelta.amount).toBe(-2_000);
    expect(result.preview.changedSelectionIds).toEqual(["selection:stay"]);
    expect(result.preview.preservedSelectionIds).toEqual(
      expect.arrayContaining(["selection:outbound", "selection:return", "selection:activity"]),
    );
    expect(result.preview.changedCategories).toEqual(["stays"]);
  });

  it("rejects locked replacement unless an explicit unlock comes first", async () => {
    const base = trip(true);
    const current = await projection(base);
    await expect(
      deriveProposalPreview(
        base,
        replaceStay(base, [
          { type: "replace_stay", selectionId: "selection:stay", nextOfferId: cheaperStay.id },
        ]),
        current,
        context,
      ),
    ).rejects.toMatchObject({ code: "LOCKED_SELECTION" });

    await expect(
      deriveProposalPreview(
        base,
        replaceStay(base, [
          { type: "replace_stay", selectionId: "selection:stay", nextOfferId: cheaperStay.id },
          { type: "set_selection_lock", selectionId: "selection:stay", locked: false },
        ]),
        current,
        context,
      ),
    ).rejects.toMatchObject({ code: "LOCKED_SELECTION" });

    const approved = await deriveProposalPreview(
      base,
      replaceStay(base, [
        { type: "set_selection_lock", selectionId: "selection:stay", locked: false },
        { type: "replace_stay", selectionId: "selection:stay", nextOfferId: cheaperStay.id },
      ]),
      current,
      context,
    );
    expect(approved.preview.nextTrip.selectedStays[0]).toMatchObject({
      locked: false,
      offerId: cheaperStay.id,
    });
    expect(approved.preview.changedCategories).toEqual(["locks", "stays"]);
  });

  it("rejects stale proposals before applying an operation", async () => {
    const base = trip();
    await expect(
      deriveProposalPreview(
        base,
        {
          id: "proposal:stale",
          baseTripVersion: 2,
          operations: [{ type: "set_selection_lock", selectionId: "selection:stay", locked: true }],
        },
        await projection(base),
        context,
      ),
    ).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
  });

  it("applies only the approved operations and increments the version once", async () => {
    const base = trip();
    const proposal = replaceStay(base, [
      { type: "set_selection_lock", selectionId: "selection:stay", locked: true },
    ]);
    const result = await applyProposal(base, proposal, await projection(base), context);

    expect(result.trip.version).toBe(base.version + 1);
    expect(result.trip.selectedStays[0].locked).toBe(true);
    expect(result.trip.selectedTravel).toEqual(base.selectedTravel);
    expect(result.trip.selectedActivities).toEqual(base.selectedActivities);
  });

  it("upserts and removes typed constraints without changing inventory selections", async () => {
    const base = trip();
    const constraint = {
      id: "constraint:budget:all",
      category: "budget" as const,
      priority: "hard" as const,
      value: { maxTotal: { amount: 30_000, currency: "INR" as const } },
    };
    const upsert: TripProposal = {
      id: "proposal:budget",
      baseTripVersion: base.version,
      operations: [{ type: "upsert_constraint", constraint }],
    };

    const evaluated = await deriveProposalPreview(base, upsert, await projection(base), context);
    expect(evaluated.preview.changedCategories).toEqual(["constraints"]);
    expect(evaluated.preview.changedSelectionIds).toEqual([]);
    expect(evaluated.preview.preservedSelectionIds).toHaveLength(6);
    const added = await applyProposal(base, upsert, await projection(base), context);
    expect(added.trip.request.constraints).toEqual([constraint]);
    expect(added.trip.selectedTravel).toEqual(base.selectedTravel);
    expect(added.trip.selectedStays).toEqual(base.selectedStays);
    expect(added.trip.selectedActivities).toEqual(base.selectedActivities);

    const remove: TripProposal = {
      id: "proposal:remove-budget",
      baseTripVersion: added.trip.version,
      operations: [{ type: "remove_constraint", constraintId: constraint.id }],
    };
    const removed = await applyProposal(added.trip, remove, added.projection, context);
    expect(removed.trip.request.constraints).toEqual([]);
    expect(removed.trip.version).toBe(base.version + 2);
  });

  it("blocks a hard constraint that invalidates the committed trip", async () => {
    const base = trip();
    const proposal: TripProposal = {
      id: "proposal:impossible-budget",
      baseTripVersion: base.version,
      operations: [{
        type: "upsert_constraint",
        constraint: {
          id: "constraint:budget:all",
          category: "budget",
          priority: "hard",
          value: { maxTotal: { amount: 1_000, currency: "INR" } },
        },
      }],
    };

    await expect(
      deriveProposalPreview(base, proposal, await projection(base), context),
    ).rejects.toMatchObject({ code: "INVALID_RESULT" });
  });
});
