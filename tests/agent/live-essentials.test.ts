import { describe, expect, it } from 'vitest';
import { emptyLiveBrief, type LiveBrief } from '@/live/contracts';
import { draftFromLiveBrief, liveEssentialReadiness, liveEssentialSuggestions, liveEssentialsMessage, missingLiveEssential } from '@/live/essentials';

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
    expect(liveEssentialReadiness(completeBrief)).toEqual({ complete: 9, total: 9, ready: true });
    expect(missingLiveEssential(completeBrief, { today: '2026-09-08', flightConfigured: true })).toBeNull();
    expect(missingLiveEssential({ ...completeBrief, endTravelMode: 'flight' }, { today: '2026-09-08', flightConfigured: true, modelQuestion: 'Please provide a pickup point for the return flight.' })).toBeNull();
  });

  it('requires a first-mile location for flight, self-drive and cab', () => {
    const flight = { ...completeBrief, travelMode: 'flight' as const };
    expect(liveEssentialReadiness(flight)).toEqual({ complete: 9, total: 10, ready: false });
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

  it('offers answer chips for the next deterministic clarification', () => {
    const withoutTravel = { ...completeBrief, travelMode: null };
    expect(liveEssentialSuggestions(withoutTravel).map(option => option.label)).toEqual(['Flight', 'Train', 'Bus', 'Cab', 'Self Drive', 'Recommend Me']);

    const flightWithoutPickup = { ...completeBrief, travelMode: 'flight' as const, pickupLocation: null };
    expect(liveEssentialSuggestions(flightWithoutPickup).map(option => option.label)).toEqual([
      'Delhi city centre', 'Delhi airport', 'Delhi railway station', 'My current location', 'Add address in chat',
    ]);
  });

  it('requires an explicit end intent and an independent later travel mode', () => {
    const undecided = { ...completeBrief, endIntent: null, endTravelMode: null };
    expect(missingLiveEssential(undecided, { today: '2026-09-08', flightConfigured: true })).toContain('What should happen after Udaipur');
    const returning = { ...undecided, endIntent: 'return_to_origin' as const };
    expect(missingLiveEssential(returning, { today: '2026-09-08', flightConfigured: true })).toContain('It can be different');
    const onward = { ...returning, endIntent: 'continue_elsewhere' as const, onwardDestination: null };
    expect(missingLiveEssential(onward, { today: '2026-09-08', flightConfigured: true })).toContain('Where would you like to go');
  });
});
