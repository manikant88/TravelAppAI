import { describe, expect, it } from "vitest";
import {
  assessOptionEvidence,
  optionCandidateSchema,
  supplierOfferSourceSchema,
  supplierSourceToProvenance,
  type OptionVerification,
} from "@/inventory/option-evidence";

const unresolved: OptionVerification = {
  identity: "verified",
  location: "verified",
  schedule: "estimated",
  price: "unknown",
  availability: "unknown",
  requirements: "unknown",
};

describe("shared option evidence", () => {
  it("keeps sandbox supplier evidence distinct and time-bound", () => {
    const source = supplierOfferSourceSchema.parse({
      provider: "duffel",
      providerOfferId: "off_123",
      evidenceKind: "sandbox",
      checkedAt: "2026-09-06T08:00:00Z",
      expiresAt: "2026-09-06T08:30:00Z",
    });

    expect(supplierSourceToProvenance(source)).toMatchObject({
      sourceKind: "supplier",
      environment: "sandbox",
      externalId: "off_123",
    });
    expect(
      supplierOfferSourceSchema.safeParse({
        provider: "nuitee",
        providerOfferId: "rate_123",
        evidenceKind: "sandbox",
      }).success,
    ).toBe(false);
  });

  it("accepts incomplete manual candidates without promoting them prematurely", () => {
    const candidate = optionCandidateSchema.parse({
      schemaVersion: 1,
      kind: "option_candidate",
      id: "candidate:activity:1",
      category: "activity",
      label: "Paragliding near Bir",
      provenance: {
        sourceKind: "user_link",
        url: "https://operator.example/paragliding",
        capturedAt: "2026-09-06T08:00:00Z",
      },
      verification: unresolved,
    });

    expect(assessOptionEvidence(candidate.verification, "itineraryProposal")).toEqual({
      ready: true,
      unresolved: [],
    });
    expect(assessOptionEvidence(candidate.verification, "planFinalization")).toEqual({
      ready: false,
      unresolved: ["price", "requirements"],
    });
    expect(assessOptionEvidence(candidate.verification, "bookingHandoff")).toEqual({
      ready: false,
      unresolved: ["price", "availability", "requirements"],
    });
  });

  it("blocks itinerary proposals when location or schedule is unresolved", () => {
    expect(
      assessOptionEvidence(
        { ...unresolved, location: "unknown", schedule: "unknown" },
        "itineraryProposal",
      ),
    ).toEqual({ ready: false, unresolved: ["location", "schedule"] });
  });
});
