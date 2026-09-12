import type { ActivityTimingEvidence, ConstraintFinding, DurationProfile, LiveBrief, LiveDay, LiveMeal, LivePlace, LiveVisit, MealWindow } from './contracts';
import { projectLiveDay } from './timeline';

export type DayBounds = { startMinutes: number | null; endMinutes: number | null; travelOnly?: boolean };
export type ActivityHint = { placeId: string; dayIndex: number; durationMinutes: number };

const PACE_LIMIT = { relaxed: 2, balanced: 3, packed: 4 } as const;

export function resolvedPace(brief: LiveBrief) {
  return brief.pace ?? 'balanced';
}

export function activityDurationProfile(place: LivePlace, suggestedMinutes = 90, timing?: ActivityTimingEvidence): DurationProfile {
  if (timing) return { kind: timing.kind, minimumMinutes: timing.durationMinutes, preferredMinutes: timing.durationMinutes, maximumMinutes: timing.durationMinutes, groupSensitivity: 'none', evidence: timing.source };
  const text = `${place.name} ${place.editorialSummary ?? ''}`.toLowerCase();
  const preferred = clamp(roundTo15(suggestedMinutes), 30, 240);
  if (/\b(concert|show|cinema|theatre|theater|performance|match|class|workshop)\b/.test(text)) {
    return { kind: 'elastic', minimumMinutes: preferred, preferredMinutes: preferred, maximumMinutes: preferred, groupSensitivity: 'none', evidence: 'planning_assumption' };
  }
  if (/\b(trek|trekking|hike|hiking|trail|safari|theme park|amusement park|water park)\b/.test(text)) {
    const difficulty = /\b(hard|difficult|challenging|steep|strenuous)\b/.test(text) ? 'hard' : /\b(easy|beginner|gentle)\b/.test(text) ? 'easy' : /\b(moderate|intermediate)\b/.test(text) ? 'moderate' : 'unknown';
    const difficultyAdjustment = difficulty === 'hard' ? 60 : difficulty === 'moderate' ? 30 : difficulty === 'easy' ? -15 : 0;
    const outdoorPreferred = clamp(Math.max(120, preferred) + difficultyAdjustment, 90, 330);
    return { kind: 'pace_sensitive', minimumMinutes: Math.max(90, outdoorPreferred - 30), preferredMinutes: outdoorPreferred, maximumMinutes: Math.max(300, outdoorPreferred), groupSensitivity: 'high', evidence: 'planning_assumption', difficulty, daylightWindow: { startMinutes: 360, endMinutes: 1110, evidence: 'planning_assumption' } };
  }
  if (/\b(fort|palace|museum|zoo|temple|monument|heritage|gallery)\b/.test(text)) {
    return { kind: 'elastic', minimumMinutes: 60, preferredMinutes: Math.max(90, preferred), maximumMinutes: 210, groupSensitivity: 'medium', evidence: 'planning_assumption' };
  }
  if (/\b(club|pub|bar|night market|nightlife)\b/.test(text)) {
    return { kind: 'open_ended', minimumMinutes: 60, preferredMinutes: Math.max(90, preferred), maximumMinutes: 240, groupSensitivity: 'low', evidence: 'planning_assumption' };
  }
  return { kind: 'elastic', minimumMinutes: 45, preferredMinutes: preferred, maximumMinutes: Math.max(150, preferred), groupSensitivity: 'low', evidence: 'planning_assumption' };
}

export function activityDuration(profile: DurationProfile, travellers: number) {
  if (profile.kind === 'fixed' || profile.kind === 'provider_slot') return profile.preferredMinutes;
  const groupAdjustment = profile.groupSensitivity === 'high'
    ? travellers >= 6 ? 30 : travellers >= 3 ? 15 : 0
    : profile.groupSensitivity === 'medium'
      ? travellers >= 6 ? 15 : 0
      : 0;
  return clamp(roundTo15(profile.preferredMinutes + groupAdjustment), profile.minimumMinutes, profile.maximumMinutes);
}

export function mealWindow(type: LiveMeal['type'], brief?: LiveBrief): MealWindow {
  if (type === 'breakfast') return { preferredStartMinutes: 480, preferredEndMinutes: 540, earliestStartMinutes: 450, latestStartMinutes: 570 };
  const base = type === 'lunch'
    ? { preferredStartMinutes: 750, preferredEndMinutes: 870, earliestStartMinutes: 690, latestStartMinutes: 930 }
    : { preferredStartMinutes: 1140, preferredEndMinutes: 1320, earliestStartMinutes: 1080, latestStartMinutes: 1380 };
  const explicit = brief ? explicitMealTime(type, [...brief.constraints, brief.dietaryNotes]) : null;
  if (explicit === null) return base;
  return { preferredStartMinutes: explicit, preferredEndMinutes: explicit, earliestStartMinutes: explicit - 60, latestStartMinutes: explicit + 60 };
}

export function mealDuration(type: LiveMeal['type'], travellers: number) {
  const base = type === 'breakfast' ? 45 : type === 'lunch' ? 60 : 75;
  return base + (travellers >= 7 ? 30 : travellers >= 4 ? 15 : 0);
}

export function targetActivityCount(brief: LiveBrief, dayIndex: number, bounds: DayBounds) {
  if (bounds.travelOnly) return 0;
  const pace = resolvedPace(brief);
  const max = PACE_LIMIT[pace];
  if (bounds.startMinutes === null || bounds.endMinutes === null) return dayIndex === 0 || dayIndex === (brief.days ?? 1) - 1 ? 1 : Math.min(max, 2);
  const usable = Math.max(0, bounds.endMinutes - bounds.startMinutes);
  if (usable < 210) return 0;
  const byTime = usable >= 660 ? max : usable >= 420 ? Math.min(max, 2) : 1;
  return Math.min(byTime, dayIndex === 0 || dayIndex === (brief.days ?? 1) - 1 ? 2 : max);
}

export function allocateActivities(input: {
  brief: LiveBrief;
  candidates: LivePlace[];
  hints: ActivityHint[];
  bounds: DayBounds[];
}): LiveVisit[][] {
  const days = Array.from({ length: input.brief.days ?? input.bounds.length }, () => [] as LiveVisit[]);
  const byId = new Map(input.candidates.map(place => [place.id, place]));
  const used = new Set<string>();
  const limits = days.map((_, index) => targetActivityCount(input.brief, index, input.bounds[index] ?? { startMinutes: null, endMinutes: null }));
  const add = (place: LivePlace, dayIndex: number, suggestedMinutes: number) => {
    if (used.has(place.id) || !days[dayIndex] || days[dayIndex].length >= limits[dayIndex]) return false;
    const durationProfile = activityDurationProfile(place, suggestedMinutes);
    const visit: LiveVisit = { place, durationProfile, durationMinutes: activityDuration(durationProfile, input.brief.travellers ?? 1), timingKind: 'estimated', mealCoverage: mealCoverage(place) };
    if (!fitsEstimatedDay(input.brief, dayIndex, input.bounds[dayIndex], [...days[dayIndex], visit])) return false;
    days[dayIndex].push(visit);
    used.add(place.id);
    return true;
  };
  for (const hint of input.hints) {
    const place = byId.get(hint.placeId);
    if (!place) continue;
    if (add(place, clamp(hint.dayIndex, 0, days.length - 1), hint.durationMinutes)) continue;
    const alternative = nearestOpenDay(days, limits, hint.dayIndex);
    if (alternative !== null) add(place, alternative, hint.durationMinutes);
  }
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    while (days[dayIndex].length < limits[dayIndex]) {
      const anchor = days[dayIndex].at(-1)?.place;
      const remaining = input.candidates.filter(place => !used.has(place.id));
      if (!remaining.length) break;
      remaining.sort((a, b) => anchor ? distanceSquared(a, anchor) - distanceSquared(b, anchor) : 0);
      if (!remaining.some(place => add(place, dayIndex, 90))) break;
    }
  }
  return days.map(visits => [...visits].sort((a, b) => Number(isEveningPlace(a.place)) - Number(isEveningPlace(b.place))).map((visit, index, ordered) => ({
    ...visit,
    period: isEveningPlace(visit.place) ? 'evening' : ordered.length >= 3 && index < 2 ? 'morning' : index === 0 ? 'morning' : 'afternoon',
    sequenceOrder: isEveningPlace(visit.place) ? 60 : ordered.length >= 3 && index < 2 ? 10 + index * 10 : index === 0 ? 10 : 30 + index * 10,
    mealCoverage: mealCoverage(visit.place),
  })));
}

export function prepareDaySchedule(day: LiveDay, travellers: number, bounds: DayBounds, brief?: LiveBrief) {
  day.availableStartMinutes = bounds.startMinutes;
  day.availableEndMinutes = bounds.endMinutes;
  day.visits = [...day.visits].sort((a, b) => Number(isEveningPlace(a.place)) - Number(isEveningPlace(b.place))).map((visit, index, visits) => {
    const durationProfile = visit.durationProfile ?? activityDurationProfile(visit.place, visit.durationMinutes, visit.timingEvidence);
    return {
      ...visit,
      durationProfile,
      durationMinutes: visit.timingEvidence ? visit.timingEvidence.durationMinutes : activityDuration(durationProfile, travellers),
      timingKind: visit.timingEvidence ? 'fixed' as const : visit.timingKind ?? 'estimated' as const,
      fixedStartMinutes: visit.timingEvidence?.startMinutes ?? visit.fixedStartMinutes,
      period: isEveningPlace(visit.place) ? 'evening' as const : visits.length >= 3 && index < 2 ? 'morning' as const : index === 0 ? 'morning' as const : 'afternoon' as const,
      sequenceOrder: visit.sequenceOrder ?? (isEveningPlace(visit.place) ? 60 : visits.length >= 3 && index < 2 ? 10 + index * 10 : index === 0 ? 10 : 30 + index * 10),
    };
  });
  const coveredMeals = new Set<'lunch' | 'dinner'>(day.visits.flatMap(visit => visit.mealCoverage ? [visit.mealCoverage.type] : []));
  day.meals = (day.meals ?? []).filter(meal => meal.type === 'breakfast' || !coveredMeals.has(meal.type)).map(meal => {
    const window = mealWindow(meal.type, brief);
    return { ...meal, durationMinutes: mealDuration(meal.type, travellers), window, sequenceOrder: meal.sequenceOrder ?? (meal.type === 'breakfast' ? 0 : meal.type === 'lunch' ? 30 : 70), targetStartMinutes: clamp(meal.targetStartMinutes, window.earliestStartMinutes, window.latestStartMinutes) };
  });
  const approximateStart = bounds.startMinutes ?? 600;
  const assumedTransfer = 30;
  for (const meal of day.meals) {
    if (!meal.window || meal.type === 'breakfast') continue;
    const priorMinutes = day.visits
      .filter(visit => (visit.sequenceOrder ?? 40) < (meal.sequenceOrder ?? 70))
      .reduce((total, visit) => total + visit.durationMinutes + assumedTransfer, 0);
    const ready = approximateStart + priorMinutes;
    meal.targetStartMinutes = clamp(Math.max(meal.window.preferredStartMinutes, ready), meal.window.earliestStartMinutes, meal.window.latestStartMinutes);
    meal.shiftedByMinutes = meal.targetStartMinutes - meal.window.preferredStartMinutes;
  }
}

export function reflowAndAssessDay(day: LiveDay, dayIndex: number, startMinutes: number | null, endMinutes: number | null, brief?: LiveBrief) {
  if (startMinutes !== null) {
    const meals = [...(day.meals ?? [])].sort((a, b) => (a.sequenceOrder ?? 70) - (b.sequenceOrder ?? 70));
    for (const meal of meals) {
      const projection = projectLiveDay(day, startMinutes);
      const row = projection.rows.find(candidate => candidate.visit.kind === 'meal' && candidate.visit.type === meal.type);
      if (!row || row.ready === null || !meal.window) continue;
      if (!meal) continue;
      meal.targetStartMinutes = Math.max(row.ready, clamp(row.ready, meal.window.preferredStartMinutes, meal.window.latestStartMinutes));
      meal.shiftedByMinutes = meal.targetStartMinutes - meal.window.preferredStartMinutes;
    }
  }
  const findings: ConstraintFinding[] = [];
  const projection = projectLiveDay(day, startMinutes);
  if (startMinutes === null) findings.push({ id: `day-${dayIndex}-start`, severity: 'unresolved', dayIndex, message: 'The day start is unresolved because arrival timing is unavailable.', overridable: true });
  projection.rows.forEach((row, index) => {
    if (row.leg?.minutes === null) findings.push({ id: `day-${dayIndex}-leg-${index}`, severity: 'unresolved', dayIndex, itemId: row.visit.place.id, message: `Travel time to ${row.visit.place.name} is unresolved.`, overridable: true });
    if (row.visit.kind === 'meal' && row.start !== null && row.visit.window && row.start > row.visit.window.latestStartMinutes) {
      findings.push({ id: `day-${dayIndex}-meal-${row.visit.type}`, severity: 'warning', dayIndex, itemId: row.visit.place.id, message: `${capitalize(row.visit.type)} starts outside its flexible meal window.`, overridable: true });
    }
    if (row.visit.kind === 'activity' && row.visit.durationProfile) {
      if (row.visit.timingKind === 'fixed' && row.visit.fixedStartMinutes !== undefined && row.ready !== null && row.ready > row.visit.fixedStartMinutes) findings.push({ id: `day-${dayIndex}-fixed-${row.visit.place.id}`, severity: 'blocking', dayIndex, itemId: row.visit.place.id, message: `${row.visit.place.name} cannot be reached before its fixed ${clock(row.visit.fixedStartMinutes)} start.`, overridable: false });
      if (row.visit.durationMinutes < row.visit.durationProfile.minimumMinutes) findings.push({ id: `day-${dayIndex}-short-${row.visit.place.id}`, severity: 'warning', dayIndex, itemId: row.visit.place.id, message: `${row.visit.place.name} is shorter than its recommended minimum duration.`, overridable: true });
      if (row.visit.durationMinutes > row.visit.durationProfile.maximumMinutes) findings.push({ id: `day-${dayIndex}-long-${row.visit.place.id}`, severity: 'blocking', dayIndex, itemId: row.visit.place.id, message: `${row.visit.place.name} exceeds its supported duration range.`, overridable: false });
      const daylight = row.visit.durationProfile.daylightWindow;
      if (daylight && row.start !== null && row.end !== null && (row.start < daylight.startMinutes || row.end > daylight.endMinutes)) findings.push({ id: `day-${dayIndex}-daylight-${row.visit.place.id}`, severity: 'warning', dayIndex, itemId: row.visit.place.id, message: `${row.visit.place.name} falls outside the conservative daylight planning window; verify dated daylight and provider guidance.`, overridable: true });
    }
    if (row.visit.scheduleValidation?.status === 'invalid') findings.push({ id: `day-${dayIndex}-closed-${row.visit.place.id}`, severity: 'blocking', dayIndex, itemId: row.visit.place.id, message: `${row.visit.place.name} is not covered by its regular opening hours for the complete planned interval.`, overridable: false });
    if (row.visit.scheduleValidation?.status === 'unresolved') findings.push({ id: `day-${dayIndex}-hours-${row.visit.place.id}`, severity: 'unresolved', dayIndex, itemId: row.visit.place.id, message: `Opening hours for ${row.visit.place.name} could not be validated for the complete interval.`, overridable: true });
  });
  if (endMinutes !== null && projection.end !== null && projection.end > endMinutes) findings.push({ id: `day-${dayIndex}-overrun`, severity: 'blocking', dayIndex, message: `The planned day ends ${formatDuration(projection.end - endMinutes)} after the available time.`, overridable: false });
  if (projection.end === null && day.visits.length) findings.push({ id: `day-${dayIndex}-end`, severity: 'unresolved', dayIndex, message: 'The complete day timing cannot be calculated until all travel legs resolve.', overridable: true });
  if (brief && hasUnspecifiedMedicalMealConstraint(brief)) findings.push({ id: `day-${dayIndex}-medical-meal`, severity: 'unresolved', dayIndex, message: 'A medical or medication-related meal constraint was supplied without an exact meal time; confirm the required timing before relying on this day.', overridable: true });
  day.availableStartMinutes = startMinutes;
  day.availableEndMinutes = endMinutes;
  day.findings = dedupeFindings(findings);
  day.capacityNote = capacityNote(day, projection.end, endMinutes);
  return day.findings;
}

function mealCoverage(place: LivePlace): LiveVisit['mealCoverage'] {
  if (place.mealInclusion) return place.mealInclusion;
  const text = `${place.name} ${place.editorialSummary ?? ''}`.toLowerCase();
  if (/\b(dinner included|includes dinner|dinner cruise|dinner show|supper included)\b/.test(text)) return { type: 'dinner', evidence: 'place_description', sourceLabel: 'Google place description', note: 'The place description indicates that dinner is included; confirm the dated provider details.' };
  if (/\b(lunch included|includes lunch|food tour|culinary tour|meal included)\b/.test(text)) return { type: 'lunch', evidence: 'place_description', sourceLabel: 'Google place description', note: 'The place description indicates that a meal is included; confirm the dated provider details.' };
  return undefined;
}

function fitsEstimatedDay(brief: LiveBrief, dayIndex: number, bounds: DayBounds | undefined, visits: LiveVisit[]) {
  if (!bounds || bounds.startMinutes === null || bounds.endMinutes === null) return true;
  const covered = new Set(visits.flatMap(visit => visit.mealCoverage ? [visit.mealCoverage.type] : []));
  const mealTypes: LiveMeal['type'][] = [
    ...(dayIndex > 0 ? ['breakfast' as const] : []),
    ...(!covered.has('lunch') ? ['lunch' as const] : []),
    ...(!covered.has('dinner') ? ['dinner' as const] : []),
  ];
  const meals = mealTypes.reduce((total, type) => total + mealDuration(type, brief.travellers ?? 1), 0);
  const activities = visits.reduce((total, visit) => total + visit.durationMinutes, 0);
  const assumedConnections = Math.max(0, visits.length + mealTypes.length + 1) * 30;
  return activities + meals + assumedConnections <= bounds.endMinutes - bounds.startMinutes;
}

function nearestOpenDay(days: LiveVisit[][], limits: number[], preferred: number) {
  return days.map((visits, index) => ({ index, distance: Math.abs(index - preferred), open: visits.length < limits[index] }))
    .filter(day => day.open).sort((a, b) => a.distance - b.distance || a.index - b.index)[0]?.index ?? null;
}

function isEveningPlace(place: LivePlace) { return /\b(club|pub|bar|night|concert|show|live music)\b/i.test(`${place.name} ${place.editorialSummary ?? ''}`); }
function distanceSquared(a: LivePlace, b: LivePlace) { return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2; }
function roundTo15(value: number) { return Math.round(value / 15) * 15; }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function formatDuration(minutes: number) { return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`; }
function dedupeFindings(findings: ConstraintFinding[]) { return [...new Map(findings.map(finding => [finding.id, finding])).values()]; }
function clock(minutes: number) { return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }

function explicitMealTime(type: LiveMeal['type'], values: string[]) {
  for (const value of values) {
    const match = new RegExp(`\\b${type}\\b[^.]{0,40}?\\b(?:at|by|before|around)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?`, 'i').exec(value);
    if (!match) continue;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const result = hour * 60 + minute;
    if (result >= 0 && result < 1440) return result;
  }
  return null;
}

function hasUnspecifiedMedicalMealConstraint(brief: LiveBrief) {
  const values = [...brief.constraints, brief.dietaryNotes];
  const medical = values.some(value => /\b(diabet|insulin|medication|medicine|medical|blood sugar|meal timing)\b/i.test(value));
  return medical && !(['breakfast', 'lunch', 'dinner'] as const).some(type => explicitMealTime(type, values) !== null);
}

function capacityNote(day: LiveDay, projectedEnd: number | null, availableEnd: number | null) {
  if (!day.visits.length) return 'No schedule-valid activity was placed for this day.';
  if (projectedEnd === null || availableEnd === null) return 'Additional activity capacity cannot be validated until the remaining travel time resolves.';
  const remaining = availableEnd - projectedEnd;
  if (remaining < 90) return undefined;
  return `${formatDuration(remaining)} remains flexible after scheduled activities, meals and travel; no additional validated candidate was placed.`;
}
