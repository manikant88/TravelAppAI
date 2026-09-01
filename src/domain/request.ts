import { z } from "zod";
import { isValidISODate } from "@/domain/dates";
import type {
  Constraint,
  ConstraintDraft,
  MissingRequirement,
  PlannableTripRequest,
  RequestPatch,
  RequirementCheck,
  TripRequest,
} from "@/domain/model";

const travelModes = ["flight", "train", "bus", "ferry"] as const;
const constraintPriorities = ["hard", "strong", "flexible"] as const;
const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected local time in HH:mm format");
export const isoDateSchema = z.string().refine(isValidISODate, "Expected a valid date in YYYY-MM-DD format");
export const moneySchema = z
  .object({ amount: z.number().int().nonnegative(), currency: z.literal("INR") })
  .strict();

export const travellerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    type: z.enum(["adult", "child", "senior"]),
    age: z.number().int().nonnegative().max(120).optional(),
    mobility: z.enum(["standard", "limited"]).optional(),
  })
  .strict();

const constraintBaseSchema = z.object({
  id: z.string().min(1),
  priority: z.enum(constraintPriorities),
  travellerIds: z.array(z.string().min(1)).optional(),
});

function nonEmptyValue<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict().refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Constraint value must define at least one field",
  });
}

export const constraintSchema = z.discriminatedUnion("category", [
  constraintBaseSchema
    .extend({
      category: z.literal("budget"),
      value: nonEmptyValue({ targetTotal: moneySchema.optional(), maxTotal: moneySchema.optional() }).superRefine(
        (value, context) => {
          if (value.targetTotal && value.maxTotal && value.targetTotal.amount > value.maxTotal.amount) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Budget target must not exceed budget maximum",
              path: ["targetTotal"],
            });
          }
        },
      ),
    })
    .strict(),
  constraintBaseSchema
    .extend({
      category: z.literal("travel"),
      value: nonEmptyValue({
        earliestDeparture: localTimeSchema.optional(),
        latestArrival: localTimeSchema.optional(),
        allowedModes: z.array(z.enum(travelModes)).min(1).optional(),
        maxStops: z.number().int().nonnegative().optional(),
      }),
    })
    .strict(),
  constraintBaseSchema
    .extend({
      category: z.literal("stay"),
      value: nonEmptyValue({
        maxNightlyPrice: moneySchema.optional(),
        requiredAmenities: z.array(z.string().trim().min(1)).min(1).optional(),
        seniorFriendly: z.boolean().optional(),
        requiredRooms: z.number().int().positive().optional(),
      }),
    })
    .strict(),
  constraintBaseSchema
    .extend({
      category: z.literal("activity"),
      value: nonEmptyValue({
        maxMobility: z.enum(["low", "medium", "high"]).optional(),
        childFriendly: z.boolean().optional(),
        seniorFriendly: z.boolean().optional(),
      }),
    })
    .strict(),
  constraintBaseSchema
    .extend({
      category: z.literal("schedule"),
      value: nonEmptyValue({ maxActiveMinutesPerDay: z.number().int().positive().optional() }),
    })
    .strict(),
]);

const [budgetConstraintSchema, travelConstraintSchema, stayConstraintSchema, activityConstraintSchema, scheduleConstraintSchema] =
  constraintSchema.options;
export const constraintDraftSchema = z.discriminatedUnion("category", [
  budgetConstraintSchema.omit({ id: true }),
  travelConstraintSchema.omit({ id: true }),
  stayConstraintSchema.omit({ id: true }),
  activityConstraintSchema.omit({ id: true }),
  scheduleConstraintSchema.omit({ id: true }),
]);

export const destinationIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("specified"), locationId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("open") }).strict(),
]);

export const flexibleDateWindowSchema = z.object({
  kind: z.literal("flexible_window"),
  earliestStart: isoDateSchema,
  latestEnd: isoDateSchema,
  durationDays: z.number().int().min(2).max(21).optional(),
  label: z.string().trim().min(1).max(80),
}).strict().refine((value) => value.latestEnd >= value.earliestStart, {
  message: "Flexible date window must end on or after it starts",
  path: ["latestEnd"],
});

function validateRequestRelationships(
  value: {
    startDate?: string;
    endDate?: string;
    dateWindow?: unknown;
    travellers: Array<{ id: string }>;
    constraints: Constraint[];
  },
  context: z.RefinementCtx,
) {
  if (value.startDate && value.endDate && value.endDate <= value.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Trip end date must be after start date",
      path: ["endDate"],
    });
  }

  if (value.dateWindow && (value.startDate || value.endDate)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exact dates and a flexible date window cannot be active at the same time",
      path: ["dateWindow"],
    });
  }

  const travellerIds = value.travellers.map((traveller) => traveller.id);
  if (new Set(travellerIds).size !== travellerIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Traveller IDs must be unique", path: ["travellers"] });
  }

  const knownTravellerIds = new Set(travellerIds);
  const constraintIds = value.constraints.map((constraint) => constraint.id);
  if (new Set(constraintIds).size !== constraintIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Constraint IDs must be unique", path: ["constraints"] });
  }

  const semanticKeys = value.constraints.map(constraintSemanticKey);
  if (new Set(semanticKeys).size !== semanticKeys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Only one constraint is allowed per category and traveller scope",
      path: ["constraints"],
    });
  }

  value.constraints.forEach((constraint, constraintIndex) => {
    constraint.travellerIds?.forEach((travellerId) => {
      if (!knownTravellerIds.has(travellerId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown traveller ID: ${travellerId}`,
          path: ["constraints", constraintIndex, "travellerIds"],
        });
      }
    });
  });
}

const requestFields = {
  origin: z.string().min(1).optional(),
  destination: destinationIntentSchema.optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  dateWindow: flexibleDateWindowSchema.optional(),
  travellers: z.array(travellerSchema),
  preferences: z
    .object({
      pace: z.enum(["relaxed", "balanced", "packed"]).optional(),
      interests: z.array(z.string().trim().min(1)).max(20).optional(),
    })
    .strict(),
  constraints: z.array(constraintSchema),
};

export const tripRequestSchema = z.object(requestFields).strict().superRefine(validateRequestRelationships);

export const plannableTripRequestSchema = z
  .object({
    ...requestFields,
    origin: z.string().min(1),
    destination: destinationIntentSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    dateWindow: z.undefined().optional(),
    travellers: z.array(travellerSchema).min(1),
  })
  .strict()
  .superRefine(validateRequestRelationships);

export const requestPatchSchema = z
  .object({
    origin: z.string().min(1).optional(),
    destination: destinationIntentSchema.optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    dateWindow: flexibleDateWindowSchema.optional(),
    pace: z.enum(["relaxed", "balanced", "packed"]).optional(),
    interests: z.array(z.string().trim().min(1)).max(20).optional(),
    upsertConstraints: z.array(constraintDraftSchema).optional(),
    removeConstraintIds: z.array(z.string().min(1)).optional(),
    travellerHints: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).optional(),
            type: z.enum(["adult", "child", "senior"]).optional(),
            mobility: z.enum(["standard", "limited"]).optional(),
          })
          .strict()
          .refine((value) => Object.values(value).some((item) => item !== undefined), {
            message: "Traveller hint must define at least one field",
          }),
      )
      .optional(),
  })
  .strict();

export function constraintSemanticKey(constraint: Pick<Constraint, "category" | "travellerIds">): string {
  const travellerScope = [...new Set(constraint.travellerIds ?? [])].sort().join(",");
  return `${constraint.category}:${travellerScope || "all"}`;
}

function normalizeConstraint<T extends Constraint>(constraint: T): T {
  const travellerIds = constraint.travellerIds
    ? [...new Set(constraint.travellerIds)].sort()
    : undefined;
  const normalized = { ...constraint, travellerIds } as T;
  if (normalized.category === "stay" && normalized.value.requiredAmenities) {
    normalized.value.requiredAmenities = [
      ...new Set(normalized.value.requiredAmenities.map((item) => item.trim().toLocaleLowerCase("en"))),
    ].sort();
  }
  if (normalized.category === "travel" && normalized.value.allowedModes) {
    normalized.value.allowedModes = [...new Set(normalized.value.allowedModes)].sort();
  }
  return normalized;
}

function mergeConstraint(existing: Constraint, incoming: Constraint): Constraint {
  if (existing.category !== incoming.category) throw new Error("Cannot merge different constraint categories");
  return constraintSchema.parse(normalizeConstraint({
    ...incoming,
    id: existing.id,
    value: { ...existing.value, ...incoming.value },
  } as Constraint));
}

export function upsertConstraint(constraints: Constraint[], incoming: Constraint): Constraint[] {
  const parsedIncoming = constraintSchema.parse(incoming);
  const key = constraintSemanticKey(parsedIncoming);
  const index = constraints.findIndex((constraint) => constraintSemanticKey(constraint) === key);
  if (index < 0) return [...constraints, normalizeConstraint(parsedIncoming)];
  return constraints.map((constraint, constraintIndex) =>
    constraintIndex === index ? mergeConstraint(constraint, parsedIncoming) : constraint,
  );
}

export function removeConstraint(constraints: Constraint[], constraintId: string): Constraint[] {
  if (!constraints.some((constraint) => constraint.id === constraintId)) {
    throw new Error(`Unknown constraint ID: ${constraintId}`);
  }
  return constraints.filter((constraint) => constraint.id !== constraintId);
}

export function checkRequirements(request: TripRequest): RequirementCheck {
  const missingRequired: MissingRequirement[] = [];
  if (!request.origin) missingRequired.push("origin");
  if (!request.destination) missingRequired.push("destination_intent");
  if (!request.startDate || !request.endDate) missingRequired.push("dates");
  if (request.travellers.length === 0) missingRequired.push("travellers");

  const optionalTopics: RequirementCheck["optionalTopics"] = [];
  if (!request.constraints.some((constraint) => constraint.category === "budget")) optionalTopics.push("budget");
  if (!request.preferences.pace) optionalTopics.push("pace");
  if (!request.travellers.some((traveller) => traveller.mobility)) optionalTopics.push("mobility");
  if (!request.preferences.interests?.length) optionalTopics.push("interests");
  return { missingRequired, optionalTopics };
}

/**
 * Origin and destination define the route scope of a generated itinerary.
 * Other brief edits can update an existing plan in place, but a route-scope
 * change must hide the committed itinerary until its replacement is ready.
 */
export function hasPlanningRouteChanged(
  current: Pick<TripRequest, "origin" | "destination">,
  next: Pick<TripRequest, "origin" | "destination">,
): boolean {
  if (current.origin !== next.origin) return true;
  if (current.destination?.kind !== next.destination?.kind) return true;
  if (current.destination?.kind === "specified" && next.destination?.kind === "specified") {
    return current.destination.locationId !== next.destination.locationId;
  }
  return false;
}

export function canonicalizeTripRequest(request: TripRequest): TripRequest {
  const parsed = tripRequestSchema.parse(request);
  return {
    ...parsed,
    preferences: {
      ...parsed.preferences,
      interests: parsed.preferences.interests
        ? [...new Set(parsed.preferences.interests.map((interest) => interest.toLocaleLowerCase("en")))].sort()
        : undefined,
    },
    constraints: parsed.constraints.map(normalizeConstraint),
  } as TripRequest;
}

export function requirePlannableRequest(request: TripRequest): PlannableTripRequest {
  const parsed = canonicalizeTripRequest(request);
  const requirements = checkRequirements(parsed);
  if (requirements.missingRequired.length > 0) {
    throw new Error(`Missing required trip fields: ${requirements.missingRequired.join(", ")}`);
  }
  return plannableTripRequestSchema.parse(parsed) as PlannableTripRequest;
}

export function applyConstraintPatch(
  request: TripRequest,
  patch: Pick<RequestPatch, "upsertConstraints" | "removeConstraintIds">,
  createConstraintId: (draft: ConstraintDraft) => string,
): TripRequest {
  let constraints = [...request.constraints];
  for (const constraintId of patch.removeConstraintIds ?? []) {
    constraints = removeConstraint(constraints, constraintId);
  }
  for (const draft of patch.upsertConstraints ?? []) {
    constraints = upsertConstraint(constraints, { ...draft, id: createConstraintId(draft) } as Constraint);
  }
  return canonicalizeTripRequest({ ...request, constraints });
}
