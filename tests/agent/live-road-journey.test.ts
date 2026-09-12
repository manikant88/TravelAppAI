import { describe, expect, it, vi } from 'vitest';
import type { LiveTravelOption } from '@/live/contracts';
import { assessRoadJourneyPair, attachTransitStays, buildRoadJourneyPlan } from '@/live/road-journey';

function road(minutes: number, roadUse: 'self_drive' | 'cab' = 'self_drive', direction: 'outbound' | 'return' = 'outbound'): LiveTravelOption {
  return { schemaVersion: 1, kind: 'route_evidence', id: `${direction}-${roadUse}`, providerRouteId: null, direction, mode: 'drive', roadUse, label: roadUse, minutes, meters: null, path: [], departureAt: '2027-10-10T02:30:00Z', arrivalAt: '2027-10-11T03:30:00Z', transitModes: [], transitLines: [], timingKind: 'estimated', checkedAt: '2026-09-10T00:00:00Z', source: 'Google Routes' };
}

describe('road journey planning', () => {
  it('splits a 25-hour self-drive into safe days with meals and overnight rest', () => {
    const plan = buildRoadJourneyPlan({ option: road(1500), date: '2027-10-10', tripDays: 7 });
    expect(plan?.travelDays).toBe(4);
    expect(plan?.segments.map(segment => segment.driveMinutes)).toEqual([480, 480, 480, 60]);
    expect(plan?.segments.slice(0, -1).every(segment => segment.overnightRestMinutes === 720)).toBe(true);
    expect(plan?.segments.slice(0, 3).every(segment => segment.mealBreaks.includes('lunch'))).toBe(true);
    expect(plan?.segments[0].breakStops).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rest', durationMinutes: 20 }),
      expect.objectContaining({ type: 'lunch', durationMinutes: 45 }),
    ]));
    expect(plan?.segments[0].breakStops.every((stop, index, stops) => index === 0 || stop.startMinutes >= stops[index - 1].startMinutes + stops[index - 1].durationMinutes)).toBe(true);
  });

  it('allows longer staffed-cab days but never treats 25 hours as one continuous ride', () => {
    const plan = buildRoadJourneyPlan({ option: road(1500, 'cab'), date: '2027-10-10', tripDays: 7 });
    expect(plan?.travelDays).toBe(3);
    expect(plan?.segments.every(segment => segment.driveMinutes <= 600)).toBe(true);
  });

  it('blocks a round road journey that consumes all trip dates', () => {
    const outbound = buildRoadJourneyPlan({ option: road(1500), date: '2027-10-10', tripDays: 4 });
    const returning = buildRoadJourneyPlan({ option: road(1500, 'self_drive', 'return'), date: '2027-10-10', tripDays: 4 });
    const result = assessRoadJourneyPair(outbound, returning, 4);
    expect(result.status).toBe('not_feasible');
    expect(result.destinationDaysRemaining).toBeLessThanOrEqual(0);
  });

  it('checks each overnight stop against dated stay inventory when configured', async () => {
    const option = { ...road(900), path: [{ lat: 28.6, lng: 77.2 }, { lat: 27.1, lng: 78.1 }, { lat: 26.9, lng: 75.8 }] };
    const plan = buildRoadJourneyPlan({ option, date: '2027-10-10', tripDays: 6 });
    const place = { id: 'road-hotel', name: 'Road Hotel', address: 'Agra', lat: 27.1, lng: 78.1, source: 'Google Maps' as const, checkedAt: '2026-09-10T00:00:00Z', mapsUrl: 'https://maps.google.com', attributions: [] };
    const google = { search: vi.fn(async () => [place]) };
    const stay = { search: vi.fn(async () => ({ offers: [], environment: 'sandbox' as const, checkedAt: '2026-09-10T00:00:00Z', assumptions: [] })) };
    const result = await attachTransitStays(plan, option, google as never, { provider: stay, travellers: 2, guestNationality: 'IN' });
    expect(stay.search).toHaveBeenCalledWith(expect.objectContaining({ destination: 'Agra', checkIn: '2027-10-10', checkOut: '2027-10-11', travellers: 2 }));
    expect(result?.segments[0].transitStay?.id).toBe('road-hotel');
    expect(result?.segments[0].breakStops.every(stop => stop.routePoint)).toBe(true);
    expect(result?.segments[0].breakStops.find(stop => stop.type === 'lunch')?.place?.id).toBe('road-hotel');
    expect(google.search).toHaveBeenCalledWith(expect.stringMatching(/^restaurants near /), 1);
  });
});
