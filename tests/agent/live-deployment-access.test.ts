import { afterEach, describe, expect, it } from 'vitest';
import { handleLiveConversation, handleLiveSelection } from '@/live/handler.server';

const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalVercelTargetEnv = process.env.VERCEL_TARGET_ENV;
const originalLivePlanningEnabled = process.env.LIVE_PLANNING_ENABLED;

afterEach(() => {
  setEnvironment('NODE_ENV', originalNodeEnv);
  setEnvironment('VERCEL_ENV', originalVercelEnv);
  setEnvironment('VERCEL_TARGET_ENV', originalVercelTargetEnv);
  setEnvironment('LIVE_PLANNING_ENABLED', originalLivePlanningEnabled);
});

describe('live planning deployment access', () => {
  it.each([
    ['conversation', handleLiveConversation],
    ['selection', handleLiveSelection],
  ])('allows an optimized Vercel Preview %s request to reach validation', async (_name, handler) => {
    setEnvironment('NODE_ENV', 'production');
    setEnvironment('VERCEL_ENV', 'preview');

    const response = await handler({}, new Request('https://travel-preview.example/api/agent/conversation'));

    expect(response.status).toBe(400);
    expect(await response.json()).not.toMatchObject({ message: expect.stringContaining('production deployment') });
  });

  it.each([
    ['conversation', handleLiveConversation],
    ['selection', handleLiveSelection],
  ])('keeps an explicit Vercel Production %s request disabled', async (_name, handler) => {
    setEnvironment('NODE_ENV', 'production');
    setEnvironment('VERCEL_ENV', 'production');

    const response = await handler({}, new Request('https://travel.example/api/agent/conversation'));

    expect(response.status).toBe(403);
  });

  it('allows an explicitly enabled non-Vercel staging build', async () => {
    setEnvironment('NODE_ENV', 'production');
    setEnvironment('VERCEL_ENV', undefined);
    setEnvironment('VERCEL_TARGET_ENV', undefined);
    setEnvironment('LIVE_PLANNING_ENABLED', 'true');

    const response = await handleLiveConversation({}, new Request('https://staging.example/api/agent/conversation'));

    expect(response.status).toBe(400);
  });
});

function setEnvironment(name: 'NODE_ENV' | 'VERCEL_ENV' | 'VERCEL_TARGET_ENV' | 'LIVE_PLANNING_ENABLED', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else (process.env as Record<string, string | undefined>)[name] = value;
}
