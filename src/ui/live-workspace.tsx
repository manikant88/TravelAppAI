"use client";
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { emptyLiveBrief, type LivePlan, type LiveRequest, type LiveDay, type LiveTravelOption, type LiveSelectionRequest } from '@/live/contracts';
import { requestLivePlan, requestLiveSelection } from './services/live-client';
import { LiveMap } from './live-map';
import { LivePlaceCard } from './live-place-card';
import { LiveTravelCard } from './live-travel-routes';
import { LiveFlightCard } from './live-flight-card';
import { LiveOptionDrawer, type LiveOptionPicker } from './live-option-drawer';
import { localClockMinutes, projectLiveDay } from '@/live/timeline';
import { Badge, Button, Chip } from './components/primitives';
import { AppIcon } from './components/app-icon';
import './live-workspace.css';

type Message = LiveRequest['history'][number];
const example = "I'm planning a trip to Jaipur with my wife for 3 nights and 4 days, starting from 8th September 2027, travelling from Delhi.";
function time(minutes: number | null) {
  if (minutes === null) return 'Time unresolved';
  const dayOffset = Math.floor(minutes / 1440);
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
  const clock = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
  return dayOffset > 0 ? `${clock} +${dayOffset}d` : clock;
}
function dateLabel(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
function TransferEvent({ option, label, start, end, focus }: { option: LiveTravelOption | undefined; label: string; start: number | null; end: number | null; focus: string }) {
  return <div className="live-timeline-event" data-focus={focus}><div className="live-time-rail"><strong>{time(start)}</strong><span>{time(end)}</span><b>{option ? `${option.minutes} min` : 'Unresolved'}</b></div><div className="live-transfer"><AppIcon name="car" size={16} /><div><strong>{label}</strong><span>{option ? `${option.minutes} min driving${option.meters !== null ? ` · ${(option.meters / 1000).toFixed(1)} km` : ''}` : 'Road transfer unavailable'}</span></div></div></div>;
}
function MissingFlightCard({ direction, plan, busy, onRetry, onCompare }: { direction: 'outbound' | 'return'; plan: LivePlan; busy: boolean; onRetry(): void; onCompare(): void }) {
  const from = direction === 'outbound' ? plan.brief.origin : plan.brief.destination;
  const to = direction === 'outbound' ? plan.brief.destination : plan.brief.origin;
  const date = direction === 'outbound' ? plan.days[0].date : plan.days.at(-1)!.date;
  const googleFlightsUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to} on ${date}`)}`;
  return <div className="live-timeline-event" data-focus={`flight:${direction}`}>
    <div className="live-time-rail"><strong>Time unresolved</strong><span>{dateLabel(date)}</span><b>Unresolved</b></div>
    <article className="itinerary-card itinerary-flight-card live-route-card live-unresolved-flight">
      <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true"><AppIcon name="flight" /></span><strong>{direction === 'outbound' ? 'Outbound' : 'Return'} flight unavailable</strong></header>
      <div className="live-unresolved-body"><div><h4>{from} → {to}</h4><p>Nuitée did not return a verified flight offer. No flight, fare or arrival time has been assumed.</p></div><div className="live-unresolved-actions"><Button disabled={busy} onClick={onRetry}>Retry flights</Button><Button variant="secondary" disabled={busy || !plan.travel} onClick={onCompare}>Compare train, bus, cab &amp; self-drive</Button><a href={googleFlightsUrl} target="_blank" rel="noreferrer">Search Google Flights <AppIcon name="arrow-right" size={13} /></a></div></div>
      <footer className="live-route-footer"><span>Flight supplier unavailable · Google route fallbacks are unselected</span></footer>
    </article>
  </div>;
}
function DayTimeline({ day, dayIndex, first, last, startMinutes, hasOutboundTravel, hasReturnTravel, estimates, busy, lockedActivityIds, onEstimate, onLockActivity, onChangeActivity }: { day: LiveDay; dayIndex: number; first: boolean; last: boolean; startMinutes: number | null; hasOutboundTravel: boolean; hasReturnTravel: boolean; estimates: Record<string, string>; busy: boolean; lockedActivityIds: string[]; onEstimate(id: string, value: string): void; onLockActivity(placeId: string, locked: boolean): void; onChangeActivity(dayIndex: number, visitIndex: number): void }) {
  const { rows, back, returnDeparture, returnArrival, end } = projectLiveDay(day, startMinutes);
  const visitMinutes = day.visits.reduce((sum, visit) => sum + visit.durationMinutes, 0);
  const mealMinutes = (day.meals ?? []).reduce((sum, meal) => sum + meal.durationMinutes, 0);
  const completeRoutes = rows.length > 0 && rows.every(row => row.leg?.minutes != null) && back?.minutes != null;
  const drivingMinutes = completeRoutes ? rows.reduce((sum, row) => sum + row.leg.minutes!, 0) + back!.minutes! : null;
  const bufferMinutes = rows.reduce((sum, row) => sum + row.bufferMinutes, 0) + (back && back.fromId !== back.toId ? 15 : 0);
  return <div className="live-timeline day-events">
    <div className="live-day-summary"><span><strong>{visitMinutes} min</strong> activities</span><span><strong>{mealMinutes} min</strong> meals</span><span><strong>{drivingMinutes === null ? 'Unresolved' : `${drivingMinutes} min`}</strong> driving</span><span><strong>{bufferMinutes} min</strong> buffers</span></div>
    {/* {first && <p className="live-notice"><AppIcon name="flight" size={16} /> {hasOutboundTravel ? 'Confirm the suggested route before relying on Day 1 timing. Google Routes does not confirm a ticket, seat or pickup.' : 'Outbound travel is unresolved. Day 1 visits depend on when you reach your stay.'}</p>} */}
    <p className="live-timing-note">Estimated schedule · {startMinutes === null ? 'start time unresolved' : first && hasOutboundTravel ? `continues after arrival/check-in at ${time(startMinutes)}` : `starts at ${time(startMinutes)}`} · all times local to destination</p>
    {rows.map(({ visit, leg, departure, arrival, start, end, bufferMinutes: connectionBuffer, waitMinutes }, index) => <div key={`${visit.kind}-${visit.place.id}-${index}`}>
      {leg?.fromId !== leg?.toId && <div className="live-timeline-event" data-focus={`leg:${index}`}>
        <div className="live-time-rail"><strong>{time(departure)}</strong><span>{time(arrival)}</span></div>
        <div className="live-transfer"><AppIcon name="car" size={16} /><div><strong>Drive to {visit.place.name}</strong><span>{leg?.minutes != null ? `${leg.minutes} min driving` : 'Duration unknown'}{leg?.meters != null ? ` · ${(leg.meters / 1000).toFixed(1)} km` : ''}</span></div></div>
      </div>}
      {connectionBuffer > 0 && <div className="live-timeline-event live-buffer" data-focus={`place:${visit.place.id}`}><div className="live-time-rail"><strong>{time(arrival)}</strong><span>{time(arrival === null ? null : arrival + connectionBuffer)}</span></div><p><strong>{connectionBuffer} min buffer</strong><span>Allow time to arrive and get ready · planning assumption</span></p></div>}
      {waitMinutes !== null && waitMinutes > 0 && <div className="live-timeline-event live-buffer" data-focus={`place:${visit.place.id}`}><div className="live-time-rail"><strong>{time(start === null ? null : start - waitMinutes)}</strong><span>{time(start)}</span></div><p><strong>{waitMinutes} min open time</strong><span>Meal begins near its target time</span></p></div>}
      <div className="live-timeline-event" data-focus={`place:${visit.place.id}`}>
        <div className="live-time-rail"><strong>{time(start)}</strong><span>{time(end)}</span><b>{visit.durationMinutes} min</b></div>
        {visit.kind === 'meal'
          ? <LivePlaceCard place={visit.place} kind="meal" heading={`${visit.type[0].toUpperCase()}${visit.type.slice(1)} · ${visit.durationMinutes} min · ${time(start)}–${time(end)}`} subtitle={`${visit.hoursNote ?? 'Opening hours unavailable'} · ${mealRouteNote(visit.routeFit)} · ${visit.dietaryNote}`} estimate={estimates[visit.place.id] ?? ''} onEstimate={value => onEstimate(visit.place.id, value)} />
          : <LivePlaceCard place={visit.place} kind="activity" heading={`Stop ${visit.sourceIndex + 1} · ${visit.durationMinutes} min visit · ${time(start)}–${time(end)}`} subtitle={`${visit.hoursNote ?? 'Opening hours unavailable'} · estimated visit length`} estimate={estimates[visit.place.id] ?? ''} onEstimate={value => onEstimate(visit.place.id, value)} locked={lockedActivityIds.includes(visit.place.id)} selectionBusy={busy} onLock={() => onLockActivity(visit.place.id, !lockedActivityIds.includes(visit.place.id))} onChange={() => onChangeActivity(dayIndex, visit.sourceIndex)} />}
      </div>
    </div>)}
    {rows.length > 0 && <>
      <div className="live-timeline-event" data-focus={`leg:${rows.length}`}><div className="live-time-rail"><strong>{time(returnDeparture)}</strong><span>{time(returnArrival)}</span></div><div className="live-transfer"><AppIcon name="hotel" size={16} /><div><strong>Return to stay</strong><span>{back?.minutes != null ? `${back.minutes} min driving` : 'Duration unknown'}</span></div></div></div>
      <div className="live-timeline-event live-buffer" data-focus="hotel"><div className="live-time-rail"><strong>{time(returnArrival)}</strong><span>{time(end)}</span></div><p><strong>15 min buffer · settle in</strong><span>Planned block ends {time(end)}</span></p></div>
    </>}
    {!rows.length && <p>No visits planned for this day. Needs review.</p>}
    {end !== null && end > 1080 && <p className="live-notice">This day runs past 18:00. Review visit durations and venue hours.</p>}
    <p className="live-timing-note">Meal times are planning targets; menus, dietary handling and prices require confirmation.{last ? hasReturnTravel ? ' Checkout timing and the suggested return route still need confirmation.' : ' Checkout and return travel remain unresolved.' : ''}</p>
  </div>;
}
export default function LiveWorkspace({ initialPrompt = '' }: { initialPrompt?: string }) {
  const [brief, setBrief] = useState(emptyLiveBrief);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(initialPrompt);
  const [plan, setPlan] = useState<LivePlan>();
  const [planNeedsRefresh, setPlanNeedsRefresh] = useState(false);
  const [day, setDay] = useState(0);
  const [focus, setFocus] = useState('hotel');
  const [followMap, setFollowMap] = useState(true);
  const results = useRef<HTMLElement>(null);
  const daysNav = useRef<HTMLElement>(null);
  const [estimates, setEstimates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [picker, setPicker] = useState<LiveOptionPicker>();
  const closePicker = useCallback(() => setPicker(undefined), []);
  const controller = useRef<AbortController | null>(null);
  const conversation = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { conversation.current?.scrollTo({ top: conversation.current.scrollHeight, behavior: 'smooth' }); }, [messages, progress]);
  useEffect(() => {
    const root = results.current;
    if (!root || !plan) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const nav = daysNav.current;
      const height = nav?.offsetHeight ?? 64;
      root.style.setProperty('--day-nav-height', `${height}px`);
      const threshold = Math.max(nav?.getBoundingClientRect().bottom ?? 0, 0) + 45;
      const anchors = Array.from(root.querySelectorAll<HTMLElement>('[data-focus]'));
      let active = anchors[0];
      for (const anchor of anchors) {
        if (anchor.getBoundingClientRect().top > threshold) break;
        active = anchor;
      }
      if (active) {
        setDay(Number(active.closest('[data-day]')?.getAttribute('data-day') ?? 0));
        setFocus(active.dataset.focus ?? 'hotel');
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    if (daysNav.current) observer.observe(daysNav.current);
    const column = root.querySelector('.live-card-column');
    if (column) observer.observe(column);
    root.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); root.removeEventListener('scroll', schedule); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [plan]);
  function jumpToDay(index: number) {
    const section = results.current?.querySelector<HTMLElement>(`[data-day="${index}"]`);
    section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (controller.current || !text.trim()) return;
    const message = text.trim(); const previous = messages;
    setMessages([...previous, { role: 'user', text: message }]); setText(''); setBusy(true);
    const current = new AbortController(); controller.current = current;
    try {
      const result = await requestLivePlan({ phase: 'live', message, brief, history: previous.slice(-12) }, current.signal, setProgress);
      if (current.signal.aborted) return;
      setBrief(result.brief);
      if (result.plan) { setPlan(result.plan); setPlanNeedsRefresh(false); setDay(0); setEstimates({}); }
      else if (plan && JSON.stringify(result.brief) !== JSON.stringify(plan.brief)) setPlanNeedsRefresh(true);
      setMessages(m => [...m, { role: 'assistant', text: result.message }]);
    } catch (error) {
      setMessages(m => [...m, { role: 'assistant', text: current.signal.aborted ? 'Search cancelled. Your previous plan is unchanged.' : error instanceof Error ? error.message : 'Live search failed.' }]);
      setText(message);
    } finally { controller.current = null; setBusy(false); setProgress(''); }
  }
  async function applySelection(command: LiveSelectionRequest['command']): Promise<boolean> {
    if (!plan || controller.current) return false;
    setBusy(true); setProgress(command.type === 'set_lock' || command.type === 'set_activity_lock' ? 'Updating itinerary lock…' : 'Refreshing affected routes and timeline…');
    const current = new AbortController(); controller.current = current;
    try {
      const result = await requestLiveSelection({ phase: 'live-selection', plan, command }, current.signal);
      if (current.signal.aborted) return false;
      setPlan(result.plan); setPlanNeedsRefresh(false);
      setMessages(previous => [...previous, { role: 'assistant', text: result.message }]);
      return true;
    } catch (error) {
      setMessages(previous => [...previous, { role: 'assistant', text: error instanceof Error ? error.message : 'The selection could not be safely applied.' }]);
      return false;
    } finally { controller.current = null; setBusy(false); setProgress(''); }
  }
  const hotel = plan?.hotels.find(h => h.id === plan.selectedHotelId);
  const outbound = plan?.travel?.outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
  const returning = plan?.travel?.return.find(option => option.id === plan.travel?.suggestedReturnId);
  const outboundDeparture = travelMinutes(outbound, plan?.travel?.origin.utcOffsetMinutes, plan?.days[0]?.date);
  const outboundArrival = travelMinutes(outbound, plan?.travel?.destination.utcOffsetMinutes, plan?.days[0]?.date, true);
  const firstDayStart = outbound ? outboundArrival === null ? null : outboundArrival + 30 : null;
  const returnDeparture = travelMinutes(returning, plan?.travel?.destination.utcOffsetMinutes, plan?.days.at(-1)?.date);
  const returnArrival = travelMinutes(returning, plan?.travel?.origin.utcOffsetMinutes, plan?.days.at(-1)?.date, true);
  const flight = plan?.flight;
  const outboundFlight = flight?.outbound.find(option => option.id === flight.suggestedOutboundId);
  const returnFlight = flight?.return.find(option => option.id === flight.suggestedReturnId);
  const flightDeparture = flightMinutes(outboundFlight?.departureAt, flight?.originAirport.utcOffsetMinutes, plan?.days[0]?.date);
  const flightArrival = flightMinutes(outboundFlight?.arrivalAt, flight?.destinationAirport.utcOffsetMinutes, plan?.days[0]?.date);
  const airportArrival = flightDeparture === null ? null : flightDeparture - 120;
  const pickupDeparture = airportArrival === null || !flight?.outboundFirstMile ? null : airportArrival - flight.outboundFirstMile.minutes;
  const stayArrival = flightArrival === null || !flight?.outboundLastMile ? null : flightArrival + flight.outboundLastMile.minutes;
  const flightDayStart = stayArrival === null ? null : stayArrival + 30;
  const returnFlightDeparture = flightMinutes(returnFlight?.departureAt, flight?.destinationAirport.utcOffsetMinutes, plan?.days.at(-1)?.date);
  const returnAirportArrival = returnFlightDeparture === null ? null : returnFlightDeparture - 120;
  const returnHotelDeparture = returnAirportArrival === null || !flight?.returnFirstMile ? null : returnAirportArrival - flight.returnFirstMile.minutes;
  const returnFlightArrival = flightMinutes(returnFlight?.arrivalAt, flight?.originAirport.utcOffsetMinutes, plan?.days.at(-1)?.date);
  const homeArrival = returnFlightArrival === null || !flight?.returnLastMile ? null : returnFlightArrival + flight.returnLastMile.minutes;
  const selectedStayArrival = outboundFlight ? stayArrival : outboundArrival;
  const selectedFirstDayStart = outboundFlight ? flightDayStart : firstDayStart;
  function updateEstimate(id: string, value: string) { setEstimates(previous => ({ ...previous, [id]: value })); }
  return <main className="live-shell">
    <header className="live-header"><Link className="mmt-logo-link" href="/" aria-label="Trip planner home"><Image className="mmt-logo" src="/figma/itinerary/mmt-logo.png" alt="MakeMyTrip" width={169} height={40} priority /></Link><Badge tone="info"><AppIcon name="sparkles" size={13} /> Live planning</Badge><Link className="live-snapshot-link" href="/plan?mode=snapshot">Snapshot workspace</Link></header>
    <div className="live-layout">
      <section className="live-chat planner-panel" aria-label="Planning conversation">
        <div className="live-messages conversation" ref={conversation} aria-live="polite">{messages.map((m, i) => <div className={`message message-${m.role}`} key={i}><p>{m.text}</p></div>)}{busy && <p className="live-search-status" role="status"><AppIcon name="sparkles" size={16} /> {progress || 'Starting live planning…'}</p>}</div>
        <form className="live-composer" onSubmit={submit}><label htmlFor="live-message">Ask your trip planner</label><textarea id="live-message" maxLength={1200} value={text} onChange={e => setText(e.target.value)} placeholder={example} disabled={busy} />
          <div className="live-controls"><Button type="submit" disabled={busy || !text.trim()}>Send <AppIcon name="arrow-right" size={15} /></Button>{busy ? <Button variant="secondary" onClick={() => controller.current?.abort()}>Cancel</Button> : <Button variant="text" onClick={() => setText(example)}>Try Jaipur</Button>}</div>
        </form><small className="live-session-note">Draft stays in this session. Refreshing clears it.</small>
      </section>
      <section className="live-results" ref={results} aria-label="Live itinerary">
        {!plan ? <div className="live-empty"><span className="eyebrow">YOUR NEXT ADVENTURE</span><h2>Start with an idea.<br />Make it a trip.</h2><p>Share your destination, dates and who’s coming. Your stays, activities and day-by-day route will appear here.</p></div> : <>
          <header className="live-trip-heading"><div><p className="eyebrow">YOUR TRIP</p><h2>{plan.brief.destination}</h2><p>From {plan.brief.origin} · {dateLabel(plan.brief.startDate!)} – {dateLabel(plan.days.at(-1)!.date)} · {plan.brief.travellers} travellers · {plan.brief.days! - 1} nights</p></div><Badge tone="warning">{planNeedsRefresh ? 'Previous plan' : 'Provisional plan'}</Badge></header>
          {planNeedsRefresh ? <p className="live-plan-stale" role="status"><AppIcon name="alert-circle" size={16} /> Your request has changed. This is the previous plan until you answer the clarification and a new plan is built.</p> : null}
          {plan.eveningPrompt && plan.eveningOptions?.length ? <section className="live-evening-suggestion" aria-label="Optional evening ideas"><div><AppIcon name="sparkles" size={17} /><p><strong>Optional evening ideas</strong><span>{plan.eveningOptions.slice(0, 3).map(option => option.name).join(' · ')}</span><small>{plan.eveningPrompt}</small></p></div><Button variant="secondary" onClick={() => setText(plan.brief.dayRhythm === 'nightlife' ? 'Add a nightlife option to one suitable evening and recalculate the return to my stay.' : 'Show me suitable evening experiences and how they would affect the itinerary.')}>Explore in chat</Button></section> : null}
          <details className="live-review"><summary><AppIcon name="alert-circle" size={16} /> A few details still to confirm <span>Travel, prices &amp; timing</span></summary><ul>{plan.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>
          <nav className="live-days" ref={daysNav} aria-label="Jump to itinerary day">{plan.days.map((d, i) => <Chip key={d.date} aria-pressed={day === i} onClick={() => jumpToDay(i)}>Day {i + 1} · {dateLabel(d.date)}</Chip>)}</nav>
          <div className="live-content-grid">
            <div className="live-card-column">
              {plan.days.map((itineraryDay, index) => <section className="live-day-section" data-day={index} key={itineraryDay.date} aria-label={`Day ${index + 1}, ${dateLabel(itineraryDay.date)}`}>
                <div className="live-section-heading"><h3>Day {index + 1} in {plan.brief.destination}</h3><span>{dateLabel(itineraryDay.date)}</span></div>
                {plan.brief.travelMode === 'flight' && !outboundFlight && !outbound && index === 0 && <MissingFlightCard direction="outbound" plan={plan} busy={busy} onRetry={() => applySelection({ type:'retry_flights' })} onCompare={() => setPicker({ kind:'travel', direction:'outbound' })} />}
                {plan.travel && outbound && index === 0 && <div className="live-timeline-event" data-focus="travel:outbound"><div className="live-time-rail"><strong>{time(outboundDeparture)}</strong><span>{time(outboundArrival)}</span><b>{outbound.minutes} min</b></div><LiveTravelCard travel={plan.travel} direction="outbound" date={dateLabel(itineraryDay.date)} locked={plan.locks?.outboundTravel} busy={busy} onLock={() => applySelection({ type:'set_lock', target:'outboundTravel', locked:!plan.locks?.outboundTravel })} onChange={() => setPicker({ kind:'travel', direction:'outbound' })} /></div>}
                {flight && outboundFlight && index === 0 && <><TransferEvent option={flight.outboundFirstMile} label={`Drive to ${flight.originAirport.name}`} start={pickupDeparture} end={airportArrival} focus="flight:outbound-first" /><div className="live-timeline-event live-buffer" data-focus="flight:outbound"><div className="live-time-rail"><strong>{time(airportArrival)}</strong><span>{time(flightDeparture)}</span><b>120 min</b></div><p><strong>Airport check-in buffer</strong><span>Planning assumption; confirm airline requirements</span></p></div><div className="live-timeline-event" data-focus="flight:outbound"><div className="live-time-rail"><strong>{time(flightDeparture)}</strong><span>{time(flightArrival)}</span><b>{outboundFlight.durationMinutes} min</b></div><LiveFlightCard offer={outboundFlight} direction="outbound" from={flight.originAirport} to={flight.destinationAirport} travellers={plan.brief.travellers!} locked={plan.locks?.outboundFlight} selectionBusy={busy} onLock={() => applySelection({ type:'set_lock', target:'outboundFlight', locked:!plan.locks?.outboundFlight })} onChange={() => setPicker({ kind:'flight', direction:'outbound' })} /></div><TransferEvent option={flight.outboundLastMile} label={`Drive from ${flight.destinationAirport.name} to your stay`} start={flightArrival} end={stayArrival} focus="flight:outbound-last" /></>}
                {hotel && (index === 0 ? <div className="live-timeline-event" data-focus="hotel"><div className="live-time-rail"><strong>{time(selectedStayArrival)}</strong><span>{time(selectedFirstDayStart)}</span><b>{selectedStayArrival === null ? 'Unresolved' : '30 min'}</b></div><LivePlaceCard place={hotel} kind="hotel" heading={`Arrive at your stay · ${plan.brief.days! - 1} nights`} selected locked={plan.locks?.hotel} selectionBusy={busy} onLock={() => applySelection({ type:'set_lock', target:'hotel', locked:!plan.locks?.hotel })} onChange={() => setPicker({ kind:'hotel' })} subtitle={selectedStayArrival === null ? `${plan.brief.travellers} travellers · arrival/check-in time unresolved · room allocation to confirm` : `${plan.brief.travellers} travellers · 30-minute arrival/check-in buffer · room allocation to confirm`} estimate={estimates[hotel.id] ?? ''} onEstimate={value => updateEstimate(hotel.id, value)} /></div> : <p className="live-day-base" data-focus="hotel"><AppIcon name="hotel" size={16} /> Starting from {hotel.name}</p>)}
                <DayTimeline day={itineraryDay} dayIndex={index} first={index === 0} last={index === plan.days.length - 1} startMinutes={index === 0 ? selectedFirstDayStart : itineraryDay.meals?.some(meal => meal.type === 'breakfast') ? 480 : 600} hasOutboundTravel={Boolean(outbound || outboundFlight)} hasReturnTravel={Boolean(returning || returnFlight)} estimates={estimates} busy={busy} lockedActivityIds={plan.locks?.activityIds ?? []} onEstimate={updateEstimate} onLockActivity={(placeId, locked) => applySelection({ type:'set_activity_lock', placeId, locked })} onChangeActivity={(dayIndex, visitIndex) => setPicker({ kind:'activity', dayIndex, visitIndex })} />
                {plan.travel && returning && index === plan.days.length - 1 && <div className="live-timeline-event" data-focus="travel:return"><div className="live-time-rail"><strong>{time(returnDeparture)}</strong><span>{time(returnArrival)}</span><b>{returning.minutes} min</b></div><LiveTravelCard travel={plan.travel} direction="return" date={dateLabel(itineraryDay.date)} locked={plan.locks?.returnTravel} busy={busy} onLock={() => applySelection({ type:'set_lock', target:'returnTravel', locked:!plan.locks?.returnTravel })} onChange={() => setPicker({ kind:'travel', direction:'return' })} /></div>}
                {plan.brief.travelMode === 'flight' && !returnFlight && !returning && index === plan.days.length - 1 && <MissingFlightCard direction="return" plan={plan} busy={busy} onRetry={() => applySelection({ type:'retry_flights' })} onCompare={() => setPicker({ kind:'travel', direction:'return' })} />}
                {flight && returnFlight && index === plan.days.length - 1 && <><TransferEvent option={flight.returnFirstMile} label={`Drive from your stay to ${flight.destinationAirport.name}`} start={returnHotelDeparture} end={returnAirportArrival} focus="flight:return-first" /><div className="live-timeline-event live-buffer" data-focus="flight:return"><div className="live-time-rail"><strong>{time(returnAirportArrival)}</strong><span>{time(returnFlightDeparture)}</span><b>120 min</b></div><p><strong>Airport check-in buffer</strong><span>Planning assumption; confirm airline requirements</span></p></div><div className="live-timeline-event" data-focus="flight:return"><div className="live-time-rail"><strong>{time(returnFlightDeparture)}</strong><span>{time(returnFlightArrival)}</span><b>{returnFlight.durationMinutes} min</b></div><LiveFlightCard offer={returnFlight} direction="return" from={flight.destinationAirport} to={flight.originAirport} travellers={plan.brief.travellers!} locked={plan.locks?.returnFlight} selectionBusy={busy} onLock={() => applySelection({ type:'set_lock', target:'returnFlight', locked:!plan.locks?.returnFlight })} onChange={() => setPicker({ kind:'flight', direction:'return' })} /></div><TransferEvent option={flight.returnLastMile} label={`Drive from ${flight.originAirport.name} to your starting point`} start={returnFlightArrival} end={homeArrival} focus="flight:return-last" /></>}
              </section>)}
            </div>
            <aside className="live-map-panel" aria-label="Map beside itinerary"><header><div><AppIcon name="map-pin" size={18} /><strong>Your route on the map</strong></div><Badge tone="neutral">Day {day + 1}</Badge></header><div className="live-map-follow"><Button variant="text" aria-pressed={followMap} onClick={() => setFollowMap(value => !value)}>{followMap ? 'Following timeline · Pause' : 'Follow timeline'}</Button></div><LiveMap hotel={hotel} day={plan.days[day]} travel={plan.travel} flight={plan.flight} focus={focus} follow={followMap} /><p>Google Maps · route and local driving estimates</p><small>Checked {new Date(plan.checkedAt).toLocaleString()} · traffic and schedules depend on lookup assumptions</small></aside>
          </div>
        </>}
      </section>
    </div>
    {plan && picker && <LiveOptionDrawer plan={plan} picker={picker} busy={busy} onSelect={applySelection} onClose={closePicker} />}
  </main>;
}

function mealRouteNote(routeFit: NonNullable<LiveDay['meals']>[number]['routeFit']) {
  if (!routeFit) return 'Destination-wide restaurant search';
  if (routeFit.basis === 'destination_fallback') return 'Destination-wide fallback; route fit needs review';
  return routeFit.addedMinutes === undefined ? 'Searched along the surrounding route' : `Along the surrounding route · adds about ${routeFit.addedMinutes} min driving`;
}

function flightMinutes(value: string | undefined, offsetMinutes: number | undefined, date: string | undefined) {
  if (!value || offsetMinutes === undefined || !date) return null;
  return localClockMinutes(value, offsetMinutes, date);
}

function travelMinutes(option: LiveTravelOption | undefined, offsetMinutes: number | undefined, date: string | undefined, arrival = false) {
  if (!option || !date) return null;
  return localClockMinutes(arrival ? option.arrivalAt : option.departureAt, offsetMinutes, date);
}
