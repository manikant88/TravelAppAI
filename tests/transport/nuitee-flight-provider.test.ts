import { describe, expect, it } from 'vitest';
import { normalizeNuiteeFlightResponse } from '@/transport/providers/nuitee-flight.server';

const checkedAt = '2026-09-07T08:00:00Z';
const raw = { data: [{ journeys: [{
  journeyKey: 'journey-1', totalDuration: { minutes: 55 },
  segments: [{ arrivalTime: '2026-10-08T16:45:00', departureTime: '2026-10-08T15:50:00', originCode: 'DEL', destinationCode: 'JAI', direction: 'OUTBOUND', duration: { minutes: 55 }, carrier: { marketingName: 'IndiGo', marketingCode: '6E' }, flight: { marketingNumber: '5033' } }],
  cheapestOffer: { offerId: 'offer-1', expiration: '2026-09-07T08:10:00Z', pricing: { display: { total: 4611.72, currency: 'INR', perPassenger: { adult: { total: 2305.86 } } } }, fare: { seatsRemaining: 2 }, terms: { refundable: false, changeable: false } },
}] }] };

describe('Nuitée flight adapter', () => {
  it('maps a direct sandbox result to a canonical per-traveller offer', () => {
    const result = normalizeNuiteeFlightResponse(raw, { from: 'DEL', to: 'JAI', departureDate: '2026-10-08', travellers: 2, fromUtcOffsetMinutes: 330, toUtcOffsetMinutes: 330 }, checkedAt, 'sandbox');
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({ mode: 'flight', from: 'DEL', to: 'JAI', departureAt: '2026-10-08T15:50:00+05:30', arrivalAt: '2026-10-08T16:45:00+05:30', durationMinutes: 55, operator: 'IndiGo', price: { amount: 2305.86, currency: 'INR', unit: 'per_traveller' }, availability: 'available', capacity: { remaining: 2 }, source: { provider: 'Nuitée Connect Flights', providerOfferId: 'offer-1', evidenceKind: 'sandbox' } });
  });

  it('does not invent intermediate-airport time zones for connecting flights', () => {
    const connection = { ...raw, data: [{ journeys: [{ ...raw.data[0].journeys[0], segments: [raw.data[0].journeys[0].segments[0], { ...raw.data[0].journeys[0].segments[0], originCode: 'JAI', destinationCode: 'BOM' }] }] }] };
    const result = normalizeNuiteeFlightResponse(connection, { from: 'DEL', to: 'BOM', departureDate: '2026-10-08', travellers: 2, fromUtcOffsetMinutes: 330, toUtcOffsetMinutes: 330 }, checkedAt, 'sandbox');
    expect(result.offers).toHaveLength(0);
    expect(result.warnings[0]).toContain('connecting flight result');
  });
});
