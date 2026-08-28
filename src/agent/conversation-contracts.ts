import { z } from "zod";
import type { TripState } from "@/domain/model";

export const conversationIntentSchema = z
  .object({
    intent: z.enum(["modify_trip", "explain_trip"]),
  })
  .strict();

export type ConversationIntent = z.infer<typeof conversationIntentSchema>;

export interface ConversationRouterModel {
  classify(input: {
    message: string;
    trip: TripState;
  }): Promise<ConversationIntent>;
}

