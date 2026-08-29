import type { GroundedFact } from "@/agent/contracts";
import type {
  ModificationPlannerModel,
  ModificationSelectionSummary,
  ScopedModificationIntent,
} from "@/agent/modification-contracts";

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
  const amountMatch = message.match(/(?:budget(?:\s+to)?|under|below|max(?:imum)?)\s*(?:₹|inr\s*)?([\d,]+)/i);
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

function deterministicIntent(input: Parameters<ModificationPlannerModel["interpretModification"]>[0]): ScopedModificationIntent {
  const budget = budgetIntent(input.message, input.selections);
  if (budget) return budget;

  const activityAddition = activityAdditionIntent(input);
  if (activityAddition) return activityAddition;

  const kind = targetKind(input.message);
  const explicitlyNamed = input.selections.find((selection) =>
    input.message.toLocaleLowerCase("en").includes(selection.label.toLocaleLowerCase("en")),
  );
  const target = explicitlyNamed ?? (kind
    ? input.selections.find((selection) => selection.kind === kind)
    : undefined);
  if (!target) throw new Error("The requested selection is ambiguous");

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
