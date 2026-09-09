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
  nightsConfirmed: true,
};

describe('live trip essentials', () => {
  it('treats dining and pace as optional planning preferences', () => {
    expect(liveEssentialReadiness(completeBrief)).toEqual({ complete: 7, total: 7, ready: true });
    expect(missingLiveEssential(completeBrief, { today: '2026-09-08', flightConfigured: true })).toBeNull();
  });

  it('requires a first-mile location for flight, self-drive and cab', () => {
    const flight = { ...completeBrief, travelMode: 'flight' as const };
    expect(liveEssentialReadiness(flight)).toEqual({ complete: 7, total: 8, ready: false });
    expect(missingLiveEssential(flight, { today: '2026-09-08', flightConfigured: true })).toContain('starting area');
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
    expect(liveEssentialSuggestions(flightWithoutPickup)).toEqual([
      { label: 'Delhi city centre', message: 'Use Delhi city centre as my starting point.' },
      { label: 'I’ll enter a pickup point', message: 'I want to provide a specific pickup area or public meeting point.' },
    ]);
  });
});
