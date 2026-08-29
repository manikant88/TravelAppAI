import { z } from "zod";

const idSchema = z.string().trim().min(1);

export const tripFieldSchema = z.enum([
  "origin",
  "destination",
  "dates",
  "travellers",
  "budget",
  "preferences",
]);
export type TripField = z.infer<typeof tripFieldSchema>;

export const interactionTargetSchema = z.union([
  z.object({ type: z.literal("trip_field"), field: tripFieldSchema }).strict(),
  z.object({ type: z.literal("selection"), selectionId: idSchema }).strict(),
  z.object({ type: z.literal("day"), date: z.string().date() }).strict(),
  z.object({ type: z.literal("trip_total") }).strict(),
]);

export const workspaceFocusSchema = z.object({
  operationId: idSchema,
  target: interactionTargetSchema,
  phase: z.enum(["understanding", "searching", "updating", "completed"]),
}).strict();
export type WorkspaceFocus = z.infer<typeof workspaceFocusSchema>;

export const interactionEventSchema = z.object({
  id: idSchema,
  type: z.enum([
    "fact_recognized",
    "fact_missing",
    "inventory_search_started",
    "inventory_search_completed",
    "candidate_selected",
    "constraint_detected",
    "selection_updated",
    "trip_validated",
    "operation_completed",
  ]),
  status: z.enum(["pending", "active", "completed", "failed"]),
  label: z.string().trim().min(1).max(180),
  target: interactionTargetSchema.optional(),
}).strict();
export type InteractionEvent = z.infer<typeof interactionEventSchema>;

export const guidedActionSchema = z.union([
  z.object({
    id: idSchema,
    type: z.literal("set_location"),
    field: z.enum(["origin", "destination"]),
    locationId: idSchema,
    label: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: idSchema,
    type: z.literal("set_open_destination"),
    label: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: idSchema,
    type: z.literal("set_dates"),
    startDate: z.string().date(),
    endDate: z.string().date(),
    label: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: idSchema,
    type: z.literal("set_travellers"),
    adults: z.number().int().nonnegative().max(20),
    children: z.number().int().nonnegative().max(20),
    seniors: z.number().int().nonnegative().max(20),
    label: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: idSchema,
    type: z.literal("set_budget"),
    amount: z.number().int().positive(),
    label: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: idSchema,
    type: z.literal("remove_constraint"),
    constraintId: idSchema,
    label: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: idSchema,
    type: z.literal("apply_proposal"),
    proposalId: idSchema,
    label: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    id: idSchema,
    type: z.enum(["retry", "submit_plan", "keep_current"]),
    label: z.string().trim().min(1).max(80),
  }).strict(),
]);
export type GuidedAction = z.infer<typeof guidedActionSchema>;

export const communicationContextSchema = z.object({
  intent: z.enum(["plan_trip", "modify_trip", "explain", "clarify", "recover"]),
  userMessage: z.string().max(1_200).optional(),
  fallbackMessage: z.string().trim().min(1).max(600),
  facts: z.array(z.string().trim().min(1).max(240)).max(16),
  events: z.array(interactionEventSchema).max(16),
  availableActions: z.array(guidedActionSchema).max(8),
}).strict();
export type CommunicationContext = z.infer<typeof communicationContextSchema>;

export const communicationOutputSchema = z.object({
  message: z.string().trim().min(1).max(600),
  actionLabels: z.array(z.object({
    actionId: idSchema,
    label: z.string().trim().min(1).max(80),
  }).strict()).max(8),
}).strict();
export type CommunicationOutput = z.infer<typeof communicationOutputSchema>;

export const interactionPresentationSchema = z.object({
  message: z.string().trim().min(1).max(600),
  events: z.array(interactionEventSchema).max(16),
  actions: z.array(guidedActionSchema).max(8),
  focus: workspaceFocusSchema.optional(),
}).strict();
export type InteractionPresentation = z.infer<typeof interactionPresentationSchema>;
