import { describe, expect, it } from 'vitest';
import type { TransportOffer } from '@/inventory/contracts';
import {
  searchTransportOffers,
  type TransportOfferSearch,
  type TransportProviderAdapter,
  type TransportProviderCapabilities,
} from '@/transport/provider';

const checkedAt = '2026-09-06T06:00:00Z';
const search: TransportOfferSearch = {
  from: 'city:delhi',
  to: 'city:jaipur',
  departureDate: '2026-09-08',
  travellerIds: ['traveller:1'],
  modes: ['bus'],
};
const capabilities: TransportProviderCapabilities = {
  modes: ['bus'],
  livePrices: true,
  liveAvailability: true,
  booking: 'handoff',
  cancellationTerms: false,
  capacity: false,
  refresh: 'manual',
};
const offer: TransportOffer = {
  schemaVersion: 1,
  kind: 'supplier_offer',
  id: 'offer:bus:1',
  serviceId: 'service:bus:1',
  mode: 'bus',
  from: search.from,
  to: search.to,
  departureAt: '2026-09-08T08:00:00+05:30',
  arrivalAt: '2026-09-08T13:00:00+05:30',
  durationMinutes: 300,
  stops: 0,
  operator: 'Example Bus',
  segments: [{
    mode: 'bus',
    from: search.from,
    to: search.to,
    departureAt: '2026-09-08T08:00:00+05:30',
    arrivalAt: '2026-09-08T13:00:00+05:30',
    operator: 'Example Bus',
  }],
  price: { amount: 800, currency: 'INR', unit: 'per_traveller' },
  availability: 'available',
  source: { provider: 'example', providerOfferId: 'bus-1', evidenceKind: 'live', checkedAt },
  booking: { method: 'handoff', url: 'https://example.com/bus-1' },
};

function adapter(overrides: Partial<TransportProviderAdapter> = {}): TransportProviderAdapter {
  return {
    id: 'example',
    capabilities,
    fetchOffers: async () => ({ offers: [offer], checkedAt, warnings: [] }),
    ...overrides,
  };
}

describe('transport provider boundary', () => {
  it('returns canonical offers from a declared provider', async () => {
    const result = await searchTransportOffers(adapter(), search, new AbortController().signal);
    expect(result.offers).toEqual([offer]);
  });

  it('rejects structurally valid facts that exceed provider capabilities', async () => {
    await expect(searchTransportOffers(adapter({
      capabilities: { ...capabilities, liveAvailability: false },
    }), search, new AbortController().signal)).rejects.toThrow('cannot supply live availability');
  });

  it('rejects malformed segment continuity before planning', async () => {
    const malformed = {
      ...offer,
      segments: [{ ...offer.segments[0], to: 'city:somewhere-else' }],
    };
    await expect(searchTransportOffers(adapter({
      fetchOffers: async () => ({ offers: [malformed], checkedAt, warnings: [] }),
    }), search, new AbortController().signal)).rejects.toThrow();
  });

  it('rejects an internally valid offer for a different search route', async () => {
    const wrongRoute = {
      ...offer,
      from: 'city:agra',
      segments: [{ ...offer.segments[0], from: 'city:agra' }],
    };
    await expect(searchTransportOffers(adapter({
      fetchOffers: async () => ({ offers: [wrongRoute], checkedAt, warnings: [] }),
    }), search, new AbortController().signal)).rejects.toThrow('outside the requested route or date');
  });
});
