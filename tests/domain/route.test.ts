import { describe, expect, it } from "vitest";
import {
  activityCallFitsRoute,
  requiredRouteCalls,
  routeEvidenceProblems,
  routeScopeProblems,
} from "@/domain/route";

const graph = [
  { id: "country:example" },
  { id: "region:coast", parentId: "country:example" },
  { id: "city:north-bay", parentId: "region:coast" },
  { id: "city:south-bay", parentId: "region:coast" },
  { id: "airport:north", parentId: "city:north-bay" },
];

const route = {
  originId: "city:origin",
  marketId: "region:coast",
  stopIds: ["city:north-bay", "city:south-bay"],
  nightAllocation: [2, 3],
  tripDurationDays: 6,
};

describe("generic multi-stop route contract", () => {
  it("derives the complete evidence shape from any ordered route", () => {
    const calls = [
      { tool: "search_transport" as const, from: "city:origin", to: "city:north-bay", tripDayNumber: 1 },
      { tool: "search_stays" as const, locationId: "city:north-bay", checkInDayNumber: 1, nights: 2 },
      { tool: "search_transfers" as const, from: "city:north-bay", to: "city:south-bay" },
      { tool: "search_stays" as const, locationId: "city:south-bay", checkInDayNumber: 3, nights: 3 },
      { tool: "search_transport" as const, from: "city:south-bay", to: "city:origin", tripDayNumber: 6 },
    ];

    expect(requiredRouteCalls(route).map((requirement) => requirement.id)).toEqual([
      "outbound",
      "stay:0",
      "transfer:0",
      "stay:1",
      "return",
    ]);
    expect(routeScopeProblems(route, graph, "region:coast")).toEqual([]);
    expect(routeEvidenceProblems(route, calls)).toEqual([]);
  });

  it("rejects cross-market stops and activities assigned to the wrong stop days", () => {
    expect(
      routeScopeProblems(
        { ...route, stopIds: ["city:north-bay", "city:elsewhere"] },
        graph,
        "region:coast",
      ),
    ).toContain("Route stop city:elsewhere is outside market region:coast");

    expect(
      activityCallFitsRoute(
        route,
        {
          tool: "search_activities",
          locationId: "city:south-bay",
          tripDayNumbers: [2],
        },
        graph,
      ),
    ).toBe(false);
  });
});
