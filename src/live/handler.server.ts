import { liveRequestSchema, liveSelectionRequestSchema, type LiveSelectionRequest } from './contracts';
import { createGoogleProvider } from './google.server';
import { createLiveModel } from './model.server';
import { runLivePlan } from './planner';
import { createNuiteeStayProvider } from '@/inventory/providers/nuitee.server';
import { createNuiteeFlightProvider } from '@/transport/providers/nuitee-flight.server';
import { applyLiveSelection, LiveSelectionError } from './selection.server';

let active = 0;
export async function handleLiveConversation(body: unknown, request: Request): Promise<Response> {
  // This first experiment has no authentication or durable task store. Never
  // expose a paid provider proxy in a production deployment by accident.
  if (process.env.NODE_ENV === 'production') return Response.json({ message: 'Live planning is currently available in local development only.' }, { status: 403 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ message: 'Cross-origin live requests are not allowed.' }, { status: 403 });
  const parsed = liveRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: 'Invalid live trip brief. Use a message under 1,200 characters.' }, { status: 400 });
  if (active >= 2) return Response.json({ message: 'Live planning is busy. Try again when the current search finishes.' }, { status: 429 });
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(120000)]);
  const encoder = new TextEncoder();
  active++;
  const stream = new ReadableStream({
    async start(output) {
      let open = true;
      const send = (data: unknown) => { if (open) { try { output.enqueue(encoder.encode(JSON.stringify(data) + '\n')); } catch { open = false; controller.abort(); } } };
      try {
        const result = await runLivePlan(parsed.data, {
          model: createLiveModel(signal),
          provider: createGoogleProvider(signal),
          stayProvider: process.env.NUITEE_API_KEY ? createNuiteeStayProvider(signal) : undefined,
          flightProvider: process.env.NUITEE_API_KEY ? createNuiteeFlightProvider(signal) : undefined,
          guestNationality: process.env.NUITEE_GUEST_NATIONALITY?.trim() || 'IN',
          signal,
          progress: message => send({ type: 'progress', message }),
        });
        send({ type: 'result', result });
      } catch {
        send({ type: 'error', message: signal.aborted ? 'Search stopped or timed out. Your previous plan is unchanged.' : 'Live planning failed. Check AI, Google and Nuitée credentials, restrictions and quotas, then retry. No snapshot itinerary was substituted.' });
      } finally {
        active--;
        if (open) { try { output.close(); } catch { /* Client disconnected. */ } }
      }
    },
    cancel() { controller.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

export async function handleLiveSelection(body: unknown, request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') return Response.json({ message: 'Live planning is currently available in local development only.' }, { status: 403 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ message: 'Cross-origin live requests are not allowed.' }, { status: 403 });
  const parsed = liveSelectionRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: 'Invalid or incomplete live selection.' }, { status: 400 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  try {
    return Response.json(await applyLiveSelection(parsed.data as LiveSelectionRequest, {
      provider: createGoogleProvider(signal),
      flightProvider: process.env.NUITEE_API_KEY ? createNuiteeFlightProvider(signal) : undefined,
      guestNationality: process.env.NUITEE_GUEST_NATIONALITY?.trim() || 'IN',
      signal,
    }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof LiveSelectionError) return Response.json({ message: error.message }, { status: error.status });
    return Response.json({ message: signal.aborted ? 'Selection refresh stopped or timed out. The previous plan is unchanged.' : 'The selection could not be safely applied. The previous plan is unchanged.' }, { status: signal.aborted ? 408 : 502 });
  }
}
