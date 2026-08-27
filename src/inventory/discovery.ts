import { createHash } from "node:crypto";
import { calendarDayDifference } from "@/domain/dates";
import type { Constraint, PlannableTripRequest } from "@/domain/model";
import type {
  CandidateFactBundle,
  FactBundle,
  GroundedFact,
  ObservationBundle,
} from "@/agent/contracts";
import {
  factBundleSchema,
  observationBundleSchema,
} from "@/agent/contracts";
import type {
  DestinationDiscoveryRepository,
  DestinationMarketProfile,
  PlannerCatalogRepository,
  TransportInventoryRepository,
  StayInventoryRepository,
  ActivityInventoryRepository,
} from "@/inventory/repository";
import {
  searchActivities,
  searchStays,
  searchTransport,
} from "@/inventory/service";

type DiscoveryRepository = DestinationDiscoveryRepository &
  PlannerCatalogRepository &
  TransportInventoryRepository &
  StayInventoryRepository &
  ActivityInventoryRepository;

export interface DestinationDiscoveryResult {
  observation: ObservationBundle;
  factBundle: FactBundle;
  profiles: DestinationMarketProfile[];
  inventoryVersion: string;
}

function normalized(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLocaleLowerCase("en")).filter(Boolean))];
}

function constraintsFor<K extends Constraint["category"]>(
  request: PlannableTripRequest,
  category: K,
): Extract<Constraint, { category: K }>[] {
  return request.constraints.filter(
    (constraint): constraint is Extract<Constraint, { category: K }> =>
      constraint.category === category,
  );
}

function factId(candidateId: string, dimension: string): string {
  return `fact:${createHash("sha256").update(`${candidateId}:${dimension}`).digest("hex").slice(0, 20)}`;
}

function fact(
  profile: DestinationMarketProfile,
  dimension: string,
  label: string,
  value: GroundedFact["value"],
): GroundedFact {
  return {
    id: factId(profile.id, dimension),
    subjectType: "market",
    subjectId: profile.id,
    dimension,
    label,
    value,
  };
}

function profileScore(profile: DestinationMarketProfile, interests: string[]): number {
  const tags = new Set(normalized(profile.tags));
  return interests.reduce((score, interest) => score + (tags.has(interest) ? 1 : 0), 0);
}

function conservativeMaximum(request: PlannableTripRequest): number | undefined {
  const budget = request.constraints.find(
    (constraint) => constraint.category === "budget" && !constraint.travellerIds?.length,
  );
  return budget?.category === "budget" ? budget.value.maxTotal?.amount : undefined;
}

export async function discoverDestinations(
  request: PlannableTripRequest,
  repository: DiscoveryRepository,
): Promise<DestinationDiscoveryResult> {
  const [catalog, allProfiles] = await Promise.all([
    repository.getPlannerCatalog(),
    repository.getDestinationMarketProfiles(),
  ]);
  const interests = normalized(request.preferences.interests ?? []);
  const profiles = [...allProfiles]
    .sort(
      (left, right) =>
        profileScore(right, interests) - profileScore(left, interests) ||
        left.displayOrder - right.displayOrder ||
        left.id.localeCompare(right.id, "en"),
    )
    .slice(0, 6);
  const nights = calendarDayDifference(request.startDate, request.endDate);
  const travellerCount = request.travellers.length;
  const maximum = conservativeMaximum(request);

  const evaluated = await Promise.all(
    profiles.map(async (profile) => {
      const [outbound, returning, stays, activities] = await Promise.all([
        searchTransport(
          {
            from: request.origin,
            to: profile.id,
            date: request.startDate,
            travellers: request.travellers,
            constraints: constraintsFor(request, "travel"),
          },
          repository,
        ),
        searchTransport(
          {
            from: profile.id,
            to: request.origin,
            date: request.endDate,
            travellers: request.travellers,
            constraints: constraintsFor(request, "travel"),
          },
          repository,
        ),
        searchStays(
          {
            locationId: profile.id,
            checkIn: request.startDate,
            checkOut: request.endDate,
            travellers: request.travellers,
            constraints: constraintsFor(request, "stay"),
          },
          repository,
        ),
        searchActivities(
          {
            locationId: profile.id,
            startDate: request.startDate,
            endDate: request.endDate,
            travellers: request.travellers,
            interests,
            constraints: constraintsFor(request, "activity"),
          },
          repository,
        ),
      ]);
      const outboundOffer = outbound.results[0];
      const returnOffer = returning.results[0];
      const stayOffer = stays.results[0];
      if (!outboundOffer || !returnOffer || !stayOffer) return undefined;

      const travelFloor =
        (outboundOffer.price.amount + returnOffer.price.amount) * travellerCount;
      const stayFloor = stayOffer.price.amount * stayOffer.rooms * nights;
      const priceFloor = travelFloor + stayFloor;
      if (maximum !== undefined && priceFloor > maximum) return undefined;
      const tags = normalized([
        ...profile.tags,
        ...activities.results.flatMap((offer) => offer.activityFacts.tags),
      ]).sort();
      const facts = [
        fact(profile, "name", "Destination", profile.name),
        fact(profile, "region", "Market region", profile.region),
        fact(profile, "country", "Country code", profile.countryCode),
        fact(profile, "themes", "Supported themes", tags.join(", ") || "general"),
        fact(profile, "theme_matches", "Requested interest matches", profileScore(profile, interests)),
        fact(profile, "price_floor", "Conservative trip price floor (INR)", priceFloor),
        fact(profile, "travel_floor", "Return travel price floor (INR)", travelFloor),
        fact(profile, "stay_floor", "Stay price floor (INR)", stayFloor),
        fact(
          profile,
          "travel_minutes",
          "Fastest observed return travel minutes",
          outboundOffer.durationMinutes + returnOffer.durationMinutes,
        ),
        fact(profile, "activity_options", "Available activity options", activities.resultCount),
      ];
      return { profile, facts };
    }),
  );

  const valid = evaluated.filter(
    (item): item is { profile: DestinationMarketProfile; facts: GroundedFact[] } =>
      Boolean(item),
  );
  const candidates: CandidateFactBundle[] = valid.map(({ profile, facts }) => ({
    candidateId: profile.id,
    facts,
  }));
  const queryId = `query:destination-discovery:${createHash("sha256")
    .update(
      JSON.stringify({
        origin: request.origin,
        startDate: request.startDate,
        endDate: request.endDate,
        travellers: request.travellers.map((traveller) => traveller.id),
        interests,
        candidates: candidates.map((candidate) => candidate.candidateId),
        inventoryVersion: catalog.inventoryVersion,
      }),
    )
    .digest("hex")}`;
  const observation = observationBundleSchema.parse({
    queryId,
    toolName: "discover_destinations",
    coverage:
      candidates.length > 0 ? { status: "available" } : { status: "no_availability" },
    candidates,
    rejectedSummary: [
      {
        reason: "Unsupported, unreachable, unavailable, or above the hard budget floor",
        count: profiles.length - valid.length,
      },
    ],
  });
  const factBundle = factBundleSchema.parse({
    facts: candidates.flatMap((candidate) => candidate.facts),
    allowedComparisonDimensions: [
      "price",
      "duration",
      "activity_fit",
      "pace",
      "location",
    ],
    allowedFollowUpActions: [],
  });

  return {
    observation,
    factBundle,
    profiles: valid.map((item) => item.profile),
    inventoryVersion: catalog.inventoryVersion,
  };
}
