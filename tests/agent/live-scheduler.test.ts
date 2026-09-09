import { describe, expect, it } from 'vitest';
import { allocateActivities, activityDuration, activityDurationProfile, mealWindow, prepareDaySchedule, reflowAndAssessDay, targetActivityCount } from '@/live/scheduler';
import { emptyLiveBrief, type LiveBrief, type LiveDay, type LivePlace } from '@/live/contracts';

const place = (id: string, summary = ''): LivePlace => ({ id, name: id, address: 'Jaipur', lat: 26.9, lng: 75.8, source: 'Google Maps', checkedAt: '2026-09-08T00:00:00Z', mapsUrl: 'https://maps.google.com', editorialSummary: summary, attributions: [] });
const brief = (pace: LiveBrief['pace'] = null): LiveBrief => ({ ...emptyLiveBrief, origin: 'Delhi', destination: 'Jaipur', startDate: '2027-09-08', days: 4, travellers: 2, travelMode: 'self_drive', pickupLocation: 'Delhi', dietaryPreference: 'both', nightsConfirmed: true, pace });
const leg = (fromId: string, toId: string, minutes: number) => ({ fromId, toId, minutes, meters: 1000, path: [], checkedAt: '2026-09-08T00:00:00Z' });

describe('capacity-aware live scheduler', () => {
  it('defaults to balanced capacity and respects unresolved, late-arrival and early-departure bounds', () => {
    expect(targetActivityCount(brief(), 0, { startMinutes: null, endMinutes: 1320 })).toBe(1);
    expect(targetActivityCount(brief(), 0, { startMinutes: 1020, endMinutes: 1320 })).toBe(1);
    expect(targetActivityCount(brief(), 1, { startMinutes: 480, endMinutes: 1320 })).toBe(3);
    expect(targetActivityCount(brief('relaxed'), 1, { startMinutes: 480, endMinutes: 1320 })).toBe(2);
    expect(targetActivityCount(brief('packed'), 1, { startMinutes: 480, endMinutes: 1320 })).toBe(4);
    expect(targetActivityCount(brief(), 3, { startMinutes: 480, endMinutes: 660 })).toBe(0);
  });

  it('fills observed candidates up to each day capacity without inventing places', () => {
    const candidates = Array.from({ length: 9 }, (_, index) => place(`place-${index}`));
    const allocated = allocateActivities({ brief: brief(), candidates, hints: [{ placeId: 'place-0', dayIndex: 1, durationMinutes: 90 }], bounds: [{ startMinutes: null, endMinutes: 1320 }, { startMinutes: 480, endMinutes: 1320 }, { startMinutes: 480, endMinutes: 1320 }, { startMinutes: 480, endMinutes: null }] });
    expect(allocated.map(day => day.length)).toEqual([1, 3, 3, 1]);
    expect(new Set(allocated.flat().map(visit => visit.place.id)).size).toBe(8);
    expect(allocated[1].map(visit => visit.sequenceOrder)).toEqual([10, 20, 50]);
  });

  it('scales pace-sensitive activities for larger groups but leaves provider slots fixed', () => {
    const trek = activityDurationProfile(place('hard fort trek'), 120);
    const concert = activityDurationProfile(place('evening concert'), 90, { kind: 'provider_slot', durationMinutes: 90, startMinutes: 1170, source: 'provider', label: 'Ticketed show time' });
    expect(activityDuration(trek, 8)).toBe(210);
    expect(activityDuration(concert, 8)).toBe(90);
    expect(trek).toMatchObject({ difficulty: 'hard', daylightWindow: { startMinutes: 360, endMinutes: 1110 } });
    expect(concert).toMatchObject({ kind: 'provider_slot', minimumMinutes: 90, maximumMinutes: 90, evidence: 'provider' });
  });

  it('keeps a fixed provider start and blocks a connection that reaches it late', () => {
    const hotel = place('hotel');
    const show = place('ticketed show');
    const timingEvidence = { kind: 'fixed' as const, durationMinutes: 90, startMinutes: 600, source: 'provider' as const, label: 'Provider show time' };
    const profile = activityDurationProfile(show, 90, timingEvidence);
    const day: LiveDay = { date: '2027-09-09', visits: [{ place: show, durationMinutes: 90, durationProfile: profile, timingKind: 'fixed', fixedStartMinutes: 600, timingEvidence }], legs: [leg(hotel.id, show.id, 120), leg(show.id, hotel.id, 15)] };
    const findings = reflowAndAssessDay(day, 1, 510, 1320, brief());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.stringContaining('fixed'), severity: 'blocking', overridable: false })]));
  });

  it('uses accepted meal windows and an explicit medical meal time', () => {
    expect(mealWindow('lunch')).toEqual({ preferredStartMinutes: 750, preferredEndMinutes: 870, earliestStartMinutes: 690, latestStartMinutes: 930 });
    expect(mealWindow('dinner')).toEqual({ preferredStartMinutes: 1140, preferredEndMinutes: 1320, earliestStartMinutes: 1080, latestStartMinutes: 1380 });
    const constrained = { ...brief(), constraints: ['Medical requirement: lunch at 12:00 pm'] };
    expect(mealWindow('lunch', constrained)).toEqual({ preferredStartMinutes: 720, preferredEndMinutes: 720, earliestStartMinutes: 660, latestStartMinutes: 780 });
  });

  it('keeps an unspecified medical meal constraint unresolved', () => {
    const day: LiveDay = { date: '2027-09-09', visits: [{ place: place('museum'), durationMinutes: 90, durationProfile: activityDurationProfile(place('museum'), 90) }], legs: [leg('hotel', 'museum', 15), leg('museum', 'hotel', 15)] };
    const findings = reflowAndAssessDay(day, 1, 480, 1320, { ...brief(), dietaryNotes: 'Needs meals around insulin medication' });
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.stringContaining('medical-meal'), severity: 'unresolved' })]));
  });

  it('shifts meals inside their windows and reports a real day overrun', () => {
    const hotel = place('hotel');
    const activity = place('fort');
    const restaurant = place('restaurant');
    const day: LiveDay = {
      date: '2027-09-09',
      visits: [{ place: activity, durationMinutes: 180, sequenceOrder: 10, durationProfile: activityDurationProfile(activity, 180) }],
      meals: [{ type: 'lunch', place: restaurant, durationMinutes: 60, targetStartMinutes: 780, window: mealWindow('lunch'), sequenceOrder: 30, location: 'restaurant', dietaryNote: 'both' }],
      legs: [leg(hotel.id, activity.id, 180), leg(activity.id, restaurant.id, 30), leg(restaurant.id, hotel.id, 60)],
    };
    prepareDaySchedule(day, 2, { startMinutes: 600, endMinutes: 900 });
    const findings = reflowAndAssessDay(day, 1, 600, 900);
    expect(day.meals?.[0].targetStartMinutes).toBeGreaterThan(780);
    expect(findings.some(finding => finding.severity === 'blocking' && finding.id.includes('overrun'))).toBe(true);
  });

  it('suppresses only the meal explicitly covered by a combined experience', () => {
    const dinnerCruise = place('dinner cruise', 'Includes dinner on board');
    const day: LiveDay = {
      date: '2027-09-09',
      visits: allocateActivities({ brief: brief(), candidates: [dinnerCruise], hints: [{ placeId: dinnerCruise.id, dayIndex: 0, durationMinutes: 120 }], bounds: [{ startMinutes: 600, endMinutes: 1320 }, { startMinutes: 480, endMinutes: 1320 }, { startMinutes: 480, endMinutes: 1320 }, { startMinutes: 480, endMinutes: null }] })[0],
      meals: [
        { type: 'lunch', place: place('lunch'), durationMinutes: 60, targetStartMinutes: 780, location: 'restaurant', dietaryNote: 'both' },
        { type: 'dinner', place: place('dinner'), durationMinutes: 75, targetStartMinutes: 1170, location: 'restaurant', dietaryNote: 'both' },
      ],
      legs: [],
    };
    prepareDaySchedule(day, 2, { startMinutes: 600, endMinutes: 1320 });
    expect(day.meals?.map(meal => meal.type)).toEqual(['lunch']);
  });

  it('retains manual provenance for a combined meal experience', () => {
    const cookingClass = { ...place('cooking class'), mealInclusion: { type: 'lunch' as const, evidence: 'manual' as const, sourceLabel: 'Traveller-provided booking', note: 'The submitted booking says lunch is included.' } };
    const [visit] = allocateActivities({ brief: brief(), candidates: [cookingClass], hints: [{ placeId: cookingClass.id, dayIndex: 1, durationMinutes: 120 }], bounds: [{ startMinutes: null, endMinutes: 1320 }, { startMinutes: 480, endMinutes: 1320 }, { startMinutes: 480, endMinutes: 1320 }, { startMinutes: 480, endMinutes: null }] })[1];
    expect(visit.mealCoverage).toEqual(cookingClass.mealInclusion);
  });
});
