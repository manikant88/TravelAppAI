import { calendarDayDifference, isValidISODate } from '@/domain/dates';
import { LIVE_TRIP_MAX_DAYS, LIVE_TRIP_MIN_DAYS } from './contracts';

const MONTH_PATTERN = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export type ExplicitLiveDateRange = { startDate: string; endDate: string; days: number };

export function explicitLiveDateRange(message: string): ExplicitLiveDateRange | undefined {
  const dates: { index: number; value: string }[] = [];
  for (const match of message.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const value = `${match[1]}-${match[2]}-${match[3]}`;
    if (isValidISODate(value)) dates.push({ index: match.index, value });
  }
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_PATTERN})[\\s,]+(20\\d{2})\\b`, 'gi');
  for (const match of message.matchAll(dayFirst)) {
    const value = isoDate(Number(match[3]), monthNumber(match[2]!), Number(match[1]));
    if (value) dates.push({ index: match.index, value });
  }
  const monthFirst = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2})\\b`, 'gi');
  for (const match of message.matchAll(monthFirst)) {
    const value = isoDate(Number(match[3]), monthNumber(match[1]!), Number(match[2]));
    if (value) dates.push({ index: match.index, value });
  }
  const ordered = dates.sort((a, b) => a.index - b.index).filter((entry, index, all) => index === 0 || entry.index !== all[index - 1]!.index);
  if (ordered.length < 2) return undefined;
  const startDate = ordered[0]!.value;
  const endDate = ordered[1]!.value;
  const days = calendarDayDifference(startDate, endDate) + 1;
  return days >= LIVE_TRIP_MIN_DAYS && days <= LIVE_TRIP_MAX_DAYS ? { startDate, endDate, days } : undefined;
}

function monthNumber(value: string) { return MONTHS[value.slice(0, 3).toLowerCase()]!; }
function isoDate(year: number, month: number, day: number) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidISODate(value) ? value : undefined;
}
