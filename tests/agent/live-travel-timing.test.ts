import { describe, expect, it } from 'vitest';
import { travelOptionInstant } from '@/live/timeline';
import type { LiveTravelOption } from '@/live/contracts';

const cab: LiveTravelOption = {
  schemaVersion: 1,
  kind: 'route_evidence',
  id: 'outbound-cab',
  providerRouteId: null,
  direction: 'outbound',
  mode: 'drive',
  roadUse: 'cab',
  label: 'Cab route estimate',
  minutes: 1505,
  meters: 1_528_000,
  path: [],
  departureAt: '2026-10-10T02:30:00.000Z',
  transitModes: [],
  transitLines: [],
  timingKind: 'estimated',
  checkedAt: '2026-09-10T02:30:00.000Z',
  source: 'Google Routes',
};

describe('travel route timing', () => {
  it('derives an overnight cab arrival when route evidence omits arrivalAt', () => {
    expect(travelOptionInstant(cab, 'arrival')).toBe('2026-10-11T03:35:00.000Z');
  });

  it('keeps an observed arrival instead of replacing it with an estimate', () => {
    expect(travelOptionInstant({ ...cab, arrivalAt: '2026-10-11T04:00:00.000Z' }, 'arrival')).toBe('2026-10-11T04:00:00.000Z');
  });

  it('does not invent scheduled public-transport times', () => {
    expect(travelOptionInstant({ ...cab, mode: 'transit', roadUse: undefined, timingKind: 'scheduled' }, 'arrival')).toBeUndefined();
  });
});
