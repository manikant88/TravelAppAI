import { z } from "zod";
import type { TripState } from "@/domain/model";
import { tripRequestSchema } from "@/domain/request";
import { tripStateSchema } from "@/domain/trip";
import { guidedActionSchema, tripFieldSchema } from "@/agent/interaction-contracts";

const idSchema = z.string().trim().min(1);

export const conversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(800),
}).strict();

export const activeInteractionSchema = z.object({
  mode: z.enum(["build", "explore"]),
  task: z.enum([
    "complete_trip_brief",
    "discover_destinations",
    "build_itinerary",
    "modify_itinerary",
    "explain_itinerary",
  ]),
  awaitingFields: z.array(tripFieldSchema).max(6),
  lastAssistantMessage: z.string().trim().min(1).max(600).optional(),
  availableActions: z.array(guidedActionSchema).max(8),
}).strict();
export type ActiveInteraction = z.infer<typeof activeInteractionSchema>;

export const conversationContextSchema = z.object({
  history: z.array(conversationEntrySchema).max(8),
  activeInteraction: activeInteractionSchema.optional(),
}).strict();
export type ConversationContext = z.infer<typeof conversationContextSchema>;

/** The model classifies only; deterministic executors own state transitions. */
export const conversationIntentSchema = z.object({
  intent: z.enum([
    "select_presented_action",
    "activity_suggestion",
    "modify_trip",
    "explain_trip",
    "travel_context",
    "conversational",
    "unsupported",
  ]),
  actionId: idSchema.nullable(),
}).strict();

export type ConversationIntent = z.infer<typeof conversationIntentSchema>;

export interface ConversationRouterModel {
  classify(input: {
    message: string;
    trip: TripState;
    context?: ConversationContext;
  }): Promise<ConversationIntent>;
}

export type CommittedConversationIntent = ConversationIntent["intent"];

export const draftConversationSchema = z.object({
  phase: z.literal("draft"),
  clientTurnId: idSchema,
  message: z.string().trim().min(1).max(800),
  currentRequest: tripRequestSchema,
  context: conversationContextSchema.optional(),
}).strict();

export const committedConversationSchema = z.object({
  phase: z.literal("committed"),
  clientTurnId: idSchema,
  message: z.string().trim().min(1).max(800),
  trip: tripStateSchema,
  actionHint: z.enum(["modify_trip", "explain_trip"]).optional(),
  selectionId: idSchema.optional(),
  targetDate: z.string().date().optional(),
  context: conversationContextSchema.optional(),
  conversationHistory: z.array(conversationEntrySchema).max(8).optional(),
}).strict();

export const conversationRequestSchema = z.discriminatedUnion("phase", [
  draftConversationSchema,
  committedConversationSchema,
]);
export type ConversationRequest = z.infer<typeof conversationRequestSchema>;
