import { isRenderableLivePlan, type LivePlan } from '@/live/contracts';

export function resolveDisplayedLivePlan(current: LivePlan | undefined, incoming: LivePlan) {
  if (isRenderableLivePlan(incoming)) return { plan: incoming, preservedPrevious: false };
  if (current && isRenderableLivePlan(current)) return { plan: current, preservedPrevious: true };
  return { plan: undefined, preservedPrevious: false };
}
