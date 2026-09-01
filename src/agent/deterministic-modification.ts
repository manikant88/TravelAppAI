import type { GroundedFact } from "@/agent/contracts";
import type {
  ModificationPlannerModel,
  ModificationSelectionSummary,
  ScopedModificationIntent,
} from "@/agent/modification-contracts";

export class SelectionTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionTargetError";
  }
}

export class NoDeterministicModificationIntentError extends Error {
  constructor() {
    super("No high-confidence deterministic modification intent was found");
    this.name = "NoDeterministicModificationIntentError";
  }
}

function totalPrice(facts: GroundedFact[]): number {
  const value = facts.find((fact) => fact.dimension === "total_price")?.value;
  return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
}

function targetKind(message: string): ModificationSelectionSummary["kind"] | undefined {
  if (/\b(?:hotel|stay|room|accommodation)\b/i.test(message)) return "stay";
  if (/\b(?:flight|train|bus|travel|transport|transfer)\b/i.test(message)) return "travel";
  if (/\b(?:activit(?:y|ies)|experience|tour|sightseeing)\b/i.test(message)) return "activity";
  return undefined;
}

function dateForDay(trip: Parameters<ModificationPlannerModel["interpretModification"]>[0]["trip"], dayNumber: number): string | undefined {
  if (!Number.isInteger(dayNumber) || dayNumber < 1) return undefined;
  const date = new Date(`${trip.request.startDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  const value = date.toISOString().slice(0, 10);
  return value <= trip.request.endDate ? value : undefined;
}

function selectionMatchesDate(selection: ModificationSelectionSummary, date: string): boolean {
  if (!selection.startDate) return false;
  if (selection.kind === "stay" && selection.endDate) {
    return selection.startDate <= date && date < selection.endDate;
  }
  return selection.startDate === date;
}

function selectTarget(
  input: Parameters<ModificationPlannerModel["interpretModification"]>[0],
  kind: ModificationSelectionSummary["kind"] | undefined,
): ModificationSelectionSummary {
  const message = input.message.toLocaleLowerCase("en");
  const explicitlyNamed = input.selections.filter((selection) =>
    message.includes(selection.label.toLocaleLowerCase("en")),
  );
  if (explicitlyNamed.length === 1) return explicitlyNamed[0]!;

  let candidates = kind
    ? input.selections.filter((selection) => selection.kind === kind)
    : [...input.selections];
  const dayMatch = message.match(/\bday\s*(\d{1,2})\b/i);
  if (dayMatch) {
    const targetDate = dateForDay(input.trip, Number(dayMatch[1]));
    if (!targetDate) throw new SelectionTargetError("That day is outside the current trip. Please choose a day shown in the itinerary.");
    candidates = candidates.filter((selection) => selectionMatchesDate(selection, targetDate));
  }

  const dateMatch = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) {
    candidates = candidates.filter((selection) => selectionMatchesDate(selection, dateMatch[1]!));
  }

  const mobilityMatch = message.match(/\b(low|medium|high)\s+mobility\b/i);
  if (mobilityMatch) {
    candidates = candidates.filter((selection) => selection.mobility === mobilityMatch[1]!.toLocaleLowerCase("en"));
  }

  const requestedRole = /\b(?:return|inbound)\b/i.test(message)
    ? "return"
    : /\b(?:outbound|departure|departing)\b/i.test(message)
      ? "outbound"
      : /\b(?:transfer|connection|connecting)\b/i.test(message)
        ? "connecting"
        : undefined;
  if (requestedRole) candidates = candidates.filter((selection) => selection.role === requestedRole);

  const termMatches = candidates.filter((selection) =>
    selection.searchTerms?.some((term) => term.length >= 3 && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(message)),
  );
  if (termMatches.length > 0 && termMatches.length < candidates.length) candidates = termMatches;

  if (candidates.length !== 1) {
    const noun = kind ?? "itinerary item";
    throw new SelectionTargetError(candidates.length === 0
      ? `I couldn't find a selected ${noun} matching all of those details. Please check the day, date, route, mobility, or card name.`
      : `More than one ${noun} matches that request. Please include its day, date, route, mobility, or exact card name.`);
  }
  return candidates[0]!;
}

function activityAdditionIntent(
  input: Parameters<ModificationPlannerModel["interpretModification"]>[0],
): ScopedModificationIntent | undefined {
  if (!/\bactivit(?:y|ies)\b/i.test(input.message)) return undefined;
  if (!/\b(?:add|include|schedule|plan|update|fill)\b/i.test(input.message)) return undefined;
  const dayMatch = input.message.match(/\bday\s*(\d{1,2})\b/i);
  if (!dayMatch) return undefined;
  const targetDate = dateForDay(input.trip, Number(dayMatch[1]));
  if (!targetDate) return undefined;
  const countMatch = input.message.match(/\b(1|2|3|one|two|three)\s+activit(?:y|ies)\b/i);
  const countToken = countMatch?.[1]?.toLocaleLowerCase("en");
  const count = countToken === "one" ? 1 : countToken === "two" ? 2 : countToken === "three" ? 3 : Number(countToken ?? 1);
  const preferredThemes = input.supportedThemes.filter((theme) =>
    new RegExp(`\\b${theme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(input.message),
  );
  return {
    action: "add",
    targetDate,
    count,
    replaceDayActivities: /\b(?:update|replace|make)\s+day\b/i.test(input.message) || /\bday\s*\d+\s+with\b/i.test(input.message),
    unlockTarget: false,
    preserveSelectionIds: input.selections.map((selection) => selection.selectionId),
    preferredThemes,
    goal: input.message,
  };
}

function budgetIntent(message: string, selections: ModificationSelectionSummary[]): ScopedModificationIntent | undefined {
  const amountMatch = message.match(
    /(?:budget(?:\s+to)?|under|below|within(?:\s+a)?(?:\s+budget\s+of)?|max(?:imum)?|(?:make|keep)\s+(?:the\s+|my\s+|this\s+)?trip\s+(?:possible|affordable)\s+(?:in|within|for))\s*(?:₹\s*|inr\s*)?([\d,]+)/i,
  );
  if (!amountMatch) return undefined;
  const amount = Number(amountMatch[1]!.replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return {
    action: "upsert_constraint",
    constraint: {
      category: "budget",
      priority: "hard",
      targetTotal: null,
      maxTotal: Math.round(amount),
    },
    preserveSelectionIds: selections.map((selection) => selection.selectionId),
    preferredThemes: [],
    goal: message,
  };
}

function hasHighConfidenceSelectionIntent(
  input: Parameters<ModificationPlannerModel["interpretModification"]>[0],
  kind: ModificationSelectionSummary["kind"] | undefined,
): boolean {
  const message = input.message.toLocaleLowerCase("en");
  const namesSelection = input.selections.some((selection) =>
    message.includes(selection.label.toLocaleLowerCase("en")),
  );
  const requestsChange = /\b(?:remove|delete|drop|replace|change|swap|find|make|use|choose|unlock|cheaper|later|earlier|quieter|faster|shorter|better)\b/i.test(message);
  const hasSelector = /\bday\s*\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:low|medium|high)\s+mobility\b|\b(?:return|inbound|outbound|departure|departing|transfer|connection|connecting)\b/i.test(message);
  return requestsChange && (namesSelection || Boolean(kind) || hasSelector);
}

function deterministicIntent(input: Parameters<ModificationPlannerModel["interpretModification"]>[0]): ScopedModificationIntent {
  const budget = budgetIntent(input.message, input.selections);
  if (budget) return budget;

  const activityAddition = activityAdditionIntent(input);
  if (activityAddition) return activityAddition;

  const kind = targetKind(input.message);
  if (!hasHighConfidenceSelectionIntent(input, kind)) {
    throw new NoDeterministicModificationIntentError();
  }
  const target = selectTarget(input, kind);

  const action = /\b(?:remove|delete|drop)\b/i.test(input.message) && target.kind === "activity"
    ? "remove" as const
    : "replace" as const;
  const preferredThemes = input.supportedThemes.filter((theme) =>
    new RegExp(`\\b${theme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(input.message),
  );
  return {
    action,
    targetSelectionId: target.selectionId,
    unlockTarget: /\bunlock\b/i.test(input.message),
    preserveSelectionIds: input.selections
      .filter((selection) => selection.selectionId !== target.selectionId)
      .map((selection) => selection.selectionId),
    preferredThemes,
    goal: input.message,
  };
}

export function createDeterministicModificationModel(): ModificationPlannerModel {
  return {
    async interpretModification(input) {
      return deterministicIntent(input);
    },
    async recommendModification(input) {
      const chosen = [...input.candidates].sort(
        (left, right) =>
          totalPrice(left.facts) - totalPrice(right.facts) ||
          left.candidateId.localeCompare(right.candidateId, "en"),
      )[0];
      if (!chosen) throw new Error("No valid modification candidates");
      const supportingFact = chosen.facts.find((fact) => fact.dimension === "total_price") ?? chosen.facts[0];
      return {
        candidateId: chosen.candidateId,
        supportingFactIds: [supportingFact!.id],
        comparisonDimensions: ["price"],
      };
    },
  };
}

export async function interpretModificationIntentHybrid(
  input: Parameters<ModificationPlannerModel["interpretModification"]>[0],
  semanticModel?: ModificationPlannerModel,
): Promise<ScopedModificationIntent> {
  try {
    return await createDeterministicModificationModel().interpretModification(input);
  } catch (error: unknown) {
    if (!(error instanceof NoDeterministicModificationIntentError)) throw error;
    if (!semanticModel) throw error;
    return semanticModel.interpretModification(input);
  }
}
