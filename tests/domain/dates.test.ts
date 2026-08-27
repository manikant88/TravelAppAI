import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addMinutesInTimezone,
  buildRouteStops,
  calendarDayDifference,
  localDateTimeWithOffset,
  tripDurationDays,
  tripNightCount,
} from "@/domain/dates";

describe("calendar date semantics", () => {
  it("derives inclusive trip days and exclusive stay nights", () => {
    expect(calendarDayDifference("2026-10-12", "2026-10-16")).toBe(4);
    expect(tripDurationDays("2026-10-12", "2026-10-16")).toBe(5);
    expect(tripNightCount("2026-10-12", "2026-10-16")).toBe(4);
  });

  it("adds calendar days without local-time drift", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("builds contiguous multi-stop accommodation boundaries", () => {
    expect(
      buildRouteStops(
        "2026-10-12",
        "2026-10-16",
        ["city:phuket", "city:krabi"],
        [2, 2],
      ),
    ).toEqual([
      { locationId: "city:phuket", checkIn: "2026-10-12", checkOut: "2026-10-14" },
      { locationId: "city:krabi", checkIn: "2026-10-14", checkOut: "2026-10-16" },
    ]);
  });

  it("rejects an allocation that does not cover all trip nights", () => {
    expect(() =>
      buildRouteStops("2026-10-12", "2026-10-16", ["city:phuket"], [3]),
    ).toThrow("Expected 4 route nights");
  });

  it("constructs explicit offsets from local inventory timezones", () => {
    expect(localDateTimeWithOffset("2026-10-10", "09:20", "Asia/Kolkata")).toBe(
      "2026-10-10T09:20:00+05:30",
    );
    expect(localDateTimeWithOffset("2026-10-10", "09:20", "America/New_York")).toBe(
      "2026-10-10T09:20:00-04:00",
    );
  });

  it("adds session duration while preserving the location offset", () => {
    expect(
      addMinutesInTimezone("2026-10-10T23:30:00+05:30", 90, "Asia/Kolkata"),
    ).toBe("2026-10-11T01:00:00+05:30");
  });
});
