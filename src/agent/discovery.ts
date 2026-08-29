import { z } from "zod";
import type { FactBundle, GroundedFact } from "@/agent/contracts";
import {
  optionComparisonBlockSchema,
  type OptionComparisonBlock,
} from "@/agent/adaptive-contracts";
import type { PlannableTripRequest } from "@/domain/model";
import { plannableTripRequestSchema } from "@/domain/request";
import {
  discoverDestinations,
  type DestinationDiscoveryResult,
} from "@/inventory/discovery";
import {
  createInventoryRepository,
  type DestinationMarketProfile,
} from "@/inventory/repository";

const idSchema = z.string().trim().min(1);

export const destinationRecommendationSchema = z
  .object({
    candidateMarketIds: z.array(idSchema).min(2).max(4),
    recommendedMarketId: idSchema,
    supportingFactIds: z.array(idSchema).min(1).max(8),
    comparisonDimensions: z
      .array(z.enum(["price", "duration", "activity_fit", "pace", "location"]))
      .min(1)
      .max(5),
  })
  .strict();

export type DestinationRecommendation = z.infer<typeof destinationRecommendationSchema>;

export interface DestinationDiscoveryModel {
  recommendDestinations(input: {
    request: PlannableTripRequest;
    candidates: Array<{ candidateId: string; facts: GroundedFact[] }>;
    allowedComparisonDimensions: string[];
  }): Promise<DestinationRecommendation>;
}

export interface DestinationOption {
  id: string;
  name: string;
  countryCode: string;
  region: "india" | "international";
  tags: string[];
  imageAssetKey?: string;
  imageUrl?: string;
  imageAltText?: string;
}

export type DestinationDiscoveryApiResult =
  | {
      type: "destination_options";
      block: OptionComparisonBlock;
      factBundle: FactBundle;
      options: DestinationOption[];
      matchingDestinationCount?: number;
      shortlistedDestinationCount?: number;
      recommendationExplanation?: string;
      message: string;
    }
  | {
      type: "conflict";
      reason: "insufficient_market_coverage" | "no_valid_destinations";
      availableCandidateCount: number;
      message: string;
    };

export interface DestinationDiscoveryDependencies {
  model?: DestinationDiscoveryModel;
  repository?: ReturnType<typeof createInventoryRepository>;
  discover?: typeof discoverDestinations;
}

export class DestinationDiscoveryError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REQUEST"
      | "MODEL_FAILURE"
      | "INVALID_MODEL_OUTPUT"
      | "INVENTORY_FAILURE",
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DestinationDiscoveryError";
  }
}

function asOption(profile: DestinationMarketProfile): DestinationOption {
  return {
    id: profile.id,
    name: profile.name,
    countryCode: profile.countryCode,
    region: profile.region,
    tags: profile.tags,
    imageAssetKey: profile.imageAssetKey,
    imageUrl: profile.imageUrl,
    imageAltText: profile.imageAltText,
  };
}

function validateRecommendation(
  raw: DestinationRecommendation,
  discovery: DestinationDiscoveryResult,
): DestinationRecommendation {
  const parsed = destinationRecommendationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DestinationDiscoveryError(
      "INVALID_MODEL_OUTPUT",
      "The planner returned an invalid destination comparison",
      502,
      false,
    );
  }
  const recommendation = parsed.data;
  const candidateFacts = new Map(
    discovery.observation.candidates.map((candidate) => [
      candidate.candidateId,
      new Set(candidate.facts.map((fact) => fact.id)),
    ]),
  );
  const uniqueChoices = new Set(recommendation.candidateMarketIds);
  const selectedFactIds = new Set(
    recommendation.candidateMarketIds.flatMap((candidateId) => [
      ...(candidateFacts.get(candidateId) ?? []),
    ]),
  );
  const allowedDimensions = new Set(discovery.factBundle.allowedComparisonDimensions);
  if (
    uniqueChoices.size !== recommendation.candidateMarketIds.length ||
    !recommendation.candidateMarketIds.includes(recommendation.recommendedMarketId) ||
    recommendation.candidateMarketIds.some((id) => !candidateFacts.has(id)) ||
    recommendation.supportingFactIds.some((id) => !selectedFactIds.has(id)) ||
    recommendation.comparisonDimensions.some((dimension) => !allowedDimensions.has(dimension))
  ) {
    throw new DestinationDiscoveryError(
      "INVALID_MODEL_OUTPUT",
      "The destination recommendation was not grounded in supplied candidates",
      502,
      false,
    );
  }
  return recommendation;
}

function deterministicRecommendation(discovery: DestinationDiscoveryResult): DestinationRecommendation {
  const candidates = [...discovery.observation.candidates]
    .sort((left, right) => {
      const matches = (candidate: typeof left) => Number(candidate.facts.find((fact) => fact.dimension === "theme_matches")?.value ?? 0);
      const price = (candidate: typeof left) => Number(candidate.facts.find((fact) => fact.dimension === "price_floor")?.value ?? Number.POSITIVE_INFINITY);
      const travel = (candidate: typeof left) => Number(candidate.facts.find((fact) => fact.dimension === "travel_minutes")?.value ?? Number.POSITIVE_INFINITY);
      const activities = (candidate: typeof left) => Number(candidate.facts.find((fact) => fact.dimension === "activity_options")?.value ?? 0);
      return matches(right) - matches(left) || travel(left) - travel(right) || price(left) - price(right) || activities(right) - activities(left) || left.candidateId.localeCompare(right.candidateId, "en");
    })
    .slice(0, 4);
  const dimensions = discovery.factBundle.allowedComparisonDimensions.slice(0, 2) as DestinationRecommendation["comparisonDimensions"];
  return destinationRecommendationSchema.parse({
    candidateMarketIds: candidates.map((candidate) => candidate.candidateId),
    recommendedMarketId: candidates[0]!.candidateId,
    supportingFactIds: candidates.flatMap((candidate) => candidate.facts.slice(0, 2).map((fact) => fact.id)).slice(0, 8),
    comparisonDimensions: dimensions.length > 0 ? dimensions : ["price"],
  });
}

function recommendationExplanation(
  recommendation: DestinationRecommendation,
  discovery: DestinationDiscoveryResult,
  profiles: Map<string, DestinationMarketProfile>,
): string {
  const candidate = discovery.observation.candidates.find((item) => item.candidateId === recommendation.recommendedMarketId);
  const name = profiles.get(recommendation.recommendedMarketId)?.name ?? "This destination";
  const value = (dimension: string) => candidate?.facts.find((fact) => fact.dimension === dimension)?.value;
  const matches = Number(value("theme_matches") ?? 0);
  const price = Number(value("price_floor") ?? 0);
  const travel = Number(value("travel_minutes") ?? 0);
  const activities = Number(value("activity_options") ?? 0);
  const fit = matches > 0 ? `${matches} requested theme match${matches === 1 ? "" : "es"}` : "the strongest combination of travel time and price";
  return `I recommend ${name} for ${fit}. Its conservative trip floor is ₹${price.toLocaleString("en-IN")}, observed return travel is ${Math.floor(travel / 60)}h ${travel % 60}m, and ${activities} activity option${activities === 1 ? " is" : "s are"} available for these dates.`;
}

export async function runDestinationDiscovery(
  rawRequest: unknown,
  dependencies: DestinationDiscoveryDependencies,
): Promise<DestinationDiscoveryApiResult> {
  const parsed = plannableTripRequestSchema.safeParse(rawRequest);
  if (!parsed.success || parsed.data.destination.kind !== "open") {
    throw new DestinationDiscoveryError(
      "INVALID_REQUEST",
      parsed.success
        ? "Destination discovery requires an open destination intent"
        : (parsed.error.issues[0]?.message ?? "Invalid destination discovery request"),
      400,
      false,
    );
  }
  const request = parsed.data as PlannableTripRequest;
  const repository = dependencies.repository ?? createInventoryRepository();
  let discovery: DestinationDiscoveryResult;
  try {
    discovery = await (dependencies.discover ?? discoverDestinations)(request, repository);
  } catch (error: unknown) {
    console.error("Destination inventory discovery failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw new DestinationDiscoveryError(
      "INVENTORY_FAILURE",
      "Destination inventory is temporarily unavailable",
      503,
      true,
    );
  }
  const candidateCount = discovery.observation.candidates.length;
  const matchingDestinationCount = discovery.matchingDestinationCount;
  if (candidateCount < 2) {
    return {
      type: "conflict",
      reason:
        candidateCount === 0
          ? "no_valid_destinations"
          : "insufficient_market_coverage",
      availableCandidateCount: candidateCount,
      message:
        candidateCount === 0
          ? "No supported destination has complete travel and stay coverage for this request."
          : "Only one fully supported destination is currently available, so a meaningful comparison cannot be shown yet.",
    };
  }

  let recommendation: DestinationRecommendation;
  try {
    if (!dependencies.model) throw new Error("No contextual ranker configured");
    const rawRecommendation = await dependencies.model.recommendDestinations({
      request,
      candidates: discovery.observation.candidates,
      allowedComparisonDimensions: discovery.factBundle.allowedComparisonDimensions,
    });
    recommendation = validateRecommendation(rawRecommendation, discovery);
  } catch {
    // Candidate validity is deterministic. If the model is unavailable or
    // returns an ungrounded ranking, continue with a reproducible price-first
    // recommendation rather than blocking destination discovery.
    recommendation = deterministicRecommendation(discovery);
  }
  const profiles = new Map(discovery.profiles.map((profile) => [profile.id, profile]));
  const orderedIds = [
    ...recommendation.candidateMarketIds,
    ...discovery.observation.candidates.map((candidate) => candidate.candidateId),
  ].filter((id, index, ids) => ids.indexOf(id) === index);

  return {
    type: "destination_options",
    block: optionComparisonBlockSchema.parse({
      type: "option_comparison",
      entityType: "destination",
      choices: recommendation.candidateMarketIds.map((optionId) => ({ optionId })),
      emphasis: {
        recommendedId: recommendation.recommendedMarketId,
        comparisonDimensions: recommendation.comparisonDimensions,
        supportingFactIds: recommendation.supportingFactIds,
      },
    }),
    factBundle: discovery.factBundle,
    options: orderedIds.map((id) => asOption(profiles.get(id)!)),
    matchingDestinationCount,
    shortlistedDestinationCount: recommendation.candidateMarketIds.length,
    recommendationExplanation: recommendationExplanation(recommendation, discovery, profiles),
    message: `I found ${matchingDestinationCount} destinations that satisfy the hard trip constraints and shortlisted the strongest matches.`,
  };
}
