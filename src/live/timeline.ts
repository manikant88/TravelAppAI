import type { LiveDay } from './contracts';

export type LiveDayStop =
  | (LiveDay['visits'][number] & { kind: 'activity'; sourceIndex: number; targetStartMinutes?: never })
  | (NonNullable<LiveDay['meals']>[number] & { kind: 'meal'; sourceIndex: number });

export function dayStops(day: LiveDay): LiveDayStop[] {
  const breakfast = (day.meals ?? []).filter(meal => meal.type === 'breakfast').map((meal, sourceIndex) => ({ ...meal, kind: 'meal' as const, sourceIndex }));
  const lunch = (day.meals ?? []).filter(meal => meal.type === 'lunch').map((meal, sourceIndex) => ({ ...meal, kind: 'meal' as const, sourceIndex }));
  const dinner = (day.meals ?? []).filter(meal => meal.type === 'dinner').map((meal, sourceIndex) => ({ ...meal, kind: 'meal' as const, sourceIndex }));
  const activities = day.visits.map((visit, sourceIndex) => ({ ...visit, kind: 'activity' as const, sourceIndex }));
  const fallback = [...breakfast, ...activities.slice(0, 1), ...lunch, ...activities.slice(1), ...dinner];
  if (!fallback.some(stop => stop.sequenceOrder !== undefined)) return fallback;
  const defaultOrder = (stop: LiveDayStop) => {
    if (stop.kind === 'meal') return stop.type === 'breakfast' ? 0 : stop.type === 'lunch' ? 30 : 70;
    return stop.sourceIndex === 0 ? 10 : 40 + stop.sourceIndex * 10;
  };
  return fallback.sort((a, b) => (a.sequenceOrder ?? defaultOrder(a)) - (b.sequenceOrder ?? defaultOrder(b)));
}
// A projection, never canonical/supplier times. Unknown connections propagate.
export function projectLiveDay(day: LiveDay, startMinutes: number | null = 600) {
  let cursor: number | null = startMinutes;
  const rows = [];
  const stops = dayStops(day);
  for (let i = 0; i < stops.length; i++) {
    const visit = stops[i]; const leg = day.legs[i]; const departure = cursor;
    const arrival = departure !== null && leg?.minutes != null ? departure + leg.minutes : null;
    const bufferMinutes = leg?.fromId === leg?.toId ? 0 : 15;
    const ready = arrival !== null ? arrival + bufferMinutes : null;
    const requestedStart = visit.kind === 'meal' ? visit.targetStartMinutes : visit.fixedStartMinutes;
    const start: number | null = ready !== null ? Math.max(ready, requestedStart ?? ready) : null;
    const waitMinutes = ready !== null && start !== null ? start - ready : null;
    cursor = start !== null ? start + visit.durationMinutes : null;
    rows.push({ visit, leg, departure, arrival, ready, start, end: cursor, bufferMinutes, waitMinutes });
  }
  const back = stops.length ? day.legs[stops.length] : undefined;
  const end = cursor !== null && back?.minutes != null ? cursor + back.minutes + 15 : null;
  return { rows, back, returnDeparture: cursor, returnArrival: cursor !== null && back?.minutes != null ? cursor + back.minutes : null, end };
}

export function localClockMinutes(value: string | undefined, offsetMinutes: number | undefined, relativeDate: string) {
  if (!value || offsetMinutes === undefined) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const local = new Date(instant.getTime() + offsetMinutes * 60_000);
  const midnight = new Date(`${relativeDate}T00:00:00Z`);
  return Math.round((local.getTime() - midnight.getTime()) / 60_000);
}
