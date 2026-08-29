import type { NaturalIntakeResponse } from "@/agent/natural-intake-contracts";
import type {
  GuidedAction,
  InteractionEvent,
  InteractionPresentation,
  TripField,
} from "@/agent/interaction-contracts";
import type { TripRequest } from "@/domain/model";

function event(
  operationId: string,
  index: number,
  type: InteractionEvent["type"],
  label: string,
  status: InteractionEvent["status"] = "completed",
  field?: TripField,
): InteractionEvent {
  return {
    id: `${operationId}:event:${index}`,
    type,
    label,
    status,
    target: field ? { type: "trip_field", field } : undefined,
  };
}

function fieldLabel(field: NaturalIntakeResponse["appliedFields"][number]): string {
  return ({
    origin: "Starting city",
    destination: "Destination",
    dates: "Travel dates",
    travellers: "Traveller details",
    pace: "Trip pace",
    interests: "Interests",
    constraints: "Budget and constraints",
  })[field];
}

export function intakePresentation(
  result: NaturalIntakeResponse,
  operationId: string,
  originSuggestions: Array<{ id: string; label: string }> = [],
): InteractionPresentation {
  const events: InteractionEvent[] = result.appliedFields.map((field, index) =>
    event(
      operationId,
      index,
      "fact_recognized",
      `${fieldLabel(field)} understood`,
      "completed",
      field === "travellers"
        ? "travellers"
        : field === "constraints"
          ? "budget"
          : field === "pace" || field === "interests"
            ? "preferences"
            : field,
    ),
  );
  const actions: GuidedAction[] = [];
  const nextMissing = result.missingRequired[0];
  let message = result.message;

  if (nextMissing === "origin") {
    events.push(event(operationId, events.length, "fact_missing", "Starting city needed", "active", "origin"));
    message = result.request.destination?.kind === "specified"
      ? "That destination works. Where would you like to begin your journey?"
      : "Where would you like to begin your journey?";
    actions.push(...originSuggestions.slice(0, 4).map((location) => ({
      id: `${operationId}:origin:${location.id}`,
      type: "set_location" as const,
      field: "origin" as const,
      locationId: location.id,
      label: location.label,
    })));
  } else if (nextMissing === "destination_intent") {
    events.push(event(operationId, events.length, "fact_missing", "Destination preference needed", "active", "destination"));
    message = "Do you have a destination in mind, or should I compare places that fit this trip?";
    actions.push({ id: `${operationId}:destination:open`, type: "set_open_destination", label: "Help me choose" });
  } else if (nextMissing === "dates") {
    events.push(event(operationId, events.length, "fact_missing", "Travel dates needed", "active", "dates"));
    message = "When would you like to travel? Here are a few supported date ranges to continue.";
    actions.push(...result.suggestedDateRanges.map((range) => ({
      id: `${operationId}:dates:${range.id}`,
      type: "set_dates" as const,
      startDate: range.startDate,
      endDate: range.endDate,
      label: range.label,
    })));
  } else if (nextMissing === "travellers") {
    events.push(event(operationId, events.length, "fact_missing", "Traveller count needed", "active", "travellers"));
    message = "Who will be travelling?";
    actions.push(
      { id: `${operationId}:travellers:solo`, type: "set_travellers", adults: 1, children: 0, seniors: 0, label: "Just me" },
      { id: `${operationId}:travellers:two`, type: "set_travellers", adults: 2, children: 0, seniors: 0, label: "2 adults" },
      { id: `${operationId}:travellers:family`, type: "set_travellers", adults: 2, children: 1, seniors: 0, label: "2 adults + 1 child" },
    );
  } else if (result.issues.length > 0) {
    const issue = result.issues[0]!;
    message = `${issue.message} You can update that detail and I’ll continue from the rest of your brief.`;
  } else {
    events.push(event(operationId, events.length, "operation_completed", "Trip brief is ready"));
  }

  const active = events.find((item) => item.status === "active");
  return {
    message,
    events,
    actions,
    focus: active?.target ? { operationId, target: active.target, phase: "understanding" } : undefined,
  };
}

export function planningEvents(operationId: string, request: TripRequest): InteractionEvent[] {
  const destination = request.destination?.kind === "open" ? "destinations" : "your route";
  return [
    event(operationId, 0, "inventory_search_started", `Checking travel options for ${destination}`, "active"),
    event(operationId, 1, "inventory_search_started", "Comparing stays against your trip brief", "pending"),
    event(operationId, 2, "inventory_search_started", "Balancing activities across the itinerary", "pending"),
    event(operationId, 3, "trip_validated", "Validating dates, route, and total price", "pending"),
  ];
}

export function completePlanningEvents(events: InteractionEvent[]): InteractionEvent[] {
  return events.map((item) => ({ ...item, status: "completed" as const }));
}

export function recoveryPresentation(
  operationId: string,
  message: string,
  actions: GuidedAction[],
): InteractionPresentation {
  return {
    message,
    events: [event(operationId, 0, "constraint_detected", message, "completed")],
    actions,
  };
}
