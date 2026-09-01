import { runNaturalIntake } from "@/agent/natural-intake";
import { runModification } from "@/agent/modify";
import { runExplanation } from "@/agent/explain";
import {
  createOpenAIConversationRouterModel,
  createOpenAIExplanationModel,
  createOpenAIModificationModel,
  createOpenAINaturalIntakeModel,
  createOpenAITravelContextModel,
} from "@/agent/model";
import type { TripState } from "@/domain/model";
import { addCalendarDays } from "@/domain/dates";
import { createDeterministicModificationModel } from "@/agent/deterministic-modification";
import { createInventoryRepository } from "@/inventory/repository";
import { intakePresentation } from "@/agent/interaction-guidance";
import { applyCommunication } from "@/agent/communication";
import {
  generateAssistantCommunication,
  generateAssistantMessage,
} from "@/agent/assistant-message.server";
import { classifyCommittedConversation, contextualizedMessage } from "@/agent/conversation-routing";
import { getOpenAIModelConfig } from "@/agent/openai-config.server";
import type {
  CommittedConversationIntent,
  ConversationRequest,
} from "@/agent/conversation-contracts";
import { ConversationTurnTrace } from "@/agent/conversation-trace.server";
import type { GuidedAction } from "@/agent/interaction-contracts";
import type { NaturalIntakeResponse } from "@/agent/natural-intake-contracts";

export function verifiedDraftFacts(result: NaturalIntakeResponse): string[] {
  const facts: string[] = [];
  if (result.resolvedLocations.origin) {
    facts.push(`Verified starting city: ${result.resolvedLocations.origin.label}`);
  }
  if (result.request.destination?.kind === "open") {
    facts.push("Verified destination intent: open to recommendations");
  } else if (result.resolvedLocations.destination) {
    facts.push(`Verified destination: ${result.resolvedLocations.destination.label}`);
  }
  if (result.request.startDate && result.request.endDate) {
    facts.push(`Verified travel dates: ${result.request.startDate} to ${result.request.endDate}`);
  } else if (result.request.dateWindow) {
    facts.push(
      `Verified flexible travel window: ${result.request.dateWindow.label}${result.request.dateWindow.durationDays ? ` for ${result.request.dateWindow.durationDays} days` : ""}`,
    );
  }
  if (result.request.travellers.length > 0) {
    const counts = (["adult", "child", "senior"] as const)
      .map((type) => ({ type, count: result.request.travellers.filter((traveller) => traveller.type === type).length }))
      .filter(({ count }) => count > 0)
      .map(({ type, count }) => `${count} ${type}${count === 1 ? "" : type === "child" ? "ren" : "s"}`);
    facts.push(`Verified travellers: ${counts.join(", ")}`);
  }
  if (result.request.preferences.pace) {
    facts.push(`Verified pace: ${result.request.preferences.pace}`);
  }
  if (result.request.preferences.interests?.length) {
    facts.push(`Verified interests: ${result.request.preferences.interests.join(", ")}`);
  }
  facts.push(...result.issues.map((issue) => `Verified limitation: ${issue.message}`));
  return facts;
}

export function resolvePresentedActionId(
  message: string,
  actions: GuidedAction[] | undefined,
): string | undefined {
  const available = actions ?? [];
  const normalized = message.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim();
  const exact = available.find((action) => action.label.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim() === normalized);
  if (exact) return exact.id;
  const ordinals: Record<string, number> = {
    first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2,
    fourth: 3, "4th": 3, fifth: 4, "5th": 4, sixth: 5, "6th": 5,
    seventh: 6, "7th": 6, eighth: 7, "8th": 7,
  };
  const ordinal = message.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th)\b/i)?.[1]?.toLowerCase();
  const index = ordinal ? ordinals[ordinal] : undefined;
  return index === undefined ? undefined : available[index]?.id;
}

function suggestedActivityDay(trip: TripState, message: string): number {
  const explicit = Number(message.match(/\bday\s*(\d+)\b/i)?.[1]);
  const days = Math.round((Date.parse(`${trip.request.endDate}T12:00:00Z`) - Date.parse(`${trip.request.startDate}T12:00:00Z`)) / 86_400_000) + 1;
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= days) return explicit;
  const counts = new Map<number, number>();
  for (const activity of trip.selectedActivities) {
    const day = Math.round((Date.parse(`${activity.date}T12:00:00Z`) - Date.parse(`${trip.request.startDate}T12:00:00Z`)) / 86_400_000) + 1;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const candidates = Array.from({ length: days }, (_, index) => index + 1)
    .filter((day) => days <= 2 || (day > 1 && day < days));
  return candidates.sort((left, right) => (counts.get(left) ?? 0) - (counts.get(right) ?? 0) || left - right)[0] ?? 1;
}

function contextLabel(locationId: string): string {
  const value = locationId.split(":").at(-1) ?? locationId;
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function requestedTripExtension(message: string): number | undefined {
  const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const match = message.match(
    /\b(?:add|extend|include)(?:\s+the\s+trip)?(?:\s+by)?\s+(?:(\d+|one|two|three|four|five|six|seven)\s+)?(?:more\s+)?days?\b/i,
  );
  if (!match) return undefined;
  const token = match[1]?.toLowerCase();
  const days = token ? (Number(token) || numberWords[token]) : 1;
  return days && days <= 14 ? days : undefined;
}

function activityDayClarification(trip: TripState, message: string): boolean {
  return /\b(?:add|include|schedule|plan)\b.*\bactivit(?:y|ies)\b/i.test(message) &&
    !/\bday\s*\d+\b/i.test(message);
}

function traced<T extends Record<string, unknown>>(
  trace: ConversationTurnTrace,
  outcome: string,
  response: T,
): T & { trace: ReturnType<ConversationTurnTrace["complete"]> } {
  return { ...response, trace: trace.complete(outcome) };
}

/**
 * The single bounded entry point for free-form conversation. It interprets a
 * turn, selects one permitted deterministic executor, and then applies the
 * verified-facts communication pass. Typed UI actions bypass this function.
 */
export async function runConversationTurn(request: ConversationRequest): Promise<Record<string, unknown>> {
  const trace = new ConversationTurnTrace(request.clientTurnId, request.phase);
  const planningConfig = getOpenAIModelConfig("planning");
  const contextConfig = getOpenAIModelConfig("context");
  const conversationalMessage = async (
    fallbackMessage: string,
    intent: "plan_trip" | "modify_trip" | "explain" | "clarify" | "recover",
    facts: string[] = [fallbackMessage],
  ) => generateAssistantMessage(fallbackMessage, {
    intent,
    facts,
    events: [],
    availableActions: [],
  }, trace.traceId);

  try {
    if (request.phase === "draft") {
      trace.routed("natural_intake", !planningConfig);
      trace.executed("runNaturalIntake");
      const result = await runNaturalIntake(
        {
          message: request.message,
          currentRequest: request.currentRequest,
          context: request.context,
        },
        {
          model: planningConfig ? createOpenAINaturalIntakeModel({ ...planningConfig, correlationId: trace.traceId }) : undefined,
        },
      );
      const catalog = await createInventoryRepository().getPlannerCatalog();
      const originSuggestions = catalog.locationGraph
        .filter((location) => location.type === "city" && location.tags?.includes("origin_hub") && location.name)
        .sort((left, right) => left.name!.localeCompare(right.name!))
        .slice(0, 4)
        .map((location) => ({ id: location.id, label: location.name! }));
      const presentation = intakePresentation(result, `intake:${request.clientTurnId}`, originSuggestions);
      const communication = await generateAssistantCommunication({
        intent: "clarify",
        fallbackMessage: presentation.message,
        facts: verifiedDraftFacts(result),
        events: presentation.events,
        availableActions: presentation.actions,
      }, undefined, trace.traceId);
      return traced(trace, "intake", {
        kind: "intake",
        result,
        interaction: applyCommunication(presentation, communication),
      });
    }

    const trip = request.trip as TripState;
    const history = request.context?.history ?? request.conversationHistory;
    const effectiveMessage = contextualizedMessage(request.message, history);
    let intent: CommittedConversationIntent | undefined = request.actionHint;
    let routedActionId: string | undefined;
    let routerDegraded = false;
    if (!intent && planningConfig) {
      try {
        const routed = await createOpenAIConversationRouterModel({ ...planningConfig, correlationId: trace.traceId }).classify({
          message: effectiveMessage,
          trip,
          context: request.context,
        });
        intent = routed.intent;
        routedActionId = routed.actionId ?? undefined;
      } catch {
        routerDegraded = true;
      }
    } else if (!intent) {
      routerDegraded = true;
    }
    const availableActions = request.context?.activeInteraction?.availableActions ?? [];
    if (routedActionId && !availableActions.some((action) => action.id === routedActionId)) {
      routedActionId = undefined;
      routerDegraded = true;
    }
    routedActionId ??= resolvePresentedActionId(effectiveMessage, availableActions);
    if (routedActionId) intent = "select_presented_action";
    intent ??= classifyCommittedConversation(effectiveMessage, trip);
    trace.routed(intent, routerDegraded);

    if (intent === "select_presented_action") {
      const action = request.context?.activeInteraction?.availableActions.find((item) => item.id === routedActionId);
      if (!action) {
        const fallback = "I couldn’t match that choice to the options still on screen. Please choose one of the available options or name it more specifically.";
        return traced(trace, "clarification", {
          kind: "clarification",
          interaction: {
            message: await conversationalMessage(fallback, "clarify"),
            events: [{ id: `${request.clientTurnId}:action:event`, type: "fact_missing" as const, status: "active" as const, label: "A current option is needed" }],
            actions: request.context?.activeInteraction?.availableActions ?? [],
          },
        });
      }
      trace.executed(`guided_action:${action.type}`);
      return traced(trace, "guided_action", { kind: "guided_action", actionId: action.id });
    }

    if (intent === "activity_suggestion") {
      trace.executed("runModification:activity_suggestion");
      const day = suggestedActivityDay(trip, effectiveMessage);
      const themes = /\b(?:food|eat|restaurant|cafe|market)\b/i.test(effectiveMessage) ? " food market" : "";
      const result = await runModification(
        {
          message: `Add 1 activity on day ${day}${themes}. Suggest grounded options and preserve the current itinerary.`,
          trip,
        },
        { model: createDeterministicModificationModel() },
      );
      return traced(trace, "suggestion", {
        kind: "suggestion",
        result: { ...result, message: await conversationalMessage(result.message, "modify_trip") },
      });
    }

    if (intent === "modify_trip" && activityDayClarification(trip, effectiveMessage)) {
      trace.executed("clarify_activity_day");
      const tripDays = Math.round((Date.parse(`${trip.request.endDate}T12:00:00Z`) - Date.parse(`${trip.request.startDate}T12:00:00Z`)) / 86_400_000) + 1;
      const actions = Array.from({ length: tripDays }, (_, index) => {
        const date = addCalendarDays(trip.request.startDate, index);
        return {
          id: `${request.clientTurnId}:activity-day:${date}`,
          type: "select_activity_day" as const,
          date,
          label: `Explore activities on Day ${index + 1}`,
        };
      }).slice(0, 8);
      const fallback = `Sure — which day would you like to add activities to? This trip has ${tripDays} days.`;
      const message = await conversationalMessage(fallback, "clarify", [
        `This trip has ${tripDays} days`,
        "The user wants to add activities but did not specify a day",
      ]);
      return traced(trace, "clarification", {
        kind: "clarification",
        interaction: {
          message,
          events: [{
            id: `${request.clientTurnId}:activity-day:event`,
            type: "fact_missing" as const,
            status: "active" as const,
            label: "Activity day needed",
          }],
          actions,
        },
      });
    }

    const extensionDays = intent === "modify_trip" ? requestedTripExtension(effectiveMessage) : undefined;
    if (extensionDays) {
      trace.executed("update_trip_scope");
      const nextRequest = {
        ...trip.request,
        endDate: addCalendarDays(trip.request.endDate, extensionDays),
      };
      const fallback = `I’ll extend the trip by ${extensionDays} day${extensionDays === 1 ? "" : "s"} and rebuild the connected itinerary.`;
      return traced(trace, "request_update", {
        kind: "request_update",
        request: nextRequest,
        message: await conversationalMessage(fallback, "modify_trip", [
          `The trip end date changes from ${trip.request.endDate} to ${nextRequest.endDate}`,
          "The connected itinerary must be rebuilt and validated",
        ]),
      });
    }

    if (intent === "conversational") {
      trace.executed("conversation_capabilities");
      const fallback = "I can explain any current choice, compare the trip total, or suggest schedule-valid activities near your stay. Ask about a day or an itinerary card whenever you like.";
      return traced(trace, "reply", {
        kind: "reply",
        message: await conversationalMessage(fallback, "explain"),
      });
    }

    if (intent === "travel_context") {
      trace.executed("travel_context");
      const fallback = /\b(?:weather|forecast|temperature|rain)\b/i.test(effectiveMessage)
        ? "I can’t check live weather in this prototype. Please check a current forecast closer to travel; I can still help adjust the itinerary around the conditions you expect."
        : "I can help with itinerary facts and grounded options, but I can’t verify that extra place information right now.";
      if (!contextConfig) return traced(trace, "reply", { kind: "reply", message: fallback });
      try {
        const answer = await createOpenAITravelContextModel({ ...contextConfig, correlationId: trace.traceId }).answer({
          question: effectiveMessage,
          origin: contextLabel(trip.request.origin),
          destination: contextLabel(trip.route.marketId),
          routeStops: trip.route.stops.map((stop) => contextLabel(stop.locationId)),
          startDate: trip.request.startDate,
          endDate: trip.request.endDate,
        });
        return traced(trace, "reply", { kind: "reply", message: answer });
      } catch {
        trace.routed(intent, true);
        return traced(trace, "reply", { kind: "reply", message: fallback });
      }
    }

    if (intent === "unsupported") {
      trace.executed("unsupported_boundary");
      const fallback = "I’m sorry, I can’t help with that request right now. I can help with this trip’s route, travel, stays, activities, schedule, and cost.";
      return traced(trace, "reply", {
        kind: "reply",
        message: await conversationalMessage(fallback, "recover"),
      });
    }

    if (intent === "explain_trip") {
      trace.executed("runExplanation");
      const result = await runExplanation(
        { question: effectiveMessage, trip, selectionId: request.selectionId },
        { model: planningConfig ? createOpenAIExplanationModel({ ...planningConfig, correlationId: trace.traceId }) : undefined },
      );
      return traced(trace, "explanation", { kind: "explanation", result });
    }

    trace.executed("runModification");
    const result = await runModification(
      { message: effectiveMessage, trip, targetDate: request.targetDate },
      { model: planningConfig ? createOpenAIModificationModel({ ...planningConfig, correlationId: trace.traceId }) : undefined },
    );
    return traced(trace, "modification", {
      kind: "modification",
      result: { ...result, message: await conversationalMessage(result.message, "modify_trip") },
    });
  } catch (error) {
    trace.failed(error);
    throw error;
  }
}
