import type { NaturalTripIntent, NaturalIntakeResponse } from "@/agent/natural-intake-contracts";
import {
  constraintDraftFromNatural,
  naturalIntakeRequestSchema,
  naturalIntakeResponseSchema,
  naturalTripIntentSchema,
} from "@/agent/natural-intake-contracts";
import type { ConstraintDraft, RequestPatch, TripRequest } from "@/domain/model";
import {
  applyConstraintPatch,
  canonicalizeTripRequest,
  checkRequirements,
} from "@/domain/request";
import { addCalendarDays } from "@/domain/dates";
import {
  createInventoryRepository,
  type ActiveLocationNode,
} from "@/inventory/repository";
import { normalizeLocationQuery, searchLocations } from "@/inventory/service";

export interface NaturalIntakeModel {
  extractTripIntent(input: {
    message: string;
    currentRequest: TripRequest;
    today: string;
    inventoryWindow: { from: string; until: string };
  }): Promise<NaturalTripIntent>;
}

export interface NaturalIntakeDependencies {
  model?: NaturalIntakeModel;
  repository?: ReturnType<typeof createInventoryRepository>;
  today?: () => string;
}

export class NaturalIntakeError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "MODEL_FAILURE" | "INVENTORY_FAILURE",
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function marketForLocation(
  locationId: string,
  graph: ActiveLocationNode[],
  marketIds: Set<string>,
): string | undefined {
  const nodes = new Map(graph.map((node) => [node.id, node]));
  let current = nodes.get(locationId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (marketIds.has(current.id)) return current.id;
    visited.add(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }

  // A user will commonly name a country (for example "Thailand") while the
  // plannable unit is a child region ("Thailand — Phuket & Krabi"). Resolve a
  // unique descendant market deterministically instead of asking the model to
  // reproduce an internal market id.
  const descendantMarkets = graph.filter((node) => {
    if (!marketIds.has(node.id)) return false;
    let ancestor = node.parentId ? nodes.get(node.parentId) : undefined;
    const ancestorIds = new Set<string>();
    while (ancestor && !ancestorIds.has(ancestor.id)) {
      if (ancestor.id === locationId) return true;
      ancestorIds.add(ancestor.id);
      ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : undefined;
    }
    return false;
  });
  if (descendantMarkets.length === 1) return descendantMarkets[0]!.id;
  return undefined;
}

function marketLabel(marketId: string, graph: ActiveLocationNode[]): string {
  return graph.find((node) => node.id === marketId)?.name ?? marketId;
}

function constraintDrafts(intent: NaturalTripIntent): ConstraintDraft[] {
  return intent.constraints.map(constraintDraftFromNatural);
}

function travellersFor(intent: NaturalTripIntent): TripRequest["travellers"] | undefined {
  if (intent.travellerGroups.length === 0) return undefined;
  let index = 0;
  return intent.travellerGroups.flatMap((group) =>
    Array.from({ length: group.count }, () => {
      index += 1;
      return {
        id: `traveller:${index}`,
        type: group.type,
        mobility: group.mobility ?? undefined,
      };
    }),
  );
}

function explicitTravellers(message: string): TripRequest["travellers"] | undefined {
  const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const countToken = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const totalMatch = message.match(new RegExp(`\\b(?:for\\s+)?${countToken}\\s+(?:people|persons|travellers|travelers|guests|friends)\\b`, "i"));
  const adultMatch = message.match(new RegExp(`\\b${countToken}\\s+adults?\\b`, "i"));
  if (!totalMatch && !adultMatch) return undefined;
  const countValue = (value: string): number => Number.isNaN(Number(value)) ? numberWords[value.toLocaleLowerCase("en")]! : Number(value);
  const total = totalMatch ? countValue(totalMatch[1]!) : countValue(adultMatch![1]!);
  if (!totalMatch && adultMatch) {
    const childMatch = message.match(new RegExp(`\\b${countToken}\\s+(?:children|kids|child)\\b`, "i"));
    const seniorMatch = message.match(new RegExp(`\\b${countToken}\\s+seniors?\\b`, "i"));
    const children = childMatch ? countValue(childMatch[1]!) : 0;
    const seniors = seniorMatch ? countValue(seniorMatch[1]!) : 0;
    if (total + children + seniors > 20) return undefined;
    return [
      ...Array.from({ length: total }, (_, index) => ({ id: `traveller:${index + 1}`, type: "adult" as const })),
      ...Array.from({ length: children }, (_, index) => ({ id: `traveller:${total + index + 1}`, type: "child" as const })),
      ...Array.from({ length: seniors }, (_, index) => ({ id: `traveller:${total + children + index + 1}`, type: "senior" as const })),
    ];
  }
  if (total < 1 || total > 20) return undefined;
  const childCountMatch = message.match(/\b(\d{1,2})\s+(?:children|kids)\b/i);
  const singularChild = /\b(?:a|one|my)\s+\d{1,2}(?:-year-old|\s+year\s+old)\b/i.test(message);
  const childCount = Math.min(total, childCountMatch ? Number(childCountMatch[1]) : singularChild ? 1 : 0);
  return Array.from({ length: total }, (_, index) => ({
    id: `traveller:${index + 1}`,
    type: index < total - childCount ? "adult" as const : "child" as const,
  }));
}

const monthNumbers: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

function parseExplicitDate(value: string, today: string): string | undefined {
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = value.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+(january|February|march|april|may|june|july|august|september|october|november|december)(?:[\s,]+(20\d{2}))?\b/i);
  if (!long) return undefined;
  const year = long[3] ?? today.slice(0, 4);
  return `${year}-${monthNumbers[long[2]!.toLocaleLowerCase("en")]}-${long[1]!.padStart(2, "0")}`;
}

function explicitDateRange(message: string, today: string): { startDate: string; endDate: string } | undefined {
  const values = [...message.matchAll(/\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:january|February|march|april|may|june|july|august|september|october|november|december)(?:[\s,]+20\d{2})?)\b/gi)].map((match) => parseExplicitDate(match[0]!, today)).filter((value): value is string => Boolean(value));
  if (values.length >= 2) return { startDate: values[0]!, endDate: values[1]! };
  const relativeDates = relativeDateRange(message, today);
  const start = values[0] ?? relativeDates?.startDate;
  const nights = explicitNightCount(message);
  if (start && nights) return { startDate: start, endDate: addCalendarDays(start, nights) };
  const days = explicitDayCount(message);
  if (start && days) return { startDate: start, endDate: addCalendarDays(start, days - 1) };
  return relativeDates;
}

function explicitBudget(message: string): number | undefined {
  const match = message.match(/(?:under|below|within|max(?:imum)?|budget(?:\s+of)?)\s*(?:₹|inr\s*)?([\d,]+(?:\.\d+)?)\s*(k|l| lakh| lakhs)?\b/i)
    ?? message.match(/(?:₹|inr\s*)([\d,]+(?:\.\d+)?)\s*(k|l| lakh| lakhs)?\b/i);
  if (!match) return undefined;
  const amount = Number(match[1]!.replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const suffix = match[2]?.trim().toLocaleLowerCase("en");
  return Math.round(amount * (suffix === "k" ? 1_000 : suffix?.startsWith("l") ? 100_000 : 1));
}

function explicitLocationQuery(message: string, kind: "origin" | "destination"): string | undefined {
  const pattern = kind === "origin"
    ? /\b(?:from|leaving from|departing from|starting from)\s+([a-z][a-z\s-]*?)(?=\s+(?:to|for|on|starting|between|under|with|and|this|upcoming|next)\b|[,.]|$)/i
    : /\b(?:to|in|visit(?:ing)?)\s+([a-z][a-z\s-]*?)(?=\s+(?:from|for|on|starting|between|under|with|and|this|upcoming|next)\b|[,.]|$)/i;
  return pattern.exec(message)?.[1]?.trim();
}

async function deterministicIntent(
  message: string,
  currentRequest: TripRequest,
  catalog: Awaited<ReturnType<ReturnType<typeof createInventoryRepository>["getPlannerCatalog"]>>,
  repository: ReturnType<typeof createInventoryRepository>,
  today: string,
): Promise<{ intent: NaturalTripIntent; complete: boolean }> {
  const originQuery = explicitLocationQuery(message, "origin");
  const destinationQuery = explicitLocationQuery(message, "destination");
  const asksForRecommendations = /\b(?:recommend|suggest|help me choose|open to|anywhere|somewhere|flexible destination|destination flexible)\b/i.test(message);
  const dateRange = explicitDateRange(message, today);
  const travellers = explicitTravellers(message);
  const budget = explicitBudget(message);
  const paceMatch = /\b(relaxed|relaxing|balanced|packed)\b/i.exec(message)?.[1]?.toLocaleLowerCase("en");
  const pace = paceMatch === "relaxing" ? "relaxed" : paceMatch as NaturalTripIntent["pace"] ?? null;
  const supportedThemes = new Set(catalog.supportedThemes.map((theme) => theme.toLocaleLowerCase("en")));
  const interests = [...supportedThemes].filter(
    (theme) => theme !== "budget" && new RegExp(`\\b${theme.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(message),
  );
  const origin = originQuery
    ? (await searchLocations({ q: originQuery }, repository)).results[0]
    : currentRequest.origin ? { id: currentRequest.origin } : undefined;
  const destination = destinationQuery
    ? (await searchLocations({ q: destinationQuery }, repository)).results[0]
    : currentRequest.destination;
  const destinationIntent: NaturalTripIntent["destination"] = asksForRecommendations
    ? { kind: "open" as const }
    : destinationQuery
      ? { kind: "specified" as const, query: destinationQuery }
      : destination && "kind" in destination && destination.kind === "specified"
        ? { kind: "specified" as const, query: destination.locationId }
        : null;
  const startDate = dateRange?.startDate ?? currentRequest.startDate;
  const endDate = dateRange?.endDate ?? currentRequest.endDate;
  const resolvedTravellers = travellers ?? currentRequest.travellers;
  const intent: NaturalTripIntent = {
    originQuery: originQuery ?? null,
    destination: destinationIntent,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    travellerGroups: resolvedTravellers.length > 0
      ? (["adult", "child", "senior"] as const).flatMap((type) => {
          const count = resolvedTravellers.filter((traveller) => traveller.type === type).length;
          return count > 0 ? [{ type, count, mobility: null }] : [];
        })
      : [],
    pace,
    interests,
    constraints: budget ? [{ category: "budget", priority: "hard", targetTotal: null, maxTotal: budget }] : [],
  };
  return {
    intent,
    complete: Boolean(
      origin && destinationIntent && startDate && endDate && resolvedTravellers.length > 0 &&
      (!originQuery || origin.id) && (!destinationQuery || destination),
    ),
  };
}

function mergeIntent(
  inferred: NaturalTripIntent,
  explicit: NaturalTripIntent,
): NaturalTripIntent {
  return {
    originQuery: explicit.originQuery ?? inferred.originQuery,
    destination: explicit.destination ?? inferred.destination,
    startDate: explicit.startDate ?? inferred.startDate,
    endDate: explicit.endDate ?? inferred.endDate,
    travellerGroups: explicit.travellerGroups.length > 0
      ? explicit.travellerGroups
      : inferred.travellerGroups,
    pace: explicit.pace ?? inferred.pace,
    interests: explicit.interests.length > 0 ? explicit.interests : inferred.interests,
    constraints: explicit.constraints.length > 0 ? explicit.constraints : inferred.constraints,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function relativeDateRange(
  message: string,
  today: string,
): { startDate: string; endDate: string } | undefined {
  const date = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;

  const weekend = /\b(?:this|upcoming)\s+weekend\b/i.test(message);
  const weekdayMatch = message.match(/\b(this|upcoming|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (!weekend && !weekdayMatch) return undefined;

  const weekdayNumbers: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const targetDay = weekend ? 6 : weekdayNumbers[weekdayMatch![2]!.toLocaleLowerCase("en")]!;
  let daysUntilStart = (targetDay - date.getUTCDay() + 7) % 7;
  if (weekdayMatch?.[1]?.toLocaleLowerCase("en") === "next" && daysUntilStart === 0) {
    daysUntilStart = 7;
  }
  date.setUTCDate(date.getUTCDate() + daysUntilStart);

  const durationDays = explicitDayCount(message) ?? (weekend ? 3 : undefined);
  if (!durationDays) return undefined;
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + durationDays - 1);
  return { startDate: isoDate(date), endDate: isoDate(end) };
}

function explicitNightCount(message: string): number | undefined {
  const match = message.match(/\b(\d{1,2})\s*nights?\b/i);
  if (!match) return undefined;
  const nights = Number(match[1]);
  return nights >= 1 && nights <= 20 ? nights : undefined;
}

function explicitDayCount(message: string): number | undefined {
  const match = message.match(/\b(\d{1,2})\s*(?:-\s*)?days?\b/i);
  if (!match) return undefined;
  const days = Number(match[1]);
  return days >= 2 && days <= 21 ? days : undefined;
}

function suggestedDateRanges(message: string, today: string, supportedFrom: string, supportedUntil: string) {
  const match = message.match(/\b(\d{1,2})\s*days?\b/i);
  if (!match) return [];
  const durationDays = Number(match[1]);
  if (durationDays < 2 || durationDays > 21) return [];
  const base = new Date(`${today}T12:00:00Z`);
  const candidates = [
    { id: "dates:tomorrow", label: `Tomorrow · ${durationDays} days`, offset: 1 },
    { id: "dates:next-week", label: `Next week · ${durationDays} days`, offset: 7 },
    { id: "dates:following-week", label: `Following week · ${durationDays} days`, offset: 14 },
  ];
  return candidates.flatMap(({ id, label, offset }) => {
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() + offset);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + durationDays - 1);
    const startDate = isoDate(start);
    const endDate = isoDate(end);
    return startDate >= supportedFrom && endDate <= supportedUntil ? [{ id, label, startDate, endDate }] : [];
  });
}

function deterministicMessage(
  appliedFields: NaturalIntakeResponse["appliedFields"],
  missingRequired: NaturalIntakeResponse["missingRequired"],
  issues: NaturalIntakeResponse["issues"],
): string {
  if (appliedFields.length === 0) {
    const issue = issues[0]?.message;
    return issue
      ? `I couldn’t safely add that detail. ${issue}`
      : "I couldn’t safely add anything to the trip brief. Add the missing essentials or describe them more explicitly.";
  }
  if (missingRequired.length > 0 || issues.length > 0) {
    const issueFields = new Set<string>(issues.map((issue) => issue.field));
    const missing = missingRequired
      .filter((item) => !issueFields.has(item === "destination_intent" ? "destination" : item))
      .map((item) => item.replace("_intent", "").replaceAll("_", " "));
    const nextStep = [
      missing.length > 0 ? `Please add ${missing.join(", ")}.` : undefined,
      issues[0]?.message,
    ].filter(Boolean).join(" ");
    return `I updated the details I could verify. ${nextStep}`;
  }
  return "I converted your message into a complete grounded trip brief. I’m building the validated itinerary now.";
}

export async function runNaturalIntake(
  rawRequest: unknown,
  dependencies: NaturalIntakeDependencies,
): Promise<NaturalIntakeResponse> {
  const parsed = naturalIntakeRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    throw new NaturalIntakeError(
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "Invalid natural-language trip brief",
      400,
      false,
    );
  }

  const repository = dependencies.repository ?? createInventoryRepository();
  let catalog: Awaited<ReturnType<typeof repository.getPlannerCatalog>>;
  let meta: Awaited<ReturnType<typeof repository.getInventoryMeta>>;
  try {
    [catalog, meta] = await Promise.all([
      repository.getPlannerCatalog(),
      repository.getInventoryMeta(),
    ]);
  } catch {
    throw new NaturalIntakeError(
      "INVENTORY_FAILURE",
      "Travel inventory is temporarily unavailable",
      503,
      true,
    );
  }

  const today = dependencies.today?.() ?? new Date().toISOString().slice(0, 10);
  let intent: NaturalTripIntent;
  let deterministic: Awaited<ReturnType<typeof deterministicIntent>>;
  try {
    deterministic = await deterministicIntent(
      parsed.data.message,
      parsed.data.currentRequest,
      catalog,
      repository,
      today,
    );
  } catch {
    deterministic = {
      intent: {
        originQuery: null,
        destination: null,
        startDate: null,
        endDate: null,
        travellerGroups: [],
        pace: null,
        interests: [],
        constraints: [],
      },
      complete: false,
    };
  }
  if (deterministic.complete || !dependencies.model) {
    intent = deterministic.intent;
  } else {
    try {
      const inferred = naturalTripIntentSchema.parse(
        await dependencies.model.extractTripIntent({
          message: parsed.data.message,
          currentRequest: parsed.data.currentRequest,
          today,
          inventoryWindow: { from: meta.supportedFrom, until: meta.supportedUntil },
        }),
      );
      // Explicitly parsed facts always win. The model only fills ambiguity and
      // missing semantics; it cannot overwrite dates, people, budget, or named
      // locations that code already recognized.
      intent = mergeIntent(inferred, deterministic.intent);
    } catch {
      intent = deterministic.intent;
    }
  }

  const issues: NaturalIntakeResponse["issues"] = [];
  const patch: RequestPatch = {};
  const resolvedLocations: NaturalIntakeResponse["resolvedLocations"] = {};
  const appliedFields: NaturalIntakeResponse["appliedFields"] = [];

  if (intent.originQuery) {
    try {
      const result = await searchLocations({ q: intent.originQuery }, repository);
      const origin = result.results[0];
      if (origin) {
        patch.origin = origin.id;
        resolvedLocations.origin = { id: origin.id, label: origin.name };
        appliedFields.push("origin");
      } else {
        issues.push({
          code: "UNSUPPORTED_ORIGIN",
          field: "origin",
          message: `“${intent.originQuery}” is not a supported origin location.`,
        });
      }
    } catch {
      throw new NaturalIntakeError(
        "INVENTORY_FAILURE",
        "Travel inventory is temporarily unavailable",
        503,
        true,
      );
    }
  }

  if (intent.destination?.kind === "open") {
    patch.destination = { kind: "open" };
    resolvedLocations.destination = { id: "destination:open", label: "Open to recommendations" };
    appliedFields.push("destination");
  } else if (intent.destination?.kind === "specified") {
    try {
      const result = await searchLocations({ q: intent.destination.query }, repository);
      const location = result.results[0];
      const marketId = location
        ? marketForLocation(location.id, catalog.locationGraph, new Set(catalog.marketIds))
        : undefined;
      if (location && marketId) {
        patch.destination = { kind: "specified", locationId: marketId };
        resolvedLocations.destination = { id: marketId, label: marketLabel(marketId, catalog.locationGraph) };
        appliedFields.push("destination");
      } else {
        issues.push({
          code: "UNSUPPORTED_DESTINATION",
          field: "destination",
          message: `“${intent.destination.query}” does not resolve to a supported destination market.`,
        });
      }
    } catch {
      throw new NaturalIntakeError(
        "INVENTORY_FAILURE",
        "Travel inventory is temporarily unavailable",
        503,
        true,
      );
    }
  }

  const relativeDates = relativeDateRange(parsed.data.message, today);
  const extractedStartDate = intent.startDate ?? relativeDates?.startDate ?? null;
  const nightCount = explicitNightCount(parsed.data.message);
  const dayCount = explicitDayCount(parsed.data.message);
  const derivedEndDate = nightCount && (extractedStartDate ?? parsed.data.currentRequest.startDate)
    ? addCalendarDays((extractedStartDate ?? parsed.data.currentRequest.startDate)!, nightCount)
    : dayCount && (extractedStartDate ?? parsed.data.currentRequest.startDate)
      ? addCalendarDays((extractedStartDate ?? parsed.data.currentRequest.startDate)!, dayCount - 1)
    : null;
  const extractedEndDate = intent.endDate ?? relativeDates?.endDate ?? derivedEndDate ?? null;
  if (extractedStartDate || extractedEndDate) {
    const proposedStart = extractedStartDate ?? parsed.data.currentRequest.startDate;
    const proposedEnd = extractedEndDate ?? parsed.data.currentRequest.endDate;
    const explicitDateOutsideWindow =
      (extractedStartDate !== null &&
        (extractedStartDate < meta.supportedFrom || extractedStartDate > meta.supportedUntil)) ||
      (extractedEndDate !== null &&
        (extractedEndDate < meta.supportedFrom || extractedEndDate > meta.supportedUntil));
    if (explicitDateOutsideWindow) {
      issues.push({
        code: "OUTSIDE_INVENTORY_WINDOW",
        field: "dates",
        message: relativeDates
          ? `The upcoming weekend (${relativeDates.startDate} to ${relativeDates.endDate}) is outside the seeded inventory window. Choose dates between ${meta.supportedFrom} and ${meta.supportedUntil}.`
          : `Dates must be between ${meta.supportedFrom} and ${meta.supportedUntil}.`,
      });
    } else if (proposedStart && proposedEnd && proposedEnd <= proposedStart) {
      issues.push({
        code: "INVALID_DATE_RANGE",
        field: "dates",
        message: "The trip end date must be after the start date.",
      });
    } else {
      if (extractedStartDate) patch.startDate = extractedStartDate;
      if (extractedEndDate) patch.endDate = extractedEndDate;
      appliedFields.push("dates");
    }
  }

  const travellers = explicitTravellers(parsed.data.message) ?? travellersFor(intent);
  if (travellers) {
    patch.travellerHints = travellers.map(({ type, mobility }) => ({ type, mobility }));
    appliedFields.push("travellers");
  }
  if (intent.pace) {
    patch.pace = intent.pace;
    appliedFields.push("pace");
  }
  if (intent.interests.length > 0) {
    patch.interests = intent.interests;
    appliedFields.push("interests");
  }
  if (intent.constraints.length > 0) {
    patch.upsertConstraints = constraintDrafts(intent);
    appliedFields.push("constraints");
  }

  let next: TripRequest = {
    ...parsed.data.currentRequest,
    origin: patch.origin ?? parsed.data.currentRequest.origin,
    destination: patch.destination ?? parsed.data.currentRequest.destination,
    startDate: patch.startDate ?? parsed.data.currentRequest.startDate,
    endDate: patch.endDate ?? parsed.data.currentRequest.endDate,
    travellers: travellers ?? parsed.data.currentRequest.travellers,
    preferences: {
      ...parsed.data.currentRequest.preferences,
      pace: patch.pace ?? parsed.data.currentRequest.preferences.pace,
      interests: patch.interests ?? parsed.data.currentRequest.preferences.interests,
    },
  };
  next = applyConstraintPatch(
    canonicalizeTripRequest(next),
    patch,
    (draft) => `constraint:intake:${normalizeLocationQuery(draft.category)}`,
  );
  const missingRequired = checkRequirements(next).missingRequired;
  const dateSuggestions = next.startDate && next.endDate
    ? []
    : suggestedDateRanges(parsed.data.message, today, meta.supportedFrom, meta.supportedUntil);

  return naturalIntakeResponseSchema.parse({
    request: next,
    resolvedLocations,
    appliedFields: [...new Set(appliedFields)],
    missingRequired,
    suggestedDateRanges: dateSuggestions,
    issues,
    message: deterministicMessage(appliedFields, missingRequired, issues),
  }) as NaturalIntakeResponse;
}
