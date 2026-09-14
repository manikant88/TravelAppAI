import { addCalendarDays } from '@/domain/dates';
import {
  provisionalDateGuidanceSchema,
  type LiveBrief,
  type ProvisionalDateGuidance,
} from './contracts';

export type ModelDateGuidance = ReturnType<typeof provisionalDateGuidanceSchema.parse>;

/** Keeps unverified guidance outside canonical intent and enforces calendar invariants. */
export function validateProvisionalDateGuidance(candidate: unknown, brief: LiveBrief, today: string): ProvisionalDateGuidance | undefined {
  if (brief.startDate) return undefined;
  const parsed = provisionalDateGuidanceSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.startDate < today) return undefined;
  const days = brief.days ?? parsed.data.days;
  return { ...parsed.data, days, endDate: addCalendarDays(parsed.data.startDate, days - 1) };
}

export function provisionalDateGuidanceMessage(guidance: ProvisionalDateGuidance) {
  return `I can suggest ${guidance.startDate} through ${guidance.endDate} as a provisional date range. This is general seasonal guidance and has not been verified against current weather, prices, availability, events or closures. Select it to check the exact dates with the available live providers.`;
}
