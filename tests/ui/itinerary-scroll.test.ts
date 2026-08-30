import { describe, expect, it } from "vitest";
import {
  activeItineraryDayAtLine,
  itineraryScrollTop,
} from "@/ui/itinerary-scroll";

describe("itinerary day navigation", () => {
  const days = [
    { date: "2026-10-10", top: -480 },
    { date: "2026-10-11", top: 146 },
    { date: "2026-10-12", top: 820 },
  ];

  it("keeps the current day active until the next heading crosses one stable line", () => {
    expect(activeItineraryDayAtLine(days, 145)).toBe("2026-10-10");
    expect(activeItineraryDayAtLine(days, 146)).toBe("2026-10-11");
  });

  it("defaults to the first day before any heading reaches the activation line", () => {
    expect(activeItineraryDayAtLine(days.map((day) => ({ ...day, top: day.top + 700 })), 146))
      .toBe("2026-10-10");
  });

  it("positions a clicked day below the sticky brief, day nav, and breathing room", () => {
    expect(itineraryScrollTop(1_200, 147)).toBe(1_053);
    expect(itineraryScrollTop(80, 147)).toBe(0);
  });
});
