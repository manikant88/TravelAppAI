import type { TransferOffer } from "@/inventory/contracts";

const baseTransferOffer: TransferOffer = {
  schemaVersion: 1,
  kind: "supplier_offer",
  id: "offer:transfer:test",
  transferId: "transfer:test",
  from: "airport:origin",
  to: "neighborhood:destination",
  mode: "car",
  durationMinutes: 45,
  capacity: 3,
  price: { amount: 1_200, currency: "INR", unit: "per_vehicle" },
  availability: "available",
  source: {
    provider: "test",
    providerOfferId: "transfer:test",
    evidenceKind: "snapshot",
  },
  booking: null,
};

export function makeTransferOffer(overrides: Partial<TransferOffer> = {}): TransferOffer {
  return {
    ...baseTransferOffer,
    ...overrides,
    source: {
      ...baseTransferOffer.source,
      ...overrides.source,
    },
  };
}
