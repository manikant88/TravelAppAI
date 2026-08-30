import { calendarDayDifference } from "@/domain/dates";
import type { ISODate, TripPace } from "@/domain/model";

export function minimumInitialActivityDays(
  startDate: ISODate,
  endDate: ISODate,
  pace: TripPace = "balanced",
): number {
  const interiorDays = Math.max(0, calendarDayDifference(startDate, endDate) - 1);
  if (interiorDays === 0) return 0;
  const target = pace === "relaxed"
    ? Math.ceil(interiorDays / 3)
    : pace === "packed"
      ? interiorDays
      : Math.ceil(interiorDays / 2);
  return Math.min(4, target);
}
