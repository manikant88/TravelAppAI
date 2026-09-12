import { describe, expect, it } from 'vitest';
import type { LivePlan } from '@/live/contracts';
import { resolveDisplayedLivePlan } from '@/ui/live-plan-state';

describe('live plan display state', () => {
  const valid = { generationStatus: 'valid' } as LivePlan;
  const replacement = { generationStatus: 'valid' } as LivePlan;
  const incomplete = { generationStatus: 'incomplete' } as LivePlan;

  it('keeps the previous valid itinerary when a replan is incomplete', () => {
    expect(resolveDisplayedLivePlan(valid, incomplete)).toEqual({ plan: valid, preservedPrevious: true });
  });

  it('uses a validated replacement and does not retain an incomplete first plan', () => {
    expect(resolveDisplayedLivePlan(valid, replacement)).toEqual({ plan: replacement, preservedPrevious: false });
    expect(resolveDisplayedLivePlan(undefined, incomplete)).toEqual({ plan: undefined, preservedPrevious: false });
  });
});
