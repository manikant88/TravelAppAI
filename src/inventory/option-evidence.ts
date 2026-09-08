import { z } from "zod";
import type { ISODateTime } from "@/domain/model";

export const optionCategories = ["travel", "stay", "activity", "transfer"] as const;
export type OptionCategory = (typeof optionCategories)[number];

export const evidenceStatuses = [
  "verified",
  "user_confirmed",
  "estimated",
  "unknown",
  "not_applicable",
] as const;
export type EvidenceStatus = (typeof evidenceStatuses)[number];

export const verificationDimensions = [
  "identity",
  "location",
  "schedule",
  "price",
  "availability",
  "requirements",
] as const;
export type VerificationDimension = (typeof verificationDimensions)[number];

export type OptionVerification = Record<VerificationDimension, EvidenceStatus>;

export interface SupplierOfferSource {
  provider: string;
  providerOfferId: string;
  evidenceKind: "live" | "sandbox" | "snapshot";
  checkedAt?: ISODateTime;
  expiresAt?: ISODateTime;
}

export const supplierOfferSourceSchema = z
  .object({
    provider: z.string().trim().min(1),
    providerOfferId: z.string().trim().min(1),
    evidenceKind: z.enum(["live", "sandbox", "snapshot"]),
    checkedAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.evidenceKind !== "snapshot" && !source.checkedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Live and sandbox supplier evidence requires checkedAt",
        path: ["checkedAt"],
      });
    }
    if (
      source.checkedAt &&
      source.expiresAt &&
      Date.parse(source.expiresAt) < Date.parse(source.checkedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Offer expiry cannot precede its checked time",
        path: ["expiresAt"],
      });
    }
  });

export const optionProvenanceSchema = z.discriminatedUnion("sourceKind", [
  z
    .object({
      sourceKind: z.literal("supplier"),
      provider: z.string().trim().min(1),
      externalId: z.string().trim().min(1),
      environment: z.enum(["live", "sandbox", "snapshot"]),
      observedAt: z.string().datetime({ offset: true }).optional(),
      expiresAt: z.string().datetime({ offset: true }).optional(),
      url: z.string().url().optional(),
    })
    .strict(),
  z
    .object({
      sourceKind: z.literal("route_evidence"),
      provider: z.string().trim().min(1),
      externalId: z.string().trim().min(1).optional(),
      observedAt: z.string().datetime({ offset: true }),
      url: z.string().url().optional(),
    })
    .strict(),
  z
    .object({
      sourceKind: z.literal("place_evidence"),
      provider: z.string().trim().min(1),
      externalId: z.string().trim().min(1),
      observedAt: z.string().datetime({ offset: true }),
      url: z.string().url().optional(),
    })
    .strict(),
  z
    .object({
      sourceKind: z.literal("user_link"),
      url: z.string().url(),
      capturedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      sourceKind: z.literal("manual"),
      enteredAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]).superRefine((source, context) => {
  if (
    source.sourceKind === "supplier" &&
    source.environment !== "snapshot" &&
    !source.observedAt
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Live and sandbox supplier provenance requires observedAt",
      path: ["observedAt"],
    });
  }
  if (
    source.sourceKind === "supplier" &&
    source.observedAt &&
    source.expiresAt &&
    Date.parse(source.expiresAt) < Date.parse(source.observedAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Supplier provenance expiry cannot precede its observation",
      path: ["expiresAt"],
    });
  }
});
export type OptionProvenance = z.infer<typeof optionProvenanceSchema>;

export const optionVerificationSchema = z
  .object({
    identity: z.enum(evidenceStatuses),
    location: z.enum(evidenceStatuses),
    schedule: z.enum(evidenceStatuses),
    price: z.enum(evidenceStatuses),
    availability: z.enum(evidenceStatuses),
    requirements: z.enum(evidenceStatuses),
  })
  .strict();

export const optionCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("option_candidate"),
    id: z.string().trim().min(1),
    category: z.enum(optionCategories),
    label: z.string().trim().min(1),
    provenance: optionProvenanceSchema,
    verification: optionVerificationSchema,
  })
  .strict();
export type OptionCandidate = z.infer<typeof optionCandidateSchema>;

export const evidenceRequirements = {
  itineraryProposal: ["identity", "location", "schedule"],
  planFinalization: ["identity", "location", "schedule", "price", "requirements"],
  bookingHandoff: [
    "identity",
    "location",
    "schedule",
    "price",
    "availability",
    "requirements",
  ],
} as const satisfies Record<string, readonly VerificationDimension[]>;

export type EvidenceRequirement = keyof typeof evidenceRequirements;

const acceptableStatuses: Record<VerificationDimension, ReadonlySet<EvidenceStatus>> = {
  identity: new Set(["verified", "user_confirmed"]),
  location: new Set(["verified", "user_confirmed"]),
  schedule: new Set(["verified", "user_confirmed", "estimated"]),
  price: new Set(["verified", "user_confirmed", "estimated", "not_applicable"]),
  availability: new Set(["verified", "user_confirmed", "not_applicable"]),
  requirements: new Set(["verified", "user_confirmed", "not_applicable"]),
};

export interface EvidenceAssessment {
  ready: boolean;
  unresolved: VerificationDimension[];
}

export function assessOptionEvidence(
  verification: OptionVerification,
  requirement: EvidenceRequirement,
): EvidenceAssessment {
  const unresolved = evidenceRequirements[requirement].filter(
    (dimension) => !acceptableStatuses[dimension].has(verification[dimension]),
  );
  return { ready: unresolved.length === 0, unresolved: [...unresolved] };
}

export function supplierSourceToProvenance(source: SupplierOfferSource): OptionProvenance {
  return optionProvenanceSchema.parse({
    sourceKind: "supplier",
    provider: source.provider,
    externalId: source.providerOfferId,
    environment: source.evidenceKind,
    observedAt: source.checkedAt,
    expiresAt: source.expiresAt,
  });
}
