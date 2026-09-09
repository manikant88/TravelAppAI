import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleInitialPrompt } from '@/ui/auto-submit';

describe('initial prompt scheduling', () => {
  afterEach(() => vi.useRealTimers());

  it('survives the setup-cleanup-setup sequence used by React Strict Mode', () => {
    vi.useFakeTimers();
    const submit = vi.fn();

    const cleanupFirstSetup = scheduleInitialPrompt(submit);
    cleanupFirstSetup();
    const cleanupSecondSetup = scheduleInitialPrompt(submit);

    vi.runAllTimers();
    expect(submit).toHaveBeenCalledTimes(1);
    cleanupSecondSetup();
  });
});
