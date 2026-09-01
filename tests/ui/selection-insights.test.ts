import { describe, expect, it } from "vitest";
import {
  activitySelectionInsight,
  staySelectionInsight,
  transferSelectionInsight,
  transportSelectionInsight,
} from "@/ui/selection-insights";

describe("itinerary selection insights", () => {
  it("turns a non-stop flight into a natural, grounded explanation", () => {
    expect(transportSelectionInsight({
      operator: "Air India Connect",
      from: "Delhi",
      to: "Dubai",
      departureTime: "14:30",
      arrivalTime: "18:10",
      stops: 0,
    })).toBe("A non-stop Air India Connect service keeps this leg simple: you’ll leave Delhi at 14:30 and arrive in Dubai at 18:10.");
  });

  it("describes connecting flights without claiming they are simple", () => {
    expect(transportSelectionInsight({
      operator: "Example Air",
      from: "Delhi",
      to: "Tokyo",
      departureTime: "09:00",
      arrivalTime: "22:10",
      stops: 2,
    })).toContain("with 2 stops");
  });

  it("formats room coverage, review confidence, and amenities naturally", () => {
    expect(staySelectionInsight({
      nights: 5,
      rooms: 1,
      rating: "4.1",
      reviewCount: 984,
      amenities: ["wifi", "breakfast"],
    })).toBe("1 room covers your full 5-night stay. The property is rated 4.1 from 984 reviews and includes Wi-Fi and breakfast.");
  });

  it("keeps activity recommendations tied to schedule and stated interests", () => {
    expect(activitySelectionInsight({
      mobility: "low",
      interests: ["relaxed", "family", "architecture"],
    })).toBe("This low-mobility experience fits comfortably into the day without clashing with your travel plans. It also connects with your relaxed, family, and architecture interests.");
  });

  it("describes the verified transfer connection", () => {
    expect(transferSelectionInsight({
      mode: "van",
      from: "Dubai Airport",
      to: "Dubai Marina",
      duration: "35m",
    })).toBe("This private van transfer gives you a direct connection from Dubai Airport to Dubai Marina, with 35m allowed for the journey.");
  });
});
