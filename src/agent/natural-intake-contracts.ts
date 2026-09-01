import { z } from "zod";
import { isoDateSchema, tripRequestSchema } from "@/domain/request";
import type { ConstraintDraft, MissingRequirement, TripRequest } from "@/domain/model";
import { conversationContextSchema } from "@/agent/conversation-contracts";

const nullableTextSchema = z.string().trim().min(1).max(160).nullable();

export const naturalDestinationIntentSchema = z.union([
  z.object({ kind: z.literal("specified"), query: z.string().trim().min(1).max(160) }).strict(),
  z.object({ kind: z.literal("open") }).strict(),
]);

// OpenAI structured outputs require every object property to be present. The
// durable request uses an optional duration because a user may name only a
// month or season; the model boundary represents that absence explicitly as
// null and is normalized before it enters application state.
export const naturalFlexibleDateWindowSchema = z
  .object({
    kind: z.literal("flexible_window"),
    earliestStart: isoDateSchema,
    latestEnd: isoDateSchema,
    durationDays: z.number().int().min(2).max(21).nullable(),
    label: z.string().trim().min(1).max(80),
  })
  .strict();

export const naturalTravellerGroupSchema = z
  .object({
    type: z.enum(["adult", "child", "senior"]),
    count: z.number().int().positive().max(6),
    mobility: z.enum(["standard", "limited"]).nullable(),
  })
  .strict();

const naturalBudgetConstraintSchema = z
  .object({
    category: z.literal("budget"),
    priority: z.enum(["hard", "strong", "flexible"]),
    targetTotal: z.number().int().positive().nullable(),
    maxTotal: z.number().int().positive().nullable(),
  })
  .strict()
  .refine((value) => value.targetTotal !== null || value.maxTotal !== null, {
    message: "A budget constraint requires a target or maximum",
  })
  .refine(
    (value) =>
      value.targetTotal === null ||
      value.maxTotal === null ||
      value.targetTotal <= value.maxTotal,
    {
      message: "Budget target must not exceed budget maximum",
    },
  );

const naturalTravelConstraintSchema = z
  .object({
    category: z.literal("travel"),
    priority: z.enum(["hard", "strong", "flexible"]),
    earliestDeparture: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    latestArrival: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    allowedModes: z.array(z.enum(["flight", "train", "bus", "ferry"])).max(4),
    maxStops: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.earliestDeparture !== null ||
      value.latestArrival !== null ||
      value.allowedModes.length > 0 ||
      value.maxStops !== null,
    { message: "A travel constraint requires at least one value" },
  );

const naturalStayConstraintSchema = z
  .object({
    category: z.literal("stay"),
    priority: z.enum(["hard", "strong", "flexible"]),
    maxNightlyPrice: z.number().int().positive().nullable(),
    requiredAmenities: z.array(z.string().trim().min(1).max(80)).max(12),
    seniorFriendly: z.boolean().nullable(),
    requiredRooms: z.number().int().positive().max(6).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.maxNightlyPrice !== null ||
      value.requiredAmenities.length > 0 ||
      value.seniorFriendly !== null ||
      value.requiredRooms !== null,
    { message: "A stay constraint requires at least one value" },
  );

const naturalActivityConstraintSchema = z
  .object({
    category: z.literal("activity"),
    priority: z.enum(["hard", "strong", "flexible"]),
    maxMobility: z.enum(["low", "medium", "high"]).nullable(),
    childFriendly: z.boolean().nullable(),
    seniorFriendly: z.boolean().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.maxMobility !== null ||
      value.childFriendly !== null ||
      value.seniorFriendly !== null,
    { message: "An activity constraint requires at least one value" },
  );

const naturalScheduleConstraintSchema = z
  .object({
    category: z.literal("schedule"),
    priority: z.enum(["hard", "strong", "flexible"]),
    maxActiveMinutesPerDay: z.number().int().positive().max(1_440),
  })
  .strict();

export const naturalConstraintSchema = z.union([
  naturalBudgetConstraintSchema,
  naturalTravelConstraintSchema,
  naturalStayConstraintSchema,
  naturalActivityConstraintSchema,
  naturalScheduleConstraintSchema,
]);

export const naturalTripIntentSchema = z
  .object({
    originQuery: nullableTextSchema,
    destination: naturalDestinationIntentSchema.nullable(),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    dateWindow: naturalFlexibleDateWindowSchema.nullable(),
    travellerGroups: z.array(naturalTravellerGroupSchema).max(6),
    pace: z.enum(["relaxed", "balanced", "packed"]).nullable(),
    interests: z.array(z.string().trim().min(1).max(80)).max(20),
    constraints: z.array(naturalConstraintSchema).max(5),
  })
  .strict();

export type NaturalTripIntent = z.infer<typeof naturalTripIntentSchema>;
export type NaturalConstraint = z.infer<typeof naturalConstraintSchema>;

function money(amount: number | null) {
  return amount === null ? undefined : { amount, currency: "INR" as const };
}

export function constraintDraftFromNatural(constraint: NaturalConstraint): ConstraintDraft {
  switch (constraint.category) {
    case "budget":
      return {
        category: "budget",
        priority: constraint.priority,
        value: {
          targetTotal: money(constraint.targetTotal),
          maxTotal: money(constraint.maxTotal),
        },
      };
    case "travel":
      return {
        category: "travel",
        priority: constraint.priority,
        value: {
          earliestDeparture: constraint.earliestDeparture ?? undefined,
          latestArrival: constraint.latestArrival ?? undefined,
          allowedModes: constraint.allowedModes.length > 0 ? constraint.allowedModes : undefined,
          maxStops: constraint.maxStops ?? undefined,
        },
      };
    case "stay":
      return {
        category: "stay",
        priority: constraint.priority,
        value: {
          maxNightlyPrice: money(constraint.maxNightlyPrice),
          requiredAmenities:
            constraint.requiredAmenities.length > 0 ? constraint.requiredAmenities : undefined,
          seniorFriendly: constraint.seniorFriendly ?? undefined,
          requiredRooms: constraint.requiredRooms ?? undefined,
        },
      };
    case "activity":
      return {
        category: "activity",
        priority: constraint.priority,
        value: {
          maxMobility: constraint.maxMobility ?? undefined,
          childFriendly: constraint.childFriendly ?? undefined,
          seniorFriendly: constraint.seniorFriendly ?? undefined,
        },
      };
    case "schedule":
      return {
        category: "schedule",
        priority: constraint.priority,
        value: { maxActiveMinutesPerDay: constraint.maxActiveMinutesPerDay },
      };
  }
}

export const naturalIntakeRequestSchema = z
  .object({
    message: z.string().trim().min(3).max(1_200),
    currentRequest: tripRequestSchema,
    context: conversationContextSchema.optional(),
  })
  .strict();

export const intakeIssueSchema = z
  .object({
    code: z.enum([
      "UNSUPPORTED_ORIGIN",
      "UNSUPPORTED_DESTINATION",
      "OUTSIDE_INVENTORY_WINDOW",
      "INVALID_DATE_RANGE",
    ]),
    field: z.enum(["origin", "destination", "dates"]),
    message: z.string().trim().min(1),
  })
  .strict();

export const resolvedLocationSchema = z
  .object({ id: z.string().min(1), label: z.string().trim().min(1) })
  .strict();

export const naturalIntakeResponseSchema = z
  .object({
    request: tripRequestSchema,
    resolvedLocations: z
      .object({
        origin: resolvedLocationSchema.optional(),
        destination: resolvedLocationSchema.optional(),
      })
      .strict(),
    appliedFields: z.array(
      z.enum(["origin", "destination", "dates", "date_window", "travellers", "pace", "interests", "constraints"]),
    ),
    missingRequired: z.array(z.enum(["origin", "destination_intent", "dates", "travellers"])),
    suggestedDateRanges: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      startDate: isoDateSchema,
      endDate: isoDateSchema,
    }).strict()).max(3),
    issues: z.array(intakeIssueSchema),
    message: z.string().trim().min(1),
  })
  .strict();

export type NaturalIntakeResponse = z.infer<typeof naturalIntakeResponseSchema> & {
  request: TripRequest;
  missingRequired: MissingRequirement[];
};
