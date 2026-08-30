export type ItineraryDayPosition = {
  date: string;
  top: number;
};

export function activeItineraryDayAtLine(
  days: ItineraryDayPosition[],
  activationLine: number,
): string | undefined {
  let activeDay = days[0]?.date;

  for (const day of days) {
    if (day.top > activationLine) break;
    activeDay = day.date;
  }

  return activeDay;
}

export function itineraryScrollTop(documentTop: number, stickyOffset: number): number {
  return Math.max(0, documentTop - stickyOffset);
}
