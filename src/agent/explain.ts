import { createHash } from "node:crypto";
import { z } from "zod";
import {
  factBundleSchema,
  type FactBundle,
  type GroundedFact,
} from "@/agent/contracts";
import {
  explanationDraftSchema,
  type ExplanationDraft,
  type ExplanationModel,
  type ExplanationResult,
} from "@/agent/explanation-contracts";
import { factsForInventoryOffer } from "@/agent/executor";
import type {
  ActivitySelection,
  StaySelection,
  TravelSelection,
  TripState,
} from "@/domain/model";
import { tripStateSchema, type HydratedSelection, type TripProjection } from "@/domain/trip";
import { projectTrip } from "@/domain/trip";
import { createInventoryRepository } from "@/inventory/repository";
import { resolveOffer } from "@/inventory/service";

type Selection = TravelSelection | StaySelection | ActivitySelection;

const explainRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(800),
    trip: tripStateSchema,
    selectionId: z.string().trim().min(1).optional(),
  })
  .strict();

export interface ExplainDependencies {
  model?: ExplanationModel;
  repository?: ReturnType<typeof createInventoryRepository>;
  loadProjection?: (trip: TripState) => Promise<TripProjection>;
}

export class ExplainError extends Error {
  constructor(
    public readonly code: "INVALID_REQUEST" | "INVENTORY_FAILURE",
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ExplainError";
  }
}

function allSelections(trip: TripState): Selection[] {
  return [...trip.selectedTravel, ...trip.selectedStays, ...trip.selectedActivities];
}

function tripFact(
  tripId: string,
  dimension: string,
  label: string,
  value: GroundedFact["value"],
): GroundedFact {
  return {
    id: `fact:trip:${createHash("sha256")
      .update(`${tripId}:${dimension}:${String(value)}`)
      .digest("hex")
      .slice(0, 20)}`,
    subjectType: "trip",
    subjectId: tripId,
    dimension,
    label,
    value,
  };
}

function relevantConstraintFacts(trip: TripState): GroundedFact[] {
  return trip.request.constraints.slice(0, 8).map((constraint) => {
    let value: string;
    if (constraint.category === "budget") {
      const maximum = constraint.value.maxTotal?.amount;
      const target = constraint.value.targetTotal?.amount;
      value = maximum !== undefined
        ? `Maximum INR ${maximum}`
        : target !== undefined
          ? `Target INR ${target}`
          : "Budget preference";
    } else {
      value = JSON.stringify(constraint.value);
    }
    return tripFact(
      trip.id,
      `constraint:${constraint.id}`,
      `${constraint.priority} ${constraint.category} constraint`,
      value,
    );
  });
}

function salientFacts(item: HydratedSelection, travellerCount: number): GroundedFact[] {
  const priority = [
    "total_price",
    "departure",
    "arrival",
    "duration",
    "property_name",
    "activity_name",
    "location",
    "start",
    "rating",
    "mode",
  ];
  const facts = factsForInventoryOffer(item.offer, travellerCount);
  return priority.flatMap((dimension) => {
    const fact = facts.find((candidate) => candidate.dimension === dimension);
    return fact ? [fact] : [];
  }).slice(0, 4);
}

function selectionContextFacts(
  trip: TripState,
  projection: TripProjection,
  targetSelectionId?: string,
): GroundedFact[] {
  const selectionById = new Map(allSelections(trip).map((selection) => [selection.id, selection]));
  const target = targetSelectionId
    ? projection.hydratedSelections.find((item) => item.selectionId === targetSelectionId)
    : undefined;
  const facts: GroundedFact[] = [];

  if (target) {
    const selection = selectionById.get(target.selectionId)!;
    facts.push(...factsForInventoryOffer(target.offer, selection.travellerIds.length));
    facts.push(
      tripFact(
        trip.id,
        `selection:${selection.id}:lock`,
        `Selection ${selection.id} lock state`,
        selection.locked,
      ),
    );
  }

  projection.hydratedSelections.forEach((item) => {
    if (item.selectionId !== targetSelectionId) {
      facts.push(
        ...salientFacts(
          item,
          selectionById.get(item.selectionId)?.travellerIds.length ?? trip.request.travellers.length,
        ),
      );
    }
  });
  return facts.slice(0, 40);
}

export function buildExplanationFactBundle(
  trip: TripState,
  projection: TripProjection,
  targetSelectionId?: string,
): FactBundle {
  const tripFacts: GroundedFact[] = [
    tripFact(trip.id, "trip_total", "Validated trip total (INR)", projection.budget.total.amount),
    tripFact(trip.id, "travel_total", "Travel total (INR)", projection.budget.breakdown.travel.amount),
    tripFact(trip.id, "stays_total", "Stay total (INR)", projection.budget.breakdown.stays.amount),
    tripFact(trip.id, "activities_total", "Activity total (INR)", projection.budget.breakdown.activities.amount),
    tripFact(trip.id, "trip_dates", "Trip dates", `${trip.request.startDate} to ${trip.request.endDate}`),
    tripFact(
      trip.id,
      "route_stops",
      "Ordered route stops",
      trip.route.stops.map((stop) => `${stop.locationId} (${stop.checkIn} to ${stop.checkOut})`).join(" → "),
    ),
    tripFact(trip.id, "pace", "Requested trip pace", trip.request.preferences.pace ?? "unspecified"),
    tripFact(
      trip.id,
      "interests",
      "Requested interests",
      (trip.request.preferences.interests ?? []).join(", ") || "none supplied",
    ),
    tripFact(trip.id, "validation", "Current trip validation", projection.validation.valid),
  ];
  const facts = [
    ...tripFacts,
    ...relevantConstraintFacts(trip),
    ...selectionContextFacts(trip, projection, targetSelectionId),
  ];
  const uniqueFacts = [...new Map(facts.map((fact) => [fact.id, fact])).values()];
  const dimensions = new Set(uniqueFacts.map((fact) => fact.dimension));
  const comparisonPriority = [
    "total_price",
    "unit_price",
    "duration",
    "departure",
    "arrival",
    "rating",
    "location",
    "mobility",
    "trip_total",
    "travel_total",
    "stays_total",
    "activities_total",
  ];
  return factBundleSchema.parse({
    facts: uniqueFacts,
    allowedComparisonDimensions: [
      ...comparisonPriority.filter((dimension) => dimensions.has(dimension)),
      ...[...dimensions]
        .filter((dimension) => !comparisonPriority.includes(dimension))
        .sort((left, right) => left.localeCompare(right, "en")),
    ].slice(0, 12),
    allowedFollowUpActions: [],
  });
}

function numericTokens(value: string): Set<string> {
  return new Set(
    (value.match(/\d[\d,.]*/g) ?? []).map((token) => token.replaceAll(",", "")),
  );
}

const comparativePattern = /\b(than|compared|cheaper|costlier|faster|slower|better|best|more|less|lower|higher)\b/i;

export function explanationIsGrounded(
  raw: unknown,
  factBundle: FactBundle,
  targetOfferId?: string,
): raw is ExplanationDraft {
  const parsed = explanationDraftSchema.safeParse(raw);
  if (!parsed.success) return false;
  const facts = new Map(factBundle.facts.map((fact) => [fact.id, fact]));
  const allReferenced = new Set<string>();

  for (const sentence of parsed.data.sentences) {
    if (new Set(sentence.supportingFactIds).size !== sentence.supportingFactIds.length) return false;
    const supportingFacts = sentence.supportingFactIds.flatMap((id) => {
      const fact = facts.get(id);
      return fact ? [fact] : [];
    });
    if (supportingFacts.length !== sentence.supportingFactIds.length) return false;
    sentence.supportingFactIds.forEach((id) => allReferenced.add(id));

    if (
      comparativePattern.test(sentence.text) &&
      (
        new Set(supportingFacts.map((fact) => fact.subjectId)).size < 2 ||
        new Set(supportingFacts.map((fact) => fact.subjectType)).size !== 1 ||
        ![...new Set(supportingFacts.map((fact) => fact.dimension))].some(
          (dimension) =>
            new Set(
              supportingFacts
                .filter((fact) => fact.dimension === dimension)
                .map((fact) => fact.subjectId),
            ).size >= 2,
        )
      )
    ) {
      return false;
    }
    const supportedNumbers = numericTokens(
      supportingFacts.map((fact) => `${fact.label} ${String(fact.value)}`).join(" "),
    );
    if ([...numericTokens(sentence.text)].some((number) => !supportedNumbers.has(number))) {
      return false;
    }
  }
  return !targetOfferId || [...allReferenced].some((id) => facts.get(id)?.subjectId === targetOfferId);
}

function factByDimension(
  factBundle: FactBundle,
  subjectId: string,
  dimension: string,
): GroundedFact | undefined {
  return factBundle.facts.find(
    (fact) => fact.subjectId === subjectId && fact.dimension === dimension,
  );
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function deterministicExplanation(
  trip: TripState,
  projection: TripProjection,
  factBundle: FactBundle,
  target?: HydratedSelection,
): { message: string; supportingFactIds: string[] } {
  const tripTotal = factByDimension(factBundle, trip.id, "trip_total")!;
  const validation = factByDimension(factBundle, trip.id, "validation")!;
  const route = factByDimension(factBundle, trip.id, "route_stops")!;
  if (!target) {
    return {
      message: `This plan follows ${String(route.value)} and has a validated total of ${formatInr(projection.budget.total.amount)}. The current route, dates, stays, and travel selections pass deterministic trip validation.`,
      supportingFactIds: [route.id, tripTotal.id, validation.id],
    };
  }

  const offer = target.offer;
  const travellerCount =
    allSelections(trip).find((selection) => selection.id === target.selectionId)?.travellerIds.length ??
    trip.request.travellers.length;
  const facts = (dimension: string) => factByDimension(factBundle, offer.id, dimension);
  let message: string;
  let chosen: Array<GroundedFact | undefined>;
  if ("serviceId" in offer) {
    chosen = [facts("operator"), facts("mode"), facts("departure"), facts("arrival"), facts("total_price")];
    message = `${offer.operator} ${offer.mode} is scheduled from ${offer.departureAt} to ${offer.arrivalAt} and costs ${formatInr(offer.price.amount * travellerCount)} for the selected travellers.`;
  } else if ("transferId" in offer) {
    chosen = [facts("mode"), facts("from"), facts("to"), facts("duration"), facts("total_price")];
    message = `This ${offer.mode} transfer connects ${offer.from} to ${offer.to}, takes ${offer.durationMinutes} minutes, and costs ${formatInr(offer.price.amount * Math.ceil(travellerCount / offer.capacity))}.`;
  } else if ("roomOfferId" in offer) {
    chosen = [facts("property_name"), facts("check_in"), facts("check_out"), facts("total_price"), facts("rating")];
    const nights = Math.round((Date.parse(`${offer.checkOut}T00:00:00Z`) - Date.parse(`${offer.checkIn}T00:00:00Z`)) / 86_400_000);
    message = `${offer.propertyFacts.name} covers ${offer.checkIn} to ${offer.checkOut} and costs ${formatInr(offer.price.amount * offer.rooms * nights)} for the required room count.`;
  } else {
    chosen = [facts("activity_name"), facts("start"), facts("duration"), facts("total_price"), facts("mobility")];
    message = `${offer.activityFacts.name} starts at ${offer.startsAt}, has ${offer.activityFacts.mobility} mobility load, and costs ${formatInr(offer.price.amount * travellerCount)} for the selected travellers.`;
  }
  return {
    message: `${message} It remains part of a trip that currently passes deterministic validation.`,
    supportingFactIds: [...chosen.flatMap((fact) => (fact ? [fact.id] : [])), validation.id],
  };
}

export async function runExplanation(
  raw: unknown,
  dependencies: ExplainDependencies = {},
): Promise<ExplanationResult> {
  const parsed = explainRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExplainError(
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid explanation request",
      400,
      false,
    );
  }
  const trip = parsed.data.trip as TripState;
  const selection = parsed.data.selectionId
    ? allSelections(trip).find((item) => item.id === parsed.data.selectionId)
    : undefined;
  if (parsed.data.selectionId && !selection) {
    throw new ExplainError("INVALID_REQUEST", "The explanation target is not a trip selection", 400, false);
  }

  let projection: TripProjection;
  try {
    if (dependencies.loadProjection) {
      projection = await dependencies.loadProjection(trip);
    } else {
      const repository = dependencies.repository ?? createInventoryRepository();
      const catalog = await repository.getPlannerCatalog();
      projection = await projectTrip(trip, {
        locationGraph: catalog.locationGraph,
        resolveOffer: (offerId) => resolveOffer(offerId, repository),
      });
    }
  } catch {
    throw new ExplainError(
      "INVENTORY_FAILURE",
      "Current trip facts could not be resolved for explanation",
      503,
      true,
    );
  }
  if (!projection.validation.valid) {
    throw new ExplainError("INVALID_REQUEST", "Only a valid committed trip can be explained", 422, false);
  }

  const target = parsed.data.selectionId
    ? projection.hydratedSelections.find((item) => item.selectionId === parsed.data.selectionId)
    : undefined;
  if (parsed.data.selectionId && !target) {
    throw new ExplainError("INVALID_REQUEST", "The explanation target could not be resolved", 422, false);
  }
  const factBundle = buildExplanationFactBundle(trip, projection, parsed.data.selectionId);
  let draft: ExplanationDraft | undefined;
  if (dependencies.model) {
    try {
      const output = await dependencies.model.explain({
        question: parsed.data.question,
        targetSelectionId: parsed.data.selectionId,
        factBundle,
      });
      if (explanationIsGrounded(output, factBundle, target?.offer.id)) draft = output;
    } catch {
      draft = undefined;
    }
  }

  if (!draft) {
    const fallback = deterministicExplanation(trip, projection, factBundle, target);
    return {
      type: "explanation",
      message: fallback.message,
      supportingFactIds: fallback.supportingFactIds,
      factBundle,
      targetSelectionId: parsed.data.selectionId,
      usedFallback: true,
    };
  }
  return {
    type: "explanation",
    message: draft.sentences.map((sentence) => sentence.text).join(" "),
    supportingFactIds: [...new Set(draft.sentences.flatMap((sentence) => sentence.supportingFactIds))],
    factBundle,
    targetSelectionId: parsed.data.selectionId,
    usedFallback: false,
  };
}
