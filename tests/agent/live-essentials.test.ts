import { describe, expect, it } from 'vitest';
import { emptyLiveBrief, type LiveBrief } from '@/live/contracts';
import { applyLivePlanningDefaults, draftFromLiveBrief, liveEssentialReadiness, liveEssentialSuggestions, liveEssentialsMessage, missingLiveEssential } from '@/live/essentials';
import { deterministicBriefFallback } from '@/live/intake-fallback';

const completeBrief: LiveBrief = {
  ...emptyLiveBrief,
  origin: 'Delhi',
  destination: 'Udaipur',
  startDate: '2027-10-10',
  days: 5,
  travellers: 3,
  travelMode: 'public_transit',
  endIntent: 'return_to_origin',
  endTravelMode: 'public_transit',
  nightsConfirmed: true,
};

describe('live trip essentials', () => {
  it('treats dining and pace as optional planning preferences', () => {
    expect(liveEssentialReadiness(completeBrief)).toEqual({ complete: 6, total: 6, ready: true });
    expect(missingLiveEssential(completeBrief, { today: '2026-09-08', flightConfigured: true })).toBeNull();
    expect(missingLiveEssential({ ...completeBrief, endTravelMode: 'flight' }, { today: '2026-09-08', flightConfigured: true, modelQuestion: 'Please provide a pickup point for the return flight.' })).toBeNull();
  });

  it('requires a first-mile location for flight, self-drive and cab', () => {
    const flight = { ...completeBrief, travelMode: 'flight' as const };
    expect(liveEssentialReadiness(flight)).toEqual({ complete: 6, total: 7, ready: false });
    expect(missingLiveEssential(flight, { today: '2026-09-08', flightConfigured: true })).toContain('airport transfer start');
    expect(liveEssentialReadiness({ ...completeBrief, travelMode: 'cab', pickupLocation: null }).ready).toBe(false);
  });

  it('serializes the complete form as one explicit conversational request', () => {
    const draft = { ...draftFromLiveBrief(completeBrief), dietaryPreference: 'pure_vegetarian' as const, pace: 'relaxed' as const };
    const message = liveEssentialsMessage(draft);
    expect(message).toContain('5-day trip from Delhi to Udaipur');
    expect(message).toContain('4 hotel nights and checkout on 2027-10-14');
    expect(message).toContain('public transport');
    expect(message).toContain('pure vegetarian');
    expect(message).toContain('relaxed trip pace');
  });

  it('does not block planning on an unstated travel preference', () => {
    const withoutTravel = { ...completeBrief, travelMode: null };
    expect(liveEssentialSuggestions(withoutTravel)).toEqual([]);
    expect(missingLiveEssential(withoutTravel, { today: '2026-09-08', flightConfigured: true })).toBeNull();

    const flightWithoutPickup = { ...completeBrief, travelMode: 'flight' as const, pickupLocation: null };
    expect(liveEssentialSuggestions(flightWithoutPickup).map(option => option.label)).toEqual([
      'Delhi city centre', 'Delhi airport', 'Delhi railway station', 'My current location', 'Add address in chat',
    ]);
  });

  it('defaults an unstated trip ending to a recommended return to origin', () => {
    const undecided = { ...completeBrief, endIntent: null, endTravelMode: null };
    expect(liveEssentialReadiness(undecided).ready).toBe(true);
    expect(missingLiveEssential(undecided, { today: '2026-09-08', flightConfigured: true })).toBeNull();
    const defaulted = applyLivePlanningDefaults(undecided);
    expect(defaulted).toMatchObject({ endIntent: 'return_to_origin', endTravelMode: 'recommend' });
    expect(missingLiveEssential(defaulted, { today: '2026-09-08', flightConfigured: true })).toBeNull();
    expect(liveEssentialSuggestions(undecided)).toEqual([]);

    const oneWay = applyLivePlanningDefaults({ ...undecided, endIntent: 'end_at_destination', endTravelMode: 'flight' });
    expect(oneWay).toMatchObject({ endIntent: 'end_at_destination', endTravelMode: null });
    const onward = applyLivePlanningDefaults({ ...undecided, endIntent: 'continue_elsewhere', onwardDestination: null });
    expect(missingLiveEssential(onward, { today: '2026-09-08', flightConfigured: true })).toContain('Where would you like to go');
  });

  it('preserves an explicit total budget when model extraction is unavailable', () => {
    const parsed = deterministicBriefFallback({ phase: 'live', brief: completeBrief, history: [], message: 'Keep the total trip budget under ₹75,000.' });
    expect(parsed?.budget).toEqual({ amount: 75000, currency: 'INR', scope: 'total' });
    const removed = deterministicBriefFallback({ phase: 'live', brief: parsed!, history: [], message: 'Remove my trip budget limit.' });
    expect(removed?.budget).toBeNull();
  });
});
