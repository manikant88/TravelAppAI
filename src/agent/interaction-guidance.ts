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

export function intakePresentation(
  result: NaturalIntakeResponse,
  operationId: string,
  originSuggestions: Array<{ id: string; label: string }> = [],
): InteractionPresentation {
  const essentials = [
    { requirement: "origin" as const, field: "origin" as const, label: "Starting city" },
    { requirement: "destination_intent" as const, field: "destination" as const, label: "Destination or recommendations" },
    { requirement: "dates" as const, field: "dates" as const, label: "Travel dates" },
    { requirement: "travellers" as const, field: "travellers" as const, label: "Traveller details" },
  ];
  const missingSet = new Set(result.missingRequired);
  const firstMissing = result.missingRequired[0];
  const events: InteractionEvent[] = essentials.map((item, index) => event(
    operationId,
    index,
    missingSet.has(item.requirement) ? "fact_missing" : "fact_recognized",
    missingSet.has(item.requirement) ? `${item.label} needed` : `${item.label} added`,
    missingSet.has(item.requirement) ? (item.requirement === firstMissing ? "active" : "pending") : "completed",
    item.field,
  ));
  const actions: GuidedAction[] = [];
  let message = result.message;
  const progressiveOpenField = result.request.destination?.kind === "open" ? firstMissing : undefined;

  if (missingSet.has("origin") && (!progressiveOpenField || progressiveOpenField === "origin")) {
    actions.push(...originSuggestions.slice(0, 2).map((location) => ({
      id: `${operationId}:origin:${location.id}`,
      type: "set_location" as const,
      field: "origin" as const,
      locationId: location.id,
      label: location.label,
    })));
  }
  if (missingSet.has("destination_intent") && (!progressiveOpenField || progressiveOpenField === "destination_intent")) {
    actions.push({ id: `${operationId}:destination:open`, type: "set_open_destination", label: "Help me choose" });
  }
  if (missingSet.has("dates") && (!progressiveOpenField || progressiveOpenField === "dates")) {
    actions.push(...result.suggestedDateRanges.map((range) => ({
      id: `${operationId}:dates:${range.id}`,
      type: "set_dates" as const,
      startDate: range.startDate,
      endDate: range.endDate,
      label: range.label,
    }))); 
    if (result.suggestedDateRanges.length === 0) {
      const outsideInventory = result.issues.some((issue) => issue.code === "OUTSIDE_INVENTORY_WINDOW");
      const reason = outsideInventory
        ? "change_window" as const
        : result.request.dateWindow
          ? "missing_duration" as const
          : "missing_window" as const;
      actions.push({
        id: `${operationId}:dates:recommend`,
        type: "request_date_recommendation",
        reason,
        label: reason === "change_window"
          ? "Choose another travel window"
          : result.request.dateWindow
            ? "Recommend dates in this window"
            : "Help me choose dates",
      });
    }
  }
  if (missingSet.has("travellers") && (!progressiveOpenField || progressiveOpenField === "travellers")) {
    actions.push(
      { id: `${operationId}:travellers:solo`, type: "set_travellers", adults: 1, children: 0, seniors: 0, label: "Just me" },
      { id: `${operationId}:travellers:two`, type: "set_travellers", adults: 2, children: 0, seniors: 0, label: "2 adults" },
      { id: `${operationId}:travellers:family`, type: "set_travellers", adults: 2, children: 1, seniors: 0, label: "2 adults + 1 child" },
    );
  }
  if (result.missingRequired.length > 0) {
    const missingLabels = essentials.filter((item) => missingSet.has(item.requirement)).map((item) => item.label.toLocaleLowerCase("en"));
    const firstMissingLabel = essentials.find((item) => item.requirement === firstMissing)?.label.toLocaleLowerCase("en");
    const dateWindowCopy = result.request.dateWindow
      ? ` I’ve kept ${result.request.dateWindow.label}${result.request.dateWindow.durationDays ? ` and the ${result.request.dateWindow.durationDays}-day duration` : ""} as a flexible window rather than inventing exact dates.`
      : "";
    const issueCopy = result.issues[0] ? ` ${result.issues[0].message}` : "";
    message = result.request.destination?.kind === "open"
      ? `Absolutely — we can shape this together without choosing everything up front.${dateWindowCopy}${issueCopy} Let’s start with ${firstMissingLabel ?? missingLabels[0]}; the suggestions are only starting points and you can change them anytime.`
      : `I added the details I could verify.${dateWindowCopy}${issueCopy} To start planning, complete ${missingLabels.join(", ")}. The checklist and highlighted Trip Brief fields will update as you add them.`;
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
    actions: actions.slice(0, 8),
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
