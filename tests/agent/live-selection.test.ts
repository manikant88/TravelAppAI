import { describe, expect, it, vi } from 'vitest';
import { applyLiveSelection, LiveSelectionError } from '@/live/selection.server';
import { emptyLiveBrief, liveSelectionRequestSchema, type LivePlan, type LivePlace, type LiveTravelOption } from '@/live/contracts';
import type { LiveProvider } from '@/live/google.server';
import type { TransportOffer } from '@/inventory/contracts';
import type { FlightProvider } from '@/transport/providers/nuitee-flight.server';

const place = (id: string): LivePlace => ({ id, name: id, address: `${id} address`, lat: 26, lng: 75, source: 'Google Maps', checkedAt: '2026-09-07T00:00:00Z', mapsUrl: 'https://maps.google.com/', attributions: [], utcOffsetMinutes: 330 });
const routeOption = (direction: 'outbound' | 'return', from: LivePlace, to: LivePlace): LiveTravelOption => ({ schemaVersion: 1, kind: 'route_evidence', id: `${direction}:${from.id}:${to.id}`, providerRouteId: null, direction, mode: 'drive', label: 'Drive', minutes: 20, meters: 10000, path: [], departureAt: '2027-09-08T08:00:00+05:30', arrivalAt: '2027-09-08T08:20:00+05:30', transitModes: [], transitLines: [], timingKind: 'estimated', checkedAt: '2026-09-07T00:00:00Z', source: 'Google Routes' });
function flight(id: string, direction: 'outbound' | 'return', hour: number): TransportOffer {
  const from = direction === 'outbound' ? 'DEL' : 'JAI'; const to = direction === 'outbound' ? 'JAI' : 'DEL';
  const date = direction === 'outbound' ? '2027-09-08' : '2027-09-11';
  const departureAt = `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`; const arrivalAt = `${date}T${String(hour + 1).padStart(2, '0')}:00:00+05:30`;
  return { schemaVersion: 1, kind: 'supplier_offer', id, serviceId: `service:${id}`, mode: 'flight', from, to, departureAt, arrivalAt, durationMinutes: 60, stops: 0, operator: 'Test Air', segments: [{ mode: 'flight', from, to, departureAt, arrivalAt, operator: 'Test Air', number: id }], price: { amount: 2500, currency: 'INR', unit: 'per_traveller' }, availability: 'available', source: { provider: 'Nuitée Connect Flights', providerOfferId: id, evidenceKind: 'sandbox', checkedAt: '2026-09-07T00:00:00Z', expiresAt: '2027-09-07T00:00:00Z' }, booking: null };
}
function setup() {
  const hotel = place('hotel-a'); const alternative = place('hotel-b'); const origin = place('origin'); const activity = place('activity'); const activityAlternative = place('activity-b');
  const outbound = flight('flight-outbound-a', 'outbound', 8); const outboundAlternative = flight('flight-outbound-b', 'outbound', 10); const returning = flight('flight-return-a', 'return', 18);
  const originAirport = { ...place('del-airport'), airportCode: 'DEL' }; const destinationAirport = { ...place('jai-airport'), airportCode: 'JAI' };
  const plan: LivePlan = { brief: { ...emptyLiveBrief, origin: 'Delhi', destination: 'Jaipur', startDate: '2027-09-08', days: 4, travellers: 2, travelMode: 'flight', pickupLocation: 'India Gate', nightsConfirmed: true }, hotels: [hotel, alternative], selectedHotelId: hotel.id, activityOptions: [activity, activityAlternative], days: [{ date: '2027-09-08', visits: [{ place: activity, durationMinutes: 60 }], legs: [] }, { date: '2027-09-09', visits: [], legs: [] }, { date: '2027-09-10', visits: [], legs: [] }, { date: '2027-09-11', visits: [], legs: [] }], flight: { origin, destination: hotel, originAirport, destinationAirport, outbound: [outbound, outboundAlternative], return: [returning], suggestedOutboundId: outbound.id, suggestedReturnId: returning.id, assumptions: [] }, warnings: [], checkedAt: '2026-09-07T00:00:00Z', status: 'provisional', totalCost: null, locks: { hotel: false, outboundFlight: false, returnFlight: false, outboundTravel: false, returnTravel: false, activityIds: [] } };
  const provider: LiveProvider = { search: vi.fn(), details: vi.fn(async id => place(id)), route: vi.fn(async (from, to) => ({ fromId: from.id, toId: to.id, minutes: 12, meters: 5000, path: [], checkedAt: '2026-09-07T00:00:00Z' })), travelRoutes: vi.fn(async (from, to, input) => [routeOption(input.direction, from, to)]) };
  return { plan, provider, signal: new AbortController().signal };
}

describe('live session selections', () => {
  it('accepts the serialized plan at the route boundary', () => {
    const d = setup();
    expect(liveSelectionRequestSchema.safeParse({ phase: 'live-selection', plan: d.plan, command: { type: 'set_lock', target: 'hotel', locked: true } }).success).toBe(true);
  });

  it('refreshes hotel-dependent airport and daily routes', async () => {
    const d = setup();
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_hotel', hotelId: 'hotel-b' } }, d);
    expect(result.plan.selectedHotelId).toBe('hotel-b');
    expect(result.plan.flight?.destination.id).toBe('hotel-b');
    expect(result.plan.flight?.outboundLastMile?.id).toBe('outbound:jai-airport:hotel-b');
    expect(result.plan.flight?.returnFirstMile?.id).toBe('return:hotel-b:jai-airport');
    expect(result.plan.days[0].legs.map(leg => [leg.fromId, leg.toId])).toEqual([['hotel-b', 'activity'], ['activity', 'hotel-b']]);
  });

  it('changes a flight only after validating it and refreshes its two transfers', async () => {
    const d = setup();
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_flight', direction: 'outbound', offerId: 'flight-outbound-b' } }, d);
    expect(result.plan.flight?.suggestedOutboundId).toBe('flight-outbound-b');
    expect(result.plan.flight?.suggestedReturnId).toBe('flight-return-a');
    expect(d.provider.travelRoutes).toHaveBeenCalledTimes(2);
  });

  it('selects an observed Google route and changes the itinerary route pointer', async () => {
    const d = setup();
    const faster = routeOption('outbound', d.plan.hotels[0], d.plan.hotels[1]);
    const alternative = { ...faster, id: 'outbound-drive-alternative', minutes: 35 };
    d.plan.travel = { origin: place('origin'), destination: d.plan.hotels[0], outbound: [faster, alternative], return: [], suggestedOutboundId: faster.id, suggestedReturnId: null, selectionReason: 'Shortest route', assumptions: [] };
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_travel', direction: 'outbound', optionId: alternative.id } }, d);
    expect(result.plan.travel?.suggestedOutboundId).toBe(alternative.id);
    expect(d.provider.travelRoutes).not.toHaveBeenCalled();
  });

  it('uses a flight fallback instead of a flight for the same direction', async () => {
    const d = setup();
    const cab = { ...routeOption('outbound', d.plan.hotels[0], d.plan.hotels[1]), id: 'outbound-cab', label: 'Cab route estimate', roadUse: 'cab' as const };
    d.plan.travel = { origin: place('origin'), destination: d.plan.hotels[0], outbound: [cab], return: [], suggestedOutboundId: null, suggestedReturnId: null, selectionReason: 'Flight fallback', assumptions: [], context: 'flight_fallback' };
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_travel', direction: 'outbound', optionId: cab.id } }, d);
    expect(result.plan.travel?.suggestedOutboundId).toBe(cab.id);
    expect(result.plan.flight?.suggestedOutboundId).toBeNull();
  });

  it('preserves a selected cab fallback and refreshes all fallback modes after a stay change', async () => {
    const d = setup();
    const drive = routeOption('outbound', place('origin'), d.plan.hotels[0]);
    const cab = { ...drive, id: `${drive.id}:cab`, label: 'Cab route estimate', roadUse: 'cab' as const };
    d.plan.flight = undefined;
    d.plan.travel = { origin: place('origin'), destination: d.plan.hotels[0], outbound: [cab], return: [], suggestedOutboundId: cab.id, suggestedReturnId: null, selectionReason: 'Flight fallback', assumptions: [], context: 'flight_fallback' };
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_hotel', hotelId: 'hotel-b' } }, d);
    const selected = result.plan.travel?.outbound.find(option => option.id === result.plan.travel?.suggestedOutboundId);
    expect(selected?.roadUse).toBe('cab');
    expect(result.plan.travel?.destination.id).toBe('hotel-b');
    expect(d.provider.travelRoutes).toHaveBeenCalledTimes(4);
  });

  it('retries flights from a Google fallback without rebuilding the stay or activities', async () => {
    const d = setup();
    const originalDays = structuredClone(d.plan.days);
    const originalFlight = d.plan.flight!;
    d.plan.flight = undefined;
    d.plan.travel = { origin: place('origin'), destination: d.plan.hotels[0], outbound: [], return: [], suggestedOutboundId: null, suggestedReturnId: null, selectionReason: 'Flight fallback', assumptions: [], context: 'flight_fallback' };
    const flightProvider: FlightProvider = { search: vi.fn(async () => ({
      originHub: { code: 'DEL', name: 'Delhi Airport', latitude: 28.56, longitude: 77.1, countryCode: 'IN' },
      destinationHub: { code: 'JAI', name: 'Jaipur Airport', latitude: 26.82, longitude: 75.8, countryCode: 'IN' },
      outbound: originalFlight.outbound,
      returning: originalFlight.return,
      checkedAt: '2026-09-07T00:00:00Z',
      environment: 'sandbox' as const,
      warnings: [],
    })) };
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'retry_flights' } }, { ...d, flightProvider });
    expect(result.plan.flight?.suggestedOutboundId).toBe('flight-outbound-a');
    expect(result.plan.flight?.suggestedReturnId).toBe('flight-return-a');
    expect(result.plan.travel?.suggestedOutboundId).toBeNull();
    expect(result.plan.travel?.suggestedReturnId).toBeNull();
    expect(result.plan.days).toEqual(originalDays);
    expect(flightProvider.search).toHaveBeenCalledOnce();
    expect(d.provider.travelRoutes).toHaveBeenCalledTimes(4);
  });

  it('replaces an activity only from observed candidates and refreshes that day routes', async () => {
    const d = setup();
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_activity', dayIndex: 0, visitIndex: 0, placeId: 'activity-b' } }, d);
    expect(result.plan.days[0].visits[0].place.id).toBe('activity-b');
    expect(result.plan.days[0].legs.map(leg => [leg.fromId, leg.toId])).toEqual([['hotel-a', 'activity-b'], ['activity-b', 'hotel-a']]);
    expect(d.provider.details).toHaveBeenCalledWith('activity-b');
  });

  it('invalidates stale meal corridor evidence when an adjacent activity changes', async () => {
    const d = setup();
    const second = place('activity-second');
    const replacement = place('activity-c');
    const restaurant = place('restaurant');
    d.plan.activityOptions = [...d.plan.activityOptions!, second, replacement];
    d.plan.days[0].visits = [{ place: place('activity'), durationMinutes: 60 }, { place: second, durationMinutes: 60 }];
    d.plan.days[0].meals = [{ type: 'lunch', place: restaurant, durationMinutes: 60, targetStartMinutes: 780, location: 'restaurant', dietaryNote: 'Both', routeFit: { basis: 'route_corridor', fromId: 'activity', toId: 'activity-second', directMinutes: 10, addedMinutes: 4 } }];
    const result = await applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_activity', dayIndex: 0, visitIndex: 0, placeId: 'activity-c' } }, d);
    expect(result.plan.days[0].meals?.[0].routeFit).toEqual({ basis: 'destination_fallback', fromId: 'activity-c', toId: 'activity-second', directMinutes: null });
  });

  it('rejects an activity replacement while the current activity is locked', async () => {
    const d = setup();
    d.plan.locks!.activityIds = ['activity'];
    await expect(applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_activity', dayIndex: 0, visitIndex: 0, placeId: 'activity-b' } }, d)).rejects.toThrow('Unlock the activity');
    expect(d.provider.details).not.toHaveBeenCalled();
  });

  it('rejects an activity that is regularly closed on the itinerary day', async () => {
    const d = setup();
    d.provider.details = vi.fn(async id => ({ ...place(id), regularHours: [] }));
    await expect(applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_activity', dayIndex: 0, visitIndex: 0, placeId: 'activity-b' } }, d)).rejects.toThrow('usually closed');
    expect(d.provider.route).not.toHaveBeenCalled();
  });

  it('blocks replacement while the corresponding selection is locked', async () => {
    const d = setup(); d.plan.locks!.hotel = true;
    await expect(applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_hotel', hotelId: 'hotel-b' } }, d)).rejects.toEqual(expect.objectContaining<Partial<LiveSelectionError>>({ status: 409 }));
    expect(d.provider.route).not.toHaveBeenCalled();
  });

  it('rejects an expired supplier offer without route calls', async () => {
    const d = setup(); d.plan.flight!.outbound[1].source.expiresAt = '2026-09-06T00:00:00Z';
    await expect(applyLiveSelection({ phase: 'live-selection', plan: d.plan, command: { type: 'select_flight', direction: 'outbound', offerId: 'flight-outbound-b' } }, { ...d, now: '2026-09-07T00:00:00Z' })).rejects.toThrow('expired');
    expect(d.provider.travelRoutes).not.toHaveBeenCalled();
  });
});
