import type { LiveRequest, LiveResponse, LiveSelectionRequest, LiveSelectionResponse } from '@/live/contracts';
export async function requestLivePlan(input: LiveRequest, signal: AbortSignal, progress: (message: string) => void): Promise<LiveResponse> {
  const response = await fetch('/api/agent/conversation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message ?? 'Live request failed.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Live response unavailable.');
  const decoder = new TextDecoder(); let buffer = ''; let result: LiveResponse | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.type === 'progress') progress(event.message);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'result') result = event.result;
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
  if (!result || result.kind !== 'live') throw new Error('Live response was incomplete. Retry your message.');
  return result;
}

export async function requestLiveSelection(input: LiveSelectionRequest, signal: AbortSignal): Promise<LiveSelectionResponse> {
  const response = await fetch('/api/agent/conversation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(body?.message ?? 'The selection could not be applied.');
  if (!body || body.kind !== 'live-selection') throw new Error('The selection response was incomplete.');
  return body;
}
