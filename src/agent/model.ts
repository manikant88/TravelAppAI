import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z, type ZodType, type ZodTypeDef } from "zod";
import {
  createOpenAIClientRequestId,
  resolveOpenAITimeoutMs,
  type OpenAIReasoningEffort,
} from "@/agent/openai-config.server";
import {
  agentNextActionSchema,
  planningHypothesisSchema,
  type AgentNextAction,
  type PlanningHypothesis,
} from "@/agent/contracts";
import type {
  LocationNode,
} from "@/domain/trip";
import type {
  PlannerDecisionInput,
  SpecifiedDestinationPlannerModel,
} from "@/agent/coordinator";
import type { PlannableTripRequest } from "@/domain/model";
import {
  modificationRecommendationSchema,
  scopedModificationIntentSchema,
  type ModificationPlannerModel,
} from "@/agent/modification-contracts";
import {
  destinationRecommendationSchema,
  type DestinationDiscoveryModel,
} from "@/agent/discovery";
import {
  explanationDraftSchema,
  type ExplanationModel,
} from "@/agent/explanation-contracts";
import {
  naturalTripIntentSchema,
  type NaturalTripIntent,
} from "@/agent/natural-intake-contracts";
import type { NaturalIntakeModel } from "@/agent/natural-intake";
import {
  conversationIntentSchema,
  type ConversationRouterModel,
} from "@/agent/conversation-contracts";
import { communicationOutputSchema, type CommunicationContext } from "@/agent/interaction-contracts";
import type { CommunicationModel } from "@/agent/communication";

export interface StructuredResponseRequest<T> {
  schema: ZodType<T, ZodTypeDef, unknown>;
  schemaName: string;
  instructions: string;
  input: string;
}

export interface StructuredResponseRunner {
  run<T>(request: StructuredResponseRequest<T>): Promise<unknown>;
}

export interface OpenAIPlannerModelOptions {
  model: string;
  apiKey?: string;
  runner?: StructuredResponseRunner;
  timeoutMs?: number;
  reasoningEffort?: OpenAIReasoningEffort;
}

const contextualTravelAnswerSchema = z.object({ message: z.string().trim().min(1).max(420) }).strict();

export interface TravelContextModel {
  answer(input: {
    question: string;
    origin: string;
    destination: string;
    routeStops: string[];
    startDate: string;
    endDate: string;
  }): Promise<string>;
}

const contextualTravelInstructions = `You answer a short contextual question inside a bounded travel-planning app.
The deterministic app has already established that the question is travel-related but cannot answer it from canonical itinerary data alone.
Reply in one to three short sentences. You may provide stable general travel knowledge about the supplied origin, destination, route stops, or a named place or activity.
Never claim access to live weather, forecasts, opening hours, availability, prices, safety alerts, or current conditions. For weather questions, clearly describe only typical seasonal conditions and say that the user should check a live forecast closer to travel.
Do not invent itinerary facts, IDs, bookings, or changes. Do not expose internal IDs or hidden reasoning. If the question needs live or unavailable information, state that limitation plainly and offer the closest useful travel-planning guidance.`;

export function createOpenAITravelContextModel(
  options: OpenAIPlannerModelOptions,
): TravelContextModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({
    ...options,
    model,
    timeoutMs: options.timeoutMs ?? resolveOpenAITimeoutMs("context"),
  });
  return {
    async answer(input) {
      const result = await runStructured(runner, {
        schema: contextualTravelAnswerSchema,
        schemaName: "contextual_travel_answer",
        instructions: contextualTravelInstructions,
        input: jsonForModel(input),
      });
      return result.message;
    },
  };
}

const naturalIntakeInstructions = `You are the natural-language intent extraction layer of one bounded travel planner.
Extract only details the user explicitly states or unambiguously implies. Return null or an empty array for details that are absent; do not copy defaults from the current structured brief into the extraction.
Return location names or airport codes as text queries. Code resolves them to normalized inventory IDs. Never invent location IDs.
Use destination kind open only when the user asks for recommendations or does not want to choose a destination. Otherwise return the stated destination as a text query.
Convert explicitly stated calendar dates and unambiguous relative phrases such as "this weekend" or "upcoming weekend" to YYYY-MM-DD using the supplied current date. When the user supplies a start date and an explicit number of nights, set endDate to startDate plus that many calendar nights. Do not shift a date merely to fit the inventory window. Do not invent dates, durations, or a year when the phrase is genuinely ambiguous.
Create one traveller group per explicitly stated traveller type. When the user gives a total party size and says it includes a child or senior, preserve the stated total and assign the remainder to adults (for example, "6 people including my 4-year-old" means 5 adults and 1 child). Do not infer children, seniors, mobility needs, or traveller counts that are not stated.
Classify "must", "only", "under", "no", and equivalent non-negotiable language as hard constraints. Treat ordinary preferences as strong or flexible. Maximum budgets use maxTotal; approximate budgets use targetTotal.
Interests are soft themes, not inventory facts. Do not invent prices, availability, schedules, recommendations, or explanations. Do not expose hidden reasoning.`;

export function createOpenAINaturalIntakeModel(
  options: OpenAIPlannerModelOptions,
): NaturalIntakeModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({ ...options, model });
  return {
    async extractTripIntent(input): Promise<NaturalTripIntent> {
      return runStructured(runner, {
        schema: naturalTripIntentSchema,
        schemaName: "natural_trip_intent",
        instructions: naturalIntakeInstructions,
        input: jsonForModel(input),
      });
    },
  };
}

const conversationRouterInstructions = `You route one user message inside an existing travel-planning conversation.
Choose modify_trip when the user asks to add, remove, replace, preserve, lock, unlock, constrain, relax, or otherwise change the committed trip.
Choose explain_trip when the user asks why, how, what, when, where, how much, or requests context about the current committed trip without asking to change it.
Use only the supplied message and canonical trip. Do not answer the user, plan a trip, invent facts, or mutate state. Return only the schema-constrained intent.`;

export function createOpenAIConversationRouterModel(
  options: OpenAIPlannerModelOptions,
): ConversationRouterModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({ ...options, model });
  return {
    classify(input) {
      return runStructured(runner, {
        schema: conversationIntentSchema,
        schemaName: "travel_conversation_intent",
        instructions: conversationRouterInstructions,
        input: jsonForModel(input),
      });
    },
  };
}

const idSchema = z.string().trim().min(1);
const modelToolCallBase = {
  id: idSchema,
  purpose: z.string().trim().min(1).max(240),
};
const modelPlannerToolCallSchema = z.union([
  z
    .object({
      ...modelToolCallBase,
      tool: z.literal("discover_destinations"),
      candidateMarketIds: z.array(idSchema).max(6).nullable(),
    })
    .strict(),
  z
    .object({
      ...modelToolCallBase,
      tool: z.literal("search_transport"),
      from: idSchema,
      to: idSchema,
      tripDayNumber: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...modelToolCallBase,
      tool: z.literal("search_stays"),
      locationId: idSchema,
      checkInDayNumber: z.number().int().positive(),
      nights: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...modelToolCallBase,
      tool: z.literal("search_activities"),
      locationId: idSchema,
      tripDayNumbers: z.array(z.number().int().positive()).min(1),
      themes: z.array(z.string().trim().min(1)).max(12),
    })
    .strict(),
  z
    .object({
      ...modelToolCallBase,
      tool: z.literal("search_transfers"),
      from: idSchema,
      to: idSchema,
    })
    .strict(),
]);
const modelToolPlanSchema = z
  .object({
    operationalSummary: z.string().trim().min(1).max(280),
    calls: z.array(modelPlannerToolCallSchema).min(1).max(12),
  })
  .strict();

function canonicalToolPlan(plan: z.infer<typeof modelToolPlanSchema>) {
  return {
    ...plan,
    calls: plan.calls.map((call) =>
      call.tool === "discover_destinations"
        ? { ...call, candidateMarketIds: call.candidateMarketIds ?? undefined }
        : call,
    ),
  };
}

const modelPlanningHypothesisSchema = z
  .object({
    goalSummary: z.string().trim().min(1).max(400),
    destinationMode: z.enum(["specified", "broad_scope", "open_ended"]),
    candidateMarketIds: z.array(idSchema).max(6),
    proposedStopIds: z.array(idSchema).max(6),
    nightAllocation: z.array(z.number().int().positive()).max(6),
    preferenceOrder: z
      .array(
        z.enum([
          "price",
          "timing",
          "duration",
          "comfort",
          "location",
          "activity_fit",
          "pace",
        ]),
      )
      .min(1),
    preserveSelectionIds: z.array(idSchema),
    toolPlan: modelToolPlanSchema,
  })
  .strict()
  .transform((value) =>
    planningHypothesisSchema.parse({
      ...value,
      toolPlan: canonicalToolPlan(value.toolPlan),
    }),
  );

const modelCandidateChoiceSchema = z
  .object({
    decisionId: idSchema,
    candidateId: idSchema,
    supportingFactIds: z.array(idSchema).min(1),
    comparisonDimensions: z.array(z.string().trim().min(1)).min(1),
    summary: z.string().trim().min(1).max(280).nullable(),
  })
  .strict();
const modelAgentNextActionSchema = z.union([
  z.object({ type: z.literal("search_more"), toolPlan: modelToolPlanSchema }).strict(),
  z
    .object({
      type: z.literal("clarify"),
      topic: z.enum(["budget", "pace", "mobility", "interests"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("present_destination_options"),
      candidateMarketIds: z.array(idSchema).min(2).max(4),
      recommendedMarketId: idSchema,
      supportingFactIds: z.array(idSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("propose_plan"),
      marketId: idSchema,
      stopIds: z.array(idSchema).min(1).max(6),
      nightAllocation: z.array(z.number().int().positive()).min(1).max(6),
      choices: z.array(modelCandidateChoiceSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("cannot_satisfy"),
      conflictFactIds: z.array(idSchema).min(1),
      suggestedRelaxationIds: z.array(idSchema),
    })
    .strict(),
]);

function canonicalAction(action: z.infer<typeof modelAgentNextActionSchema>) {
  if (action.type === "search_more") {
    return agentNextActionSchema.parse({
      ...action,
      toolPlan: canonicalToolPlan(action.toolPlan),
    });
  }
  if (action.type === "propose_plan") {
    return agentNextActionSchema.parse({
      ...action,
      choices: action.choices.map((choice) => ({
        ...choice,
        summary: choice.summary ?? undefined,
      })),
    });
  }
  return agentNextActionSchema.parse(action);
}

const actionOutputSchema = z
  .object({ action: modelAgentNextActionSchema })
  .strict()
  .transform((value) => ({ action: canonicalAction(value.action) }));

function jsonForModel(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Set) return [...item].sort();
    return item;
  });
}

function decisionEvidence(input: PlannerDecisionInput) {
  return {
    phase: input.phase,
    request: input.request,
    hypothesis: input.hypothesis,
    observations: input.observations,
    allowedComparisonDimensions: [
      ...new Set(
        input.factBundles.flatMap((bundle) => bundle.allowedComparisonDimensions),
      ),
    ].sort(),
    allowedFollowUpActions: input.factBundles.flatMap(
      (bundle) => bundle.allowedFollowUpActions,
    ),
    budget: {
      ...input.budget,
      priorCallSignatures: [...input.budget.priorCallSignatures].sort(),
    },
    validationFeedback: input.validationFeedback,
  };
}

function createOpenAIRunner(options: OpenAIPlannerModelOptions): StructuredResponseRunner {
  const client = new OpenAI({ apiKey: options.apiKey });
  const timeoutMs = options.timeoutMs ?? resolveOpenAITimeoutMs("planning");
  return {
    async run<T>(request: StructuredResponseRequest<T>) {
      const startedAt = Date.now();
      const clientRequestId = createOpenAIClientRequestId(request.schemaName);
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await client.responses.parse(
          {
            model: options.model,
            instructions: request.instructions,
            input: request.input,
            text: {
              format: zodTextFormat(request.schema, request.schemaName),
            },
            reasoning: options.reasoningEffort
              ? { effort: options.reasoningEffort }
              : undefined,
            store: false,
          },
          {
            signal,
            headers: { "X-Client-Request-Id": clientRequestId },
          },
        );
        if (response.status !== "completed" || response.output_parsed === null) {
          throw new Error("OpenAI returned no completed structured output");
        }
        console.info("Travel planner model call completed", JSON.stringify({
          schema: request.schemaName,
          model: options.model,
          reasoningEffort: options.reasoningEffort ?? null,
          durationMs: Date.now() - startedAt,
          clientRequestId,
          requestId: response._request_id ?? null,
        }));
        return response.output_parsed;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const timedOut = signal.aborted || (
          error instanceof DOMException && error.name === "TimeoutError"
        );
        const requestId = error && typeof error === "object" && "request_id" in error
          ? String(error.request_id)
          : null;
        console.error("Travel planner model call failed", JSON.stringify({
          schema: request.schemaName,
          model: options.model,
          reasoningEffort: options.reasoningEffort ?? null,
          timeoutMs,
          durationMs,
          timedOut,
          clientRequestId,
          requestId,
          reason: error instanceof Error ? error.message : String(error),
        }));
        if (timedOut) {
          throw new Error(
            `OpenAI request timed out after ${timeoutMs}ms (client request ${clientRequestId})`,
          );
        }
        throw error;
      }
    },
  };
}

const communicationInstructions = `You are the warm, capable voice of an AI travel planner.
Rewrite the supplied fallback into one cohesive, conversational response. It should sound like a thoughtful travel expert speaking naturally—not facts joined together, a status log, or marketing copy.
Lead with the useful outcome. Connect related facts smoothly, vary sentence rhythm, and use a calm, encouraging, softly expressive tone. Acknowledge constraints or setbacks without sounding cold or apologetic. Keep the response concise: usually two or three short sentences and never more than 90 words.
Use only the supplied fallback, facts, and visible operation events. Preserve every concrete fact exactly, including names, dates, times, prices, counts, durations, availability, and constraint outcomes. Never claim an action happened unless its event is completed. Never invent inventory, comparisons, reasons, destinations, next actions, or travel knowledge. Do not expose chain-of-thought or hidden reasoning.
Return one helpful message and short labels only for the supplied action IDs. Preserve every action ID exactly. Labels may improve tone but must not change what an action does.`;

export function createOpenAICommunicationModel(
  options: OpenAIPlannerModelOptions,
): CommunicationModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({
    ...options,
    model,
    timeoutMs: options.timeoutMs ?? resolveOpenAITimeoutMs("communication"),
  });
  return {
    compose(context: CommunicationContext) {
      return runStructured(runner, {
        schema: communicationOutputSchema,
        schemaName: "travel_interaction_copy",
        instructions: communicationInstructions,
        input: jsonForModel(context),
      });
    },
  };
}

async function runStructured<T>(
  runner: StructuredResponseRunner,
  request: StructuredResponseRequest<T>,
): Promise<T> {
  const output = await runner.run(request);
  return request.schema.parse(output);
}

const hypothesisInstructions = `You are the planning-strategy layer for a bounded travel planner.
Return only the schema-constrained planning hypothesis.
Use only location IDs and themes present in the supplied catalog scope, and travellers, dates, and constraints present in the canonical request.
For a specified destination, use exactly one candidate market: the requested destination market.
Choose a route strategy from ordinary location relationships. A single-stop route uses the market itself. A multi-stop route uses distinct descendant city or region nodes within that market; never use countries, airports, or neighborhoods as accommodation stops.
Use a multi-stop route only when the catalog graph exposes meaningful sibling destination nodes and the trip has enough nights to allocate at least one whole night to every stop. Do not rely on destination-name rules.
Allocate every trip night exactly once in route order.
This is an initial plan with no committed selections, so preserveSelectionIds must be an empty array; location or market IDs are never selection IDs.
The first tool plan must include transport from the origin to the first stop on trip day 1, one exact date-aligned stay search per stop, every adjacent inter-stop transfer in route order, and transport from the final stop back to the origin on the final trip day.
Search activity evidence for every calendar day at that day's route stop, including arrival and departure days. **A valid plan must select at least one activity for every calendar day that has an open, schedule-valid window.** Select one activity per day whenever a retrieved session fits around deterministic travel and transfer times; never force an overlapping activity. Pace controls activity intensity and duration, not whether an otherwise viable day is left empty. If the same activity appears on multiple dates, prefer different activity identities; only reuse one after all other valid activity identities for the route have been used.
Do not invent prices, schedules, availability, candidate IDs, or inventory facts.
Do not perform arithmetic that belongs to code. Do not include hidden reasoning.`;

const actionInstructions = `You are selecting the next bounded action for a travel plan.
Return only the schema-constrained action wrapper.
Use only candidate IDs, fact IDs, comparison dimensions, locations, themes, and follow-up action IDs supplied in the evidence.
Hard validity, dates, prices, budgets, locks, assembly, and state mutation belong to code.
You may request a materially different search when evidence is insufficient and the supplied budget permits it.
When proposing a plan, select a coherent set of observed candidates and ground every choice in that candidate's facts.
Select exactly one observed candidate for every required outbound transport, stop stay, inter-stop transfer, and return transport search. Select activities only from searches scoped to the proposed route. **Do not leave a day empty when its activity search contains a schedule-valid candidate.** Cover every trip day with one activity whenever possible, and avoid selecting the same underlying activity identity on multiple days until the available identities are exhausted; omit a day only when deterministic timing or inventory makes coverage impossible.
The proposed market, ordered stops, and night allocation must describe a route fully supported by the executed searches; they may differ from the initial hypothesis only when materially different evidence for that route has already been retrieved.
When structured validation feedback is present, make at most one targeted revision and never override it.
Do not invent facts or expose hidden reasoning.`;

export function createOpenAIPlannerModel(
  options: OpenAIPlannerModelOptions,
): SpecifiedDestinationPlannerModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({ ...options, model });

  return {
    deterministicStrategy: true,
    async createPlanningHypothesis(input: {
      request: PlannableTripRequest;
      catalogScope: {
        locationGraph: LocationNode[];
        marketIds: string[];
        supportedThemes: string[];
      };
    }): Promise<PlanningHypothesis> {
      return runStructured(runner, {
        schema: modelPlanningHypothesisSchema,
        schemaName: "travel_planning_hypothesis",
        instructions: hypothesisInstructions,
        input: jsonForModel({
          canonicalRequest: input.request,
          catalogScope: input.catalogScope,
        }),
      });
    },

    async chooseNextAction(input: PlannerDecisionInput): Promise<AgentNextAction> {
      const output = await runStructured(runner, {
        schema: actionOutputSchema,
        schemaName: "travel_planner_next_action",
        instructions: actionInstructions,
        input: jsonForModel(decisionEvidence(input)),
      });
      return output.action;
    },
  };
}

const modificationIntentInstructions = `You are the intent and scoping layer of one bounded travel-planner model.
Interpret the user's requested modification against the supplied canonical trip selections.
For replacement or removal, return exactly one target selection ID. Use replace for changing an inventory choice and remove only when the user asks to remove an activity.
Use add only when the user explicitly requests an activity on a trip date, and return that exact supplied ISO date.
Use upsert_constraint when the user asks to add or change a budget, travel, stay, activity, or daily-schedule rule. Extract exactly one complete typed constraint for that category and scope, carrying forward still-applicable fields from the existing canonical constraint. Do not assign its canonical ID; code owns constraint identity, replacement, and validation.
Use remove_constraint only when the user explicitly asks to remove an existing constraint, and return exactly one constraint ID from the canonical trip.
Classify "must", "only", "under", "no", and equivalent non-negotiable language as hard. Treat ordinary preferences as strong or flexible. A maximum budget uses maxTotal; an approximate budget uses targetTotal.
List selections the user explicitly asks to preserve. Code will additionally preserve every unrelated selection.
Set unlockTarget to true only when the user explicitly asks to unlock the target; never infer permission to unlock from a generic request to change it.
Use only supplied selection IDs and supported themes. preferredThemes may capture relevant supported activity themes from the request.
Do not invent inventory, prices, schedules, facts, or state changes. Do not expose hidden reasoning.`;

const modificationRecommendationInstructions = `You are the contextual recommendation layer of one bounded travel-planner model.
Choose exactly one candidate from the supplied hard-valid candidates using the user's goal and soft preferences.
Reference only supplied candidate and fact IDs, and only comparison dimensions supported by those facts.
All hard constraints, prices, dates, locks, proposal construction, validation, and state mutation belong to code.
Do not invent facts or expose hidden reasoning.`;

export function createOpenAIModificationModel(
  options: OpenAIPlannerModelOptions,
): ModificationPlannerModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({ ...options, model });

  return {
    interpretModification(input) {
      return runStructured(runner, {
        schema: scopedModificationIntentSchema,
        schemaName: "travel_modification_intent",
        instructions: modificationIntentInstructions,
        input: jsonForModel(input),
      });
    },
    recommendModification(input) {
      return runStructured(runner, {
        schema: modificationRecommendationSchema,
        schemaName: "travel_modification_recommendation",
        instructions: modificationRecommendationInstructions,
        input: jsonForModel(input),
      });
    },
  };
}

const destinationDiscoveryInstructions = `You are the destination recommendation layer of one bounded travel-planner model.
Choose two to four destinations only from the supplied hard-valid market candidates.
Recommend one candidate using the canonical request's interests, pace, travel effort, and budget preference.
Use only supplied market IDs, fact IDs, and allowed comparison dimensions.
Prices are conservative floors produced by code, not quotes. Do not make weather, visa, safety, cultural, or seasonal claims.
Inventory validity, reachability, hard constraints, price arithmetic, request mutation, and detailed planning belong to code.
Do not invent facts or expose hidden reasoning.`;

export function createOpenAIDestinationDiscoveryModel(
  options: OpenAIPlannerModelOptions,
): DestinationDiscoveryModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({
    ...options,
    model,
    timeoutMs: options.timeoutMs ?? resolveOpenAITimeoutMs("discovery"),
  });
  return {
    recommendDestinations(input) {
      return runStructured(runner, {
        schema: destinationRecommendationSchema,
        schemaName: "destination_discovery_recommendation",
        instructions: destinationDiscoveryInstructions,
        input: jsonForModel(input),
      });
    },
  };
}

const explanationInstructions = `You are the grounded explanation layer of one bounded travel-planner model.
Answer the supplied question in one to three concise sentences using only the supplied fact bundle.
Every sentence must cite the exact fact IDs that support it. Do not mention a number, date, time, price, place, operator, property, activity, constraint, or trip consequence unless the cited facts contain it.
Use comparative language only when the sentence cites facts from at least two different subjects. If historical alternatives are absent, explain the current choice and its trip consequences without implying it was better than an unseen option.
Do not search, recommend a mutation, invent facts, expose hidden reasoning, or describe chain-of-thought.`;

export function createOpenAIExplanationModel(
  options: OpenAIPlannerModelOptions,
): ExplanationModel {
  const model = options.model.trim();
  if (!model) throw new Error("OPENAI_MODEL is required");
  const runner = options.runner ?? createOpenAIRunner({ ...options, model });
  return {
    explain(input) {
      return runStructured(runner, {
        schema: explanationDraftSchema,
        schemaName: "grounded_trip_explanation",
        instructions: explanationInstructions,
        input: jsonForModel(input),
      });
    },
  };
}
