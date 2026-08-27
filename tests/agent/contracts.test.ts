import { describe, expect, it } from "vitest";
import {
  agentIntentSchema,
  agentNextActionSchema,
  observationBundleSchema,
  planningHypothesisSchema,
  plannerToolCallSchema,
  toolPlanSchema,
  validateAgentIntake,
  validateAgentNextAction,
  validatePlanningHypothesis,
  validateToolPlan,
  type AgentNextAction,
  type NextActionScope,
  type ObservationBundle,
  type PlannerBudgetState,
  type PlannerScope,
  type PlanningHypothesis,
  type ToolPlan,
} from "@/agent/contracts";

const scope: PlannerScope = {
  tripDurationDays: 3,
  tripNights: 2,
  knownLocationIds: new Set([
    "city:delhi",
    "city:udaipur",
    "airport:udr",
    "neighborhood:udaipur-old-city",
  ]),
  knownMarketIds: new Set(["city:udaipur", "state:goa"]),
  knownSelectionIds: new Set(["selection:stay"]),
  supportedThemes: new Set(["heritage", "lake"]),
};

const emptyBudget: PlannerBudgetState = {
  evidenceRoundsUsed: 0,
  repairRoundsUsed: 0,
  searchCallsUsed: 0,
  optionalClarificationUsed: false,
  priorCallSignatures: new Set(),
};

const toolPlan: ToolPlan = {
  operationalSummary: "Check travel, accommodation, and relevant activities",
  calls: [
    {
      id: "call:transport",
      tool: "search_transport",
      purpose: "Find arrival options",
      from: "city:delhi",
      to: "city:udaipur",
      tripDayNumber: 1,
    },
    {
      id: "call:stay",
      tool: "search_stays",
      purpose: "Cover both trip nights",
      locationId: "neighborhood:udaipur-old-city",
      checkInDayNumber: 1,
      nights: 2,
    },
    {
      id: "call:activities",
      tool: "search_activities",
      purpose: "Find heritage activities",
      locationId: "neighborhood:udaipur-old-city",
      tripDayNumbers: [2],
      themes: ["heritage"],
    },
  ],
};

const observations: ObservationBundle[] = [
  {
    queryId: "query:transport",
    toolName: "search_transport",
    coverage: { status: "available" },
    candidates: [
      {
        candidateId: "offer:flight",
        facts: [
          {
            id: "fact:flight-price",
            subjectType: "transport",
            subjectId: "offer:flight",
            dimension: "price",
            label: "Return price per traveller",
            value: 9_500,
          },
          {
            id: "fact:flight-duration",
            subjectType: "transport",
            subjectId: "offer:flight",
            dimension: "duration",
            label: "Flight duration in minutes",
            value: 80,
          },
        ],
      },
    ],
    rejectedSummary: [],
  },
  {
    queryId: "query:stay",
    toolName: "search_stays",
    coverage: { status: "available" },
    candidates: [
      {
        candidateId: "offer:stay",
        facts: [
          {
            id: "fact:stay-location",
            subjectType: "stay",
            subjectId: "offer:stay",
            dimension: "location",
            label: "Stay area",
            value: "Old City",
          },
        ],
      },
    ],
    rejectedSummary: [],
  },
];

const nextActionScope: NextActionScope = {
  ...scope,
  observations,
  factBundles: [
    {
      facts: [
        {
          id: "fact:trip-budget-conflict",
          subjectType: "trip",
          subjectId: "trip:1",
          dimension: "price",
          label: "Amount over maximum budget",
          value: 5_000,
        },
      ],
      allowedComparisonDimensions: ["price", "duration", "location"],
      allowedFollowUpActions: [
        {
          id: "relax:budget",
          label: "Increase the maximum budget",
          type: "adjust_constraint",
        },
      ],
    },
  ],
};

describe("agent contract shapes", () => {
  it("accepts the three intents and rejects invented fields", () => {
    expect(agentIntentSchema.safeParse({ type: "plan_trip" }).success).toBe(true);
    expect(
      agentIntentSchema.safeParse({
        type: "modify_trip",
        targetKinds: ["stay"],
        targetSelectionIds: ["selection:stay"],
        preserveSelectionIds: [],
        goal: "Move closer to the lake",
      }).success,
    ).toBe(true);
    expect(
      agentIntentSchema.safeParse({ type: "explain", question: "Why this stay?" }).success,
    ).toBe(true);
    expect(
      agentIntentSchema.safeParse({ type: "plan_trip", hiddenReasoning: "because" }).success,
    ).toBe(false);
  });

  it("rejects unknown tools, extra parameters, and malformed observations", () => {
    expect(
      plannerToolCallSchema.safeParse({
        id: "call:1",
        tool: "book_hotel",
        purpose: "Book directly",
      }).success,
    ).toBe(false);
    expect(
      plannerToolCallSchema.safeParse({
        id: "call:1",
        tool: "search_stays",
        purpose: "Find a stay",
        locationId: "city:udaipur",
        checkInDayNumber: 1,
        nights: 2,
        maxPriceInventedByModel: 4_000,
      }).success,
    ).toBe(false);
    expect(
      observationBundleSchema.safeParse({
        ...observations[0],
        coverage: { status: "no_availability" },
      }).success,
    ).toBe(false);
    expect(
      observationBundleSchema.safeParse({
        ...observations[0],
        candidates: [
          {
            candidateId: "offer:flight",
            facts: [{ ...observations[0].candidates[0].facts[0], subjectId: "offer:invented" }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("scoped agent contract validation", () => {
  it("validates material tool calls against locations, trip days, themes, and budgets", () => {
    expect(validateToolPlan(toolPlan, scope, emptyBudget)).toMatchObject({ valid: true });

    const invalidPlan = toolPlanSchema.parse({
      operationalSummary: "Search invalid evidence",
      calls: [
        {
          id: "call:bad-activity",
          tool: "search_activities",
          purpose: "Search an unsupported theme outside the trip",
          locationId: "city:missing",
          tripDayNumbers: [4],
          themes: ["weather"],
        },
      ],
    });
    const result = validateToolPlan(invalidPlan, scope, {
      ...emptyBudget,
      evidenceRoundsUsed: 2,
      searchCallsUsed: 12,
    });
    expect(result.valid).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_ID",
        "INVALID_TRIP_DAY",
        "UNSUPPORTED_THEME",
        "TOOL_BUDGET_EXCEEDED",
        "EVIDENCE_ROUND_EXCEEDED",
      ]),
    );
  });

  it("rejects same-round and prior-round duplicate searches", () => {
    const duplicate = toolPlanSchema.parse({
      operationalSummary: "Repeat the same transfer lookup",
      calls: [
        {
          id: "call:one",
          tool: "search_transfers",
          purpose: "First lookup",
          from: "airport:udr",
          to: "neighborhood:udaipur-old-city",
        },
        {
          id: "call:two",
          tool: "search_transfers",
          purpose: "Same lookup again",
          from: "airport:udr",
          to: "neighborhood:udaipur-old-city",
        },
      ],
    });
    expect(validateToolPlan(duplicate, scope, emptyBudget).violations).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_CALL", referenceId: "call:two" }),
    );
  });

  it("validates intent scope and prevents request patches from mutating existing trips", () => {
    const valid = validateAgentIntake(
      {
        intent: {
          type: "modify_trip",
          targetKinds: ["stay"],
          targetSelectionIds: ["selection:stay"],
          preserveSelectionIds: [],
          goal: "Find a quieter stay",
        },
        requestPatch: {},
      },
      { hasTrip: true, knownSelectionIds: scope.knownSelectionIds },
    );
    expect(valid.valid).toBe(true);

    const invalid = validateAgentIntake(
      {
        intent: { type: "explain", question: "Why?", selectionId: "selection:missing" },
        requestPatch: { pace: "relaxed" },
      },
      { hasTrip: true, knownSelectionIds: scope.knownSelectionIds },
    );
    expect(invalid.violations.map((violation) => violation.code)).toEqual([
      "UNKNOWN_ID",
      "INVALID_INTENT",
    ]);
  });

  it("validates planning hypotheses and trip-night allocation", () => {
    const hypothesis: PlanningHypothesis = {
      goalSummary: "A balanced heritage trip to Udaipur",
      destinationMode: "specified",
      candidateMarketIds: ["city:udaipur"],
      proposedStopIds: ["neighborhood:udaipur-old-city"],
      nightAllocation: [2],
      preferenceOrder: ["timing", "location", "price"],
      preserveSelectionIds: [],
      toolPlan,
    };
    expect(planningHypothesisSchema.safeParse(hypothesis).success).toBe(true);
    expect(validatePlanningHypothesis(hypothesis, scope, emptyBudget).valid).toBe(true);
    expect(
      validatePlanningHypothesis({ ...hypothesis, nightAllocation: [1] }, scope, emptyBudget)
        .violations,
    ).toContainEqual(expect.objectContaining({ code: "INVALID_NIGHT_ALLOCATION" }));
  });

  it("accepts only observed candidates with candidate-owned facts and allowed dimensions", () => {
    const action: AgentNextAction = {
      type: "propose_plan",
      marketId: "city:udaipur",
      stopIds: ["neighborhood:udaipur-old-city"],
      nightAllocation: [2],
      choices: [
        {
          decisionId: "decision:transport",
          candidateId: "offer:flight",
          supportingFactIds: ["fact:flight-price", "fact:flight-duration"],
          comparisonDimensions: ["price", "duration"],
          summary: "Uses the lower-priced direct option",
        },
        {
          decisionId: "decision:stay",
          candidateId: "offer:stay",
          supportingFactIds: ["fact:stay-location"],
          comparisonDimensions: ["location"],
        },
      ],
    };
    expect(agentNextActionSchema.safeParse(action).success).toBe(true);
    expect(validateAgentNextAction(action, nextActionScope, emptyBudget).valid).toBe(true);

    const invalid: AgentNextAction = {
      ...action,
      choices: [
        {
          decisionId: "decision:bad",
          candidateId: "offer:stay",
          supportingFactIds: ["fact:flight-price"],
          comparisonDimensions: ["weather"],
        },
      ],
    };
    expect(validateAgentNextAction(invalid, nextActionScope, emptyBudget).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "FACT_CANDIDATE_MISMATCH" }),
        expect.objectContaining({ code: "UNSUPPORTED_COMPARISON" }),
      ]),
    );
  });

  it("enforces one optional clarification and grounded conflict actions", () => {
    expect(
      validateAgentNextAction(
        { type: "clarify", topic: "pace" },
        nextActionScope,
        { ...emptyBudget, optionalClarificationUsed: true },
      ).violations,
    ).toContainEqual(expect.objectContaining({ code: "CLARIFICATION_ALREADY_USED" }));

    expect(
      validateAgentNextAction(
        {
          type: "cannot_satisfy",
          conflictFactIds: ["fact:trip-budget-conflict"],
          suggestedRelaxationIds: ["relax:budget"],
        },
        nextActionScope,
        emptyBudget,
      ).valid,
    ).toBe(true);

    expect(
      validateAgentNextAction(
        {
          type: "cannot_satisfy",
          conflictFactIds: ["fact:missing"],
          suggestedRelaxationIds: ["relax:unknown"],
        },
        nextActionScope,
        emptyBudget,
      ).violations,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_FACT" }),
        expect.objectContaining({ code: "UNKNOWN_FOLLOW_UP_ACTION" }),
      ]),
    );
  });
});
