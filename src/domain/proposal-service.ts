import { z } from "zod";
import {
  applyProposal,
  deriveProposalPreview,
  ProposalError,
  tripProposalSchema,
  type ProposalEvaluation,
  type TripProposal,
} from "@/domain/proposals";
import { projectTrip, tripStateSchema } from "@/domain/trip";
import type { TripState } from "@/domain/model";
import { createInventoryRepository } from "@/inventory/repository";
import { resolveOffer } from "@/inventory/service";

const proposalRequestSchema = z
  .object({
    trip: tripStateSchema,
    proposal: tripProposalSchema,
  })
  .strict();

export type ProposalRequest = z.infer<typeof proposalRequestSchema>;

export interface ProposalServiceDependencies {
  repository?: ReturnType<typeof createInventoryRepository>;
}

export class ProposalServiceError extends Error {
  constructor(
    public readonly code:
      | ProposalError["code"]
      | "INVALID_REQUEST"
      | "INVENTORY_FAILURE",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProposalServiceError";
  }
}

function mapError(error: unknown): ProposalServiceError {
  if (error instanceof ProposalServiceError) return error;
  if (error instanceof ProposalError) {
    const status = error.code === "STALE_PROPOSAL" ? 409 : 422;
    const message = /(?:selection|offer|session):/i.test(error.message)
      ? error.code === "INVALID_RESULT"
        ? "That option conflicts with the current itinerary. Choose another time or card."
        : "That change could not be applied to the current itinerary."
      : error.message;
    return new ProposalServiceError(error.code, message, status);
  }
  return new ProposalServiceError(
    "INVENTORY_FAILURE",
    "Inventory could not be resolved for this proposal",
    503,
  );
}

function parseRequest(raw: unknown): { trip: TripState; proposal: TripProposal } {
  const parsed = proposalRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProposalServiceError(
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid proposal request",
      400,
    );
  }
  return parsed.data as { trip: TripState; proposal: TripProposal };
}

async function contextFor(
  repository: ReturnType<typeof createInventoryRepository>,
) {
  const catalog = await repository.getPlannerCatalog();
  return {
    resolveOffer: (offerId: string) => resolveOffer(offerId, repository),
    locationGraph: catalog.locationGraph,
  };
}

export async function previewProposal(
  raw: unknown,
  dependencies: ProposalServiceDependencies = {},
): Promise<ProposalEvaluation> {
  const { trip, proposal } = parseRequest(raw);
  const repository = dependencies.repository ?? createInventoryRepository();
  try {
    const context = await contextFor(repository);
    const currentProjection = await projectTrip(trip, context);
    if (!currentProjection.validation.valid) {
      throw new ProposalServiceError(
        "INVALID_REQUEST",
        "The base trip must be valid before proposing a change",
        422,
      );
    }
    return await deriveProposalPreview(trip, proposal, currentProjection, context);
  } catch (error: unknown) {
    throw mapError(error);
  }
}

export async function commitProposal(
  raw: unknown,
  dependencies: ProposalServiceDependencies = {},
): Promise<{ trip: TripState; projection: ProposalEvaluation["projection"] }> {
  const { trip, proposal } = parseRequest(raw);
  const repository = dependencies.repository ?? createInventoryRepository();
  try {
    const context = await contextFor(repository);
    const currentProjection = await projectTrip(trip, context);
    if (!currentProjection.validation.valid) {
      throw new ProposalServiceError(
        "INVALID_REQUEST",
        "The base trip must be valid before applying a change",
        422,
      );
    }
    return await applyProposal(trip, proposal, currentProjection, context);
  } catch (error: unknown) {
    throw mapError(error);
  }
}
