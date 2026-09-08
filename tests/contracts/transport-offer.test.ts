import { describe, expect, it } from 'vitest';
import { transferOfferSchema, transportOfferSchema } from '@/inventory/contracts';

describe('canonical water transport contracts', () => {
  it('preserves different modes across a ferry-to-cruise supplier offer', () => {
    const offer = {
      schemaVersion: 1,
      kind: 'supplier_offer',
      id: 'offer:water:1',
      serviceId: 'service:water:1',
      mode: 'cruise',
      from: 'jetty:panjim',
      to: 'port:casino',
      departureAt: '2026-09-08T18:00:00+05:30',
      arrivalAt: '2026-09-08T19:00:00+05:30',
      durationMinutes: 60,
      stops: 1,
      operator: 'Example Water Operator',
      segments: [
        { mode: 'ferry', from: 'jetty:panjim', to: 'jetty:boarding', departureAt: '2026-09-08T18:00:00+05:30', arrivalAt: '2026-09-08T18:15:00+05:30', operator: 'Example Ferry' },
        { mode: 'cruise', from: 'jetty:boarding', to: 'port:casino', departureAt: '2026-09-08T18:20:00+05:30', arrivalAt: '2026-09-08T19:00:00+05:30', operator: 'Example Water Operator' },
      ],
      price: { amount: 2_500, currency: 'INR', unit: 'per_traveller' },
      availability: 'available',
      source: { provider: 'example-water', providerOfferId: 'water-1', evidenceKind: 'live', checkedAt: '2026-09-05T05:00:00Z', expiresAt: '2026-09-05T05:15:00Z' },
      booking: { method: 'handoff', url: 'https://example.com/book/water-1' },
    };

    expect(transportOfferSchema.parse(offer).segments.map(segment => segment.mode)).toEqual(['ferry', 'cruise']);
  });

  it('can identify a ferry as the physical mode of a transfer', () => {
    const transfer = {
      schemaVersion: 1,
      kind: 'supplier_offer',
      id: 'offer:transfer:ferry',
      transferId: 'transfer:ferry',
      from: 'jetty:hotel',
      to: 'jetty:casino',
      mode: 'shared',
      transportMode: 'ferry',
      durationMinutes: 20,
      capacity: 20,
      price: { amount: 500, currency: 'INR', unit: 'per_traveller' },
      availability: 'available',
      source: { provider: 'example-water', providerOfferId: 'ferry-1', evidenceKind: 'live', checkedAt: '2026-09-05T05:00:00Z' },
      booking: null,
    };

    expect(transferOfferSchema.parse(transfer).transportMode).toBe('ferry');
  });
});
