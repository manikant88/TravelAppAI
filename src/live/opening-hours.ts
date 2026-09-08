import type { LivePlace, ScheduleValidation } from './contracts';

export type RegularHoursStatus = 'open' | 'closed' | 'unknown';

export function regularHoursStatus(place: LivePlace, date: string): RegularHoursStatus {
  const periods = place.regularHours;
  if (periods === undefined) return 'unknown';
  if (!periods.length) return 'closed';
  if (periods.some(period => !period.close)) return 'open';
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const start = weekday * 1440;
  const end = start + 1440;
  return periods.some(period => {
    const opens = period.open.day * 1440 + period.open.hour * 60 + period.open.minute;
    let closes = period.close!.day * 1440 + period.close!.hour * 60 + period.close!.minute;
    if (closes <= opens) closes += 7 * 1440;
    return [opens - 7 * 1440, opens, opens + 7 * 1440].some(candidate => candidate < end && candidate + (closes - opens) > start);
  }) ? 'open' : 'closed';
}

export function regularHoursAt(place: LivePlace, date: string, minuteOfDay: number): RegularHoursStatus {
  const periods = place.regularHours;
  if (periods === undefined) return 'unknown';
  if (!periods.length) return 'closed';
  if (periods.some(period => !period.close)) return 'open';
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const target = weekday * 1440 + minuteOfDay;
  return periods.some(period => {
    const opens = period.open.day * 1440 + period.open.hour * 60 + period.open.minute;
    let closes = period.close!.day * 1440 + period.close!.hour * 60 + period.close!.minute;
    if (closes <= opens) closes += 7 * 1440;
    return [target - 7 * 1440, target, target + 7 * 1440].some(candidate => candidate >= opens && candidate < closes);
  }) ? 'open' : 'closed';
}

export function validateRegularHoursInterval(place: LivePlace, date: string, startsAtMinutes: number, endsAtMinutes: number): ScheduleValidation {
  if (endsAtMinutes <= startsAtMinutes) throw new Error('The schedule interval must end after it starts.');
  const periods = place.regularHours;
  const clock = (minutes: number) => {
    const dayOffset = Math.floor(minutes / 1440);
    const value = ((minutes % 1440) + 1440) % 1440;
    const label = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    return dayOffset > 0 ? `${label} +${dayOffset}d` : label;
  };
  const base = { evidence: 'regular_hours' as const, startsAtMinutes, endsAtMinutes };
  if (periods === undefined) return { ...base, status: 'unresolved', note: `Regular hours are unavailable for ${clock(startsAtMinutes)}–${clock(endsAtMinutes)}` };
  if (!periods.length) return { ...base, status: 'invalid', note: `Regular schedule does not cover ${clock(startsAtMinutes)}–${clock(endsAtMinutes)}` };
  if (periods.some(period => !period.close)) return { ...base, status: 'valid', note: `Regular schedule covers ${clock(startsAtMinutes)}–${clock(endsAtMinutes)}` };
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const targetStart = weekday * 1440 + startsAtMinutes;
  const targetEnd = weekday * 1440 + endsAtMinutes;
  const covered = periods.some(period => {
    const opens = period.open.day * 1440 + period.open.hour * 60 + period.open.minute;
    let closes = period.close!.day * 1440 + period.close!.hour * 60 + period.close!.minute;
    if (closes <= opens) closes += 7 * 1440;
    return [-7 * 1440, 0, 7 * 1440].some(offset => targetStart >= opens + offset && targetEnd <= closes + offset);
  });
  return covered
    ? { ...base, status: 'valid', note: `Regular schedule covers ${clock(startsAtMinutes)}–${clock(endsAtMinutes)}` }
    : { ...base, status: 'invalid', note: `Regular schedule does not cover the complete ${clock(startsAtMinutes)}–${clock(endsAtMinutes)} interval` };
}

export function hoursValidationNote(status: RegularHoursStatus, date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
  if (status === 'open') return `Regular schedule shows open on ${weekday}`;
  if (status === 'closed') return `Usually closed on ${weekday}`;
  return `Opening hours unavailable for ${weekday}`;
}
