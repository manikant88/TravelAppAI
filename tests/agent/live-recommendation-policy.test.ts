import { describe, expect, it } from 'vitest';
import type { TransportOffer } from '@/inventory/contracts';
import type { LivePlace, LiveTravelOption } from '@/live/contracts';
import { flightCandidate, routeCandidate, selectBudgetAwareHotel, selectJourneyRecommendation } from '@/live/recommendation-policy';

const place = (id: string, total: number, rating: number): LivePlace => ({
  id, name: id, address: id, lat: 0, lng: 0, source: 'Nuitée Connect', checkedAt: '2026-09-13T00:00:00Z', mapsUrl: 'https://example.com', rating, attributions: [],
  stayOffer: { schemaVersion: 1, kind: 'supplier_offer', id, roomOfferId: id, propertyId: id, locationId: id, checkIn: '2027-01-01', checkOut: '2027-01-03', rooms: 1, propertyFacts: { name: id, rating, reviewCount: 100, amenities: [], accessibility: [], tags: [], imageAssetKey: id }, roomFacts: { roomLabel: 'Room', maxOccupancy: 2, mealPlan: 'none', refundable: true }, price: { amount: total / 2, currency: 'INR', unit: 'per_room_per_night' }, totalPrice: { amount: total, currency: 'INR' }, availability: 'available', source: { provider: 'test', providerOfferId: id, evidenceKind: 'sandbox', checkedAt: '2026-09-13T00:00:00Z' }, booking: null },
});

describe('recommendation policy', () => {
  it('prioritizes door-to-door time when no budget is stated', () => {
    const result = selectJourneyRecommendation([
      { kind: 'route', id: 'train', minutes: 480, knownCost: 1200, currency: 'INR' },
      { kind: 'flight', id: 'flight', minutes: 250, knownCost: 9000, currency: 'INR' },
    ]);
    expect(result).toMatchObject({ id: 'flight', budgetStatus: 'not_requested' });
  });

  it('chooses the fastest option whose known cost fits the planning allocation', () => {
    const result = selectJourneyRecommendation([
      { kind: 'route', id: 'train', minutes: 480, knownCost: 1200, currency: 'INR' },
      { kind: 'flight', id: 'flight', minutes: 250, knownCost: 9000, currency: 'INR' },
    ], { amount: 3000, currency: 'INR' });
    expect(result).toMatchObject({ id: 'train', budgetStatus: 'within_known_budget' });
  });

  it('does not treat an unknown cab fare as free', () => {
    const result = selectJourneyRecommendation([
      { kind: 'route', id: 'cab', minutes: 200 },
      { kind: 'route', id: 'train', minutes: 300, knownCost: 1200, currency: 'INR' },
    ], { amount: 3000, currency: 'INR' });
    expect(result?.id).toBe('train');
  });

  it('keeps a budget-compatible quality stay within a visible accommodation allocation', () => {
    const expensive = place('expensive', 18_000, 4.9);
    const balanced = place('balanced', 10_000, 4.6);
    expect(selectBudgetAwareHotel(expensive, [expensive, balanced], { amount: 20_000, currency: 'INR', scope: 'total' }).id).toBe('balanced');
  });

  it('uses the lowest known stay price when no stay fits the accommodation allocation', () => {
    const selected = place('selected', 90_000, 4.9);
    const leastOver = place('least-over', 65_000, 4.1);
    expect(selectBudgetAwareHotel(selected, [selected, leastOver], { amount: 100_000, currency: 'INR', scope: 'total' }).id).toBe('least-over');
  });

  it('normalizes supplier and route candidates without hiding unknown costs', () => {
    const flight = { id: 'flight', durationMinutes: 90, price: { amount: 4000, currency: 'INR' } } as TransportOffer;
    const route = { id: 'route', minutes: 300 } as LiveTravelOption;
    expect(flightCandidate(flight, 2, 60)).toMatchObject({ minutes: 270, knownCost: 8000 });
    expect(routeCandidate(route, 2)).not.toHaveProperty('knownCost');
  });
});
