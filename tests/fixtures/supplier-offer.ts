export function snapshotSupplierOffer(providerOfferId: string) {
  return {
    schemaVersion: 1,
    kind: "supplier_offer",
    availability: "available",
    source: {
      provider: "test-snapshot",
      providerOfferId,
      evidenceKind: "snapshot",
    },
    booking: null,
  } as const;
}
