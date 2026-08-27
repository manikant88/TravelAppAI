import type { ISODate, ISODateTime, LocalTime, RouteStop } from "@/domain/model";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseCalendarDate(value: ISODate): Date {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`Invalid ISO calendar date: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }

  return date;
}

export function isValidISODate(value: string): value is ISODate {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

export function calendarWeekday(value: ISODate): number {
  return parseCalendarDate(value).getUTCDay();
}

function zonedParts(instant: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function timezoneOffsetMinutes(localAsUtc: number, timezone: string): number {
  let instant = localAsUtc;
  let offset = 0;

  // A second pass accounts for zones whose offset at the UTC guess differs
  // from the offset at the represented local instant (for example around DST).
  for (let iteration = 0; iteration < 2; iteration += 1) {
    offset = Math.round((zonedParts(instant, timezone) - instant) / 60_000);
    instant = localAsUtc - offset * 60_000;
  }

  return offset;
}

export function localDateTimeWithOffset(
  date: ISODate,
  time: LocalTime,
  timezone: string,
): ISODateTime {
  const calendarDate = parseCalendarDate(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!timeMatch) throw new Error(`Invalid local time: ${time}`);

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] ?? "0");
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Invalid local time: ${time}`);
  }

  // Validate the timezone before calculating its offset.
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(calendarDate);
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }

  const localAsUtc = Date.UTC(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth(),
    calendarDate.getUTCDate(),
    hours,
    minutes,
    seconds,
  );
  const offsetMinutes = timezoneOffsetMinutes(localAsUtc, timezone);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  const normalizedTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return `${date}T${normalizedTime}${sign}${offsetHours}:${offsetRemainder}`;
}

export function addMinutesInTimezone(
  value: ISODateTime,
  minutes: number,
  timezone: string,
): ISODateTime {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error("Datetime minute offsets must be non-negative integers");
  }
  const start = Date.parse(value);
  if (Number.isNaN(start)) throw new Error(`Invalid ISO datetime: ${value}`);

  const instant = start + minutes * 60_000;
  const localAsUtc = zonedParts(instant, timezone);
  const local = new Date(localAsUtc);
  const offsetMinutes = Math.round((localAsUtc - instant) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  const localDateTime = local.toISOString().slice(0, 19);

  return `${localDateTime}${sign}${offsetHours}:${offsetRemainder}`;
}

export function addCalendarDays(value: ISODate, days: number): ISODate {
  if (!Number.isInteger(days)) {
    throw new Error("Calendar-day offsets must be integers");
  }

  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDayDifference(start: ISODate, end: ISODate): number {
  const startDate = parseCalendarDate(start);
  const endDate = parseCalendarDate(end);
  return Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS);
}

export function tripDurationDays(startDate: ISODate, endDate: ISODate): number {
  const difference = calendarDayDifference(startDate, endDate);
  if (difference < 0) throw new Error("Trip end date must not be before start date");
  return difference + 1;
}

export function tripNightCount(startDate: ISODate, endDate: ISODate): number {
  const difference = calendarDayDifference(startDate, endDate);
  if (difference < 1) throw new Error("A planned trip must contain at least one night");
  return difference;
}

export function buildRouteStops(
  startDate: ISODate,
  endDate: ISODate,
  locationIds: string[],
  nightAllocation: number[],
): [RouteStop, ...RouteStop[]] {
  if (locationIds.length === 0 || locationIds.length !== nightAllocation.length) {
    throw new Error("Each route location requires one night allocation");
  }

  const expectedNights = tripNightCount(startDate, endDate);
  const allocatedNights = nightAllocation.reduce((total, nights) => total + nights, 0);

  if (nightAllocation.some((nights) => !Number.isInteger(nights) || nights < 1)) {
    throw new Error("Every route stop requires at least one whole night");
  }

  if (allocatedNights !== expectedNights) {
    throw new Error(`Expected ${expectedNights} route nights, received ${allocatedNights}`);
  }

  let cursor = startDate;
  const stops = locationIds.map((locationId, index) => {
    const checkOut = addCalendarDays(cursor, nightAllocation[index]);
    const stop = { locationId, checkIn: cursor, checkOut };
    cursor = checkOut;
    return stop;
  });

  return stops as [RouteStop, ...RouteStop[]];
}
