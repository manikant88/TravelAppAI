"use client";
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { emptyLiveBrief, isRenderableLivePlan, type LiveGenerationIssue, type LivePlan, type LiveRequest, type LiveDay, type LiveTravelOption, type LiveSelectionRequest, type LiveSelectionResponse } from '@/live/contracts';
import { requestLivePlan, requestLiveSelection } from './services/live-client';
import { LiveMap } from './live-map';
import { LivePlaceCard } from './live-place-card';
import { LiveRoadJourneyDay, LiveTravelCard } from './live-travel-routes';
import { itineraryGridClass, MapVisibilityToggle } from './map-visibility-toggle';
import { LiveFlightCard } from './live-flight-card';
import { LiveOptionDrawer, type LiveOptionPicker } from './live-option-drawer';
import { localClockMinutes, projectLiveDay, travelOptionInstant } from '@/live/timeline';
import { Badge, Button, Chip, IconButton } from './components/primitives';
import { AppIcon } from './components/app-icon';
import { liveEssentialReadiness, liveEssentialSuggestions, type LiveEssentialField } from '@/live/essentials';
import { currentLocationAnswer, LiveTripBriefBar, LiveTripEssentials, type BriefFact, type EssentialAnswer } from './live-trip-essentials';
import { scheduleInitialPrompt } from './auto-submit';
import { PlanningAnimation } from './planning-animation';
import { resolveDisplayedLivePlan } from './live-plan-state';
import './live-workspace.css';

type Message = LiveRequest['history'][number];
function time(minutes: number | null) {
  if (minutes === null) return 'Time unresolved';
  const dayOffset = Math.floor(minutes / 1440);
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
  const clock = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
  return dayOffset > 0 ? `${clock} +${dayOffset}d` : clock;
}
function activityTimingLabel(visit: LiveDay['visits'][number]) {
  if (visit.timingKind === 'fixed') return `${visit.durationMinutes} min · ${visit.timingEvidence?.label ?? 'Fixed commitment'}`;
  const profile = visit.durationProfile;
  return profile ? `Estimated ${profile.minimumMinutes}–${profile.maximumMinutes} min` : `Estimated ${visit.durationMinutes} min`;
}
function impactSummary(impact: NonNullable<LiveSelectionResponse['impact']>) {
  const parts = [
    impact.movedItems.length ? `${impact.movedItems.length} item${impact.movedItems.length === 1 ? '' : 's'} moved` : '',
    impact.transferChanges.length ? `${impact.transferChanges.length} transfer${impact.transferChanges.length === 1 ? '' : 's'} changed` : '',
    impact.mealChanges.length ? `${impact.mealChanges.length} meal time${impact.mealChanges.length === 1 ? '' : 's'} changed` : '',
    impact.usableTimeDeltaMinutes ? `${Math.abs(impact.usableTimeDeltaMinutes)} min usable time ${impact.usableTimeDeltaMinutes > 0 ? 'gained' : 'lost'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No downstream timing or transfer changes were required.';
}
function dateLabel(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
function planningPhase(progress: string, elapsed: number): 'scanning_route' | 'searching_stays' | 'searching_activities' | 'validating' {
  const value = progress.toLowerCase();
  if (value.includes('stay') || value.includes('hotel')) return 'searching_stays';
  if (value.includes('activit') || value.includes('experience') || value.includes('restaurant')) return 'searching_activities';
  if (value.includes('validat') || value.includes('schedul') || elapsed >= 12) return 'validating';
  return 'scanning_route';
}
function TransferEvent({ option, label, start, end, focus }: { option: LiveTravelOption | undefined; label: string; start: number | null; end: number | null; focus: string }) {
  return <div className="live-timeline-event" data-focus={focus}><div className="live-time-rail"><strong>{time(start)}</strong><span>{time(end)}</span><b>{option ? `${option.minutes} min` : 'Unresolved'}</b></div><div className="live-transfer"><AppIcon name="car" size={16} /><div><strong>{label}</strong><span>{option ? `${option.minutes} min driving${option.meters !== null ? ` · ${(option.meters / 1000).toFixed(1)} km` : ''}` : 'Road transfer unavailable'}</span></div></div></div>;
}
function MissingFlightCard({ direction, plan, busy, onRetry, onCompare }: { direction: 'outbound' | 'return'; plan: LivePlan; busy: boolean; onRetry(): void; onCompare(): void }) {
  const from = direction === 'outbound' ? plan.brief.origin : plan.brief.destination;
  const to = direction === 'outbound' ? plan.brief.destination : plan.brief.endIntent === 'continue_elsewhere' ? plan.brief.onwardDestination : plan.brief.origin;
  const directionLabel = direction === 'return' && plan.brief.endIntent === 'continue_elsewhere' ? 'Onward' : direction === 'outbound' ? 'Outbound' : 'Return';
  const date = direction === 'outbound' ? plan.days[0].date : plan.days.at(-1)!.date;
  const googleFlightsUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to} on ${date}`)}`;
  return <div className="live-timeline-event" data-focus={`flight:${direction}`}>
    <div className="live-time-rail"><strong>Time unresolved</strong><span>{dateLabel(date)}</span><b>Unresolved</b></div>
    <article className="itinerary-card itinerary-flight-card live-route-card live-unresolved-flight">
      <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true"><AppIcon name="flight" /></span><strong>{directionLabel} flight unavailable</strong></header>
      <div className="live-unresolved-body"><div><h4>{from} → {to}</h4><p>The flight search did not return a usable option. No flight, fare or arrival time has been assumed.</p></div><div className="live-unresolved-actions"><Button disabled={busy} onClick={onRetry}>Retry flights</Button><Button variant="secondary" disabled={busy || !plan.travel} onClick={onCompare}>Compare train, bus, cab &amp; self-drive</Button><a href={googleFlightsUrl} target="_blank" rel="noreferrer">Search Google Flights <AppIcon name="arrow-right" size={13} /></a></div></div>
      <footer className="live-route-footer"><span>No flight selected · Alternative routes remain available</span></footer>
    </article>
  </div>;
}
export function DayTimeline({ day, dayIndex, first, last, endsAtDestination = false, startMinutes, hasOutboundTravel, hasReturnTravel, estimates, busy, lockedActivityIds, lockedMealKeys, onEstimate, onLockActivity, onChangeActivity, onLockMeal, onChangeMeal }: { day: LiveDay; dayIndex: number; first: boolean; last: boolean; endsAtDestination?: boolean; startMinutes: number | null; hasOutboundTravel: boolean; hasReturnTravel: boolean; estimates: Record<string, string>; busy: boolean; lockedActivityIds: string[]; lockedMealKeys: string[]; onEstimate(id: string, value: string): void; onLockActivity(placeId: string, locked: boolean): void; onChangeActivity(dayIndex: number, visitIndex: number): void; onLockMeal(dayIndex: number, mealType: 'breakfast' | 'lunch' | 'dinner', locked: boolean): void; onChangeMeal(dayIndex: number, mealType: 'breakfast' | 'lunch' | 'dinner'): void }) {
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
      {waitMinutes !== null && waitMinutes >= 30 && <div className="live-timeline-event live-buffer" data-focus={`place:${visit.place.id}`}><div className="live-time-rail"><strong>{time(start === null ? null : start - waitMinutes)}</strong><span>{time(start)}</span></div><p><strong>{waitMinutes} min flexible time</strong><span>{visit.kind === 'meal' ? 'Meal remains inside its flexible window' : 'Reserved before a fixed-time item'}</span></p></div>}
      <div className="live-timeline-event" data-focus={`place:${visit.place.id}`}>
        <div className="live-time-rail"><strong>{time(start)}</strong><span>{time(end)}</span><b>{visit.durationMinutes} min</b></div>
        {visit.kind === 'meal'
          ? <LivePlaceCard place={visit.place} kind="meal" heading={`${visit.type[0].toUpperCase()}${visit.type.slice(1)} · ${visit.durationMinutes} min · ${time(start)}–${time(end)}`} subtitle={`${visit.hoursNote ?? 'Opening hours unavailable'} · ${visit.shiftedByMinutes ? `shifted ${Math.abs(visit.shiftedByMinutes)} min ${visit.shiftedByMinutes > 0 ? 'later' : 'earlier'} within the meal window · ` : ''}${mealRouteNote(visit.routeFit)} · ${visit.dietaryNote}`} estimate={estimates[visit.place.id] ?? ''} onEstimate={value => onEstimate(visit.place.id, value)} locked={lockedMealKeys.includes(`${dayIndex}:${visit.type}`)} selectionBusy={busy} onLock={() => onLockMeal(dayIndex, visit.type, !lockedMealKeys.includes(`${dayIndex}:${visit.type}`))} onChange={() => onChangeMeal(dayIndex, visit.type)} />
          : <LivePlaceCard place={visit.place} kind="activity" heading={`Stop ${visit.sourceIndex + 1} · ${activityTimingLabel(visit)} · ${time(start)}–${time(end)}`} subtitle={`${visit.hoursNote ?? 'Opening hours unavailable'} · ${visit.durationProfile ? `${visit.durationProfile.kind.replace('_', ' ')} duration (${visit.durationProfile.minimumMinutes}–${visit.durationProfile.maximumMinutes} min)` : 'estimated visit length'}${visit.durationProfile?.difficulty ? ` · ${visit.durationProfile.difficulty} difficulty` : ''}${visit.durationProfile?.daylightWindow ? ' · daylight-sensitive' : ''}${visit.mealCoverage ? ` · Includes ${visit.mealCoverage.type} · ${visit.mealCoverage.sourceLabel}: ${visit.mealCoverage.note}` : ''}`} estimate={estimates[visit.place.id] ?? ''} onEstimate={value => onEstimate(visit.place.id, value)} locked={lockedActivityIds.includes(visit.place.id)} selectionBusy={busy} onLock={() => onLockActivity(visit.place.id, !lockedActivityIds.includes(visit.place.id))} onChange={() => onChangeActivity(dayIndex, visit.sourceIndex)} />}
      </div>
    </div>)}
    {rows.length > 0 && <>
      <div className="live-timeline-event" data-focus={`leg:${rows.length}`}><div className="live-time-rail"><strong>{time(returnDeparture)}</strong><span>{time(returnArrival)}</span></div><div className="live-transfer"><AppIcon name="hotel" size={16} /><div><strong>Return to stay</strong><span>{back?.minutes != null ? `${back.minutes} min driving` : 'Duration unknown'}</span></div></div></div>
      <div className="live-timeline-event live-buffer" data-focus="hotel"><div className="live-time-rail"><strong>{time(returnArrival)}</strong><span>{time(end)}</span></div><p><strong>15 min buffer · settle in</strong><span>Planned block ends {time(end)}</span></p></div>
    </>}
    {!rows.length && <p>No visits planned for this day. Needs review.</p>}
    {day.capacityNote ? <p className="live-capacity-note"><AppIcon name="dot" size={14} /> {day.capacityNote}</p> : null}
    {day.findings?.length ? <ul className="live-schedule-findings" aria-label="Schedule checks">{day.findings.map(finding => <li key={finding.id} data-severity={finding.severity}><strong>{finding.severity}</strong> {finding.message}</li>)}</ul> : null}
    <p className="live-timing-note">Meal times are planning targets; menus, dietary handling and prices require confirmation.{last ? endsAtDestination ? ' Checkout timing still needs confirmation.' : hasReturnTravel ? ' Checkout timing and the suggested later journey still need confirmation.' : ' Checkout and later travel remain unresolved.' : ''}</p>
  </div>;
}
export default function LiveWorkspace({ initialPrompt = '', autoSubmitInitialPrompt = false }: { initialPrompt?: string; autoSubmitInitialPrompt?: boolean }) {
  const [brief, setBrief] = useState(emptyLiveBrief);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(initialPrompt);
  const [plan, setPlan] = useState<LivePlan>();
  const [planningIssue, setPlanningIssue] = useState<LiveGenerationIssue>();
  const [planNeedsRefresh, setPlanNeedsRefresh] = useState(false);
  const [day, setDay] = useState(0);
  const [focus, setFocus] = useState('hotel');
  const [followMap, setFollowMap] = useState(true);
  const [mapVisible, setMapVisible] = useState(true);
  const results = useRef<HTMLElement>(null);
  const daysNav = useRef<HTMLElement>(null);
  const [estimates, setEstimates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [briefInterpreted, setBriefInterpreted] = useState(false);
  const [editingFact, setEditingFact] = useState<BriefFact>();
  const [picker, setPicker] = useState<LiveOptionPicker>();
  const [pendingConfirmation, setPendingConfirmation] = useState<NonNullable<LiveSelectionResponse['confirmation']>>();
  const [lastImpact, setLastImpact] = useState<LiveSelectionResponse['impact']>();
  const closePicker = useCallback(() => { setPicker(undefined); setPendingConfirmation(undefined); }, []);
  const controller = useRef<AbortController | null>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const didAutoSubmit = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
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
  const sendMessage = useCallback(async (rawMessage: string) => {
    if (controller.current || !rawMessage.trim()) return;
    const message = rawMessage.trim(); const previous = messages; const startedAt = Date.now();
    setMessages([...previous, { role: 'user', text: message }]); setText(''); setBusy(true);
    const current = new AbortController(); controller.current = current;
    try {
      const result = await requestLivePlan({ phase: 'live', message, brief, history: previous.slice(-12) }, current.signal, setProgress);
      const remainingPresentationTime = 900 - (Date.now() - startedAt);
      if (remainingPresentationTime > 0) await new Promise(resolve => window.setTimeout(resolve, remainingPresentationTime));
      if (current.signal.aborted) return;
      setBrief(result.brief);
      setBriefInterpreted(true);
      if (result.plan && isRenderableLivePlan(result.plan)) {
        setPlan(result.plan); setPlanningIssue(undefined); setPlanNeedsRefresh(false); setDay(0); setEstimates({}); setLastImpact(undefined);
      } else if (result.plan) {
        const displayed = resolveDisplayedLivePlan(plan, result.plan);
        setPlan(displayed.plan); setPlanningIssue(result.plan.generationIssue ?? { code: 'selection_invalid', message: result.message }); setPlanNeedsRefresh(displayed.preservedPrevious); setPicker(undefined); setLastImpact(undefined);
      } else {
        setPlanningIssue(liveEssentialReadiness(result.brief).ready ? { code: 'blocking_constraints', message: result.message } : undefined);
        if (plan && JSON.stringify(result.brief) !== JSON.stringify(plan.brief)) setPlanNeedsRefresh(true);
      }
      setMessages(m => [...m, { role: 'assistant', text: result.message }]);
    } catch (error) {
      setMessages(m => [...m, { role: 'assistant', text: current.signal.aborted ? 'Search cancelled. Your previous plan is unchanged.' : error instanceof Error ? error.message : 'Live search failed.' }]);
      setText(message);
    } finally { controller.current = null; setBusy(false); setProgress(''); }
  }, [brief, messages, plan]);
  useEffect(() => {
    if (!autoSubmitInitialPrompt || didAutoSubmit.current || !initialPrompt.trim()) return;
    return scheduleInitialPrompt(() => {
      if (didAutoSubmit.current) return;
      didAutoSubmit.current = true;
      void sendMessage(initialPrompt);
    });
  }, [autoSubmitInitialPrompt, initialPrompt, sendMessage]);
  function submit(event: FormEvent) { event.preventDefault(); void sendMessage(text); }
  function editBrief(field: LiveEssentialField) {
    const fact = field === 'travellers' ? 'guests' : field === 'origin' || field === 'destination' || field === 'dates' ? field : field === 'transport' || field === 'trip_end' || field === 'onward_destination' || field === 'end_transport' || field === 'dining' || field === 'pace' ? 'preferences' : undefined;
    if (fact) { setEditingFact(fact); return; }
    const prompts: Record<LiveEssentialField, string> = {
      destination: 'Change my destination to ', origin: 'Change my origin to ', dates: 'Change my travel dates to ',
      travellers: 'Change the traveller count to ', transport: 'Change my travel preference to ', pickup: 'Change my starting point to ',
      trip_end: 'After this destination, I want to ', onward_destination: 'My next destination is ', end_transport: 'For the journey after this destination, I prefer ',
      dining: 'Change my dining preference to ', pace: 'Change my trip pace to ',
    };
    setText(prompts[field]);
    requestAnimationFrame(() => composer.current?.focus());
  }
  function locatePickup(): Promise<EssentialAnswer | undefined> {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        setMessages(previous => [...previous, { role: 'assistant', text: 'Your browser cannot share its current location. Add a neighbourhood, landmark or address in chat instead.' }]);
        resolve(undefined);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        position => resolve(currentLocationAnswer(position.coords.latitude, position.coords.longitude)),
        () => {
          setMessages(previous => [...previous, { role: 'assistant', text: 'I couldn’t access your current location. You can allow location access and try again, or add a neighbourhood, landmark or address in chat.' }]);
          resolve(undefined);
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    });
  }
  async function applySelection(command: LiveSelectionRequest['command']): Promise<boolean> {
    if (!plan || controller.current) return false;
    setBusy(true); setProgress(command.type === 'set_lock' || command.type === 'set_activity_lock' ? 'Updating itinerary lock…' : 'Refreshing affected routes and timeline…');
    const current = new AbortController(); controller.current = current;
    try {
      const result = await requestLiveSelection({ phase: 'live-selection', plan, command }, current.signal);
      if (current.signal.aborted) return false;
      setLastImpact(result.impact);
      if (result.confirmation) {
        setPendingConfirmation(result.confirmation);
        setMessages(previous => [...previous, { role: 'assistant', text: result.message }]);
        return false;
      }
      setPlan(result.plan); setPlanNeedsRefresh(false);
      setPendingConfirmation(undefined);
      setMessages(previous => [...previous, { role: 'assistant', text: result.message }]);
      if (result.impact?.status === 'blocking') return false;
      return true;
    } catch (error) {
      setMessages(previous => [...previous, { role: 'assistant', text: error instanceof Error ? error.message : 'The selection could not be safely applied.' }]);
      return false;
    } finally { controller.current = null; setBusy(false); setProgress(''); }
  }
  const hotel = plan?.hotels.find(h => h.id === plan.selectedHotelId);
  const outbound = plan?.travel?.outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
  const returning = plan?.travel?.return.find(option => option.id === plan.travel?.suggestedReturnId);
  const outboundRoad = plan?.travel?.outboundRoadPlan;
  const endRoad = plan?.travel?.endRoadPlan;
  const arrivalDayIndex = outboundRoad ? outboundRoad.travelDays - 1 : 0;
  const endJourneyDayIndex = endRoad ? plan!.days.length - endRoad.travelDays : plan ? plan.days.length - 1 : 0;
  const destinationStayNights = Math.max(0, endJourneyDayIndex - arrivalDayIndex);
  const outboundDeparture = outboundRoad?.segments[0].departureMinutes ?? travelMinutes(outbound, plan?.travel?.origin.utcOffsetMinutes, plan?.days[0]?.date);
  const outboundArrival = outboundRoad?.segments.at(-1)?.arrivalMinutes ?? travelMinutes(outbound, plan?.travel?.destination.utcOffsetMinutes, plan?.days[arrivalDayIndex]?.date, true);
  const firstDayStart = outbound ? outboundArrival === null ? null : outboundArrival + 30 : null;
  const returnDeparture = endRoad?.segments[0].departureMinutes ?? travelMinutes(returning, plan?.travel?.destination.utcOffsetMinutes, plan?.days[endJourneyDayIndex]?.date);
  const returnArrival = endRoad?.segments.at(-1)?.arrivalMinutes ?? travelMinutes(returning, plan?.travel?.endDestination?.utcOffsetMinutes ?? plan?.travel?.origin.utcOffsetMinutes, plan?.days.at(-1)?.date, true);
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
  const returnFlightArrival = flightMinutes(returnFlight?.arrivalAt, flight?.endDestinationAirport?.utcOffsetMinutes ?? flight?.originAirport.utcOffsetMinutes, plan?.days.at(-1)?.date);
  const homeArrival = returnFlightArrival === null || !flight?.returnLastMile ? null : returnFlightArrival + flight.returnLastMile.minutes;
  const selectedStayArrival = outboundFlight ? stayArrival : outboundArrival;
  const selectedFirstDayStart = outboundFlight ? flightDayStart : firstDayStart;
  const chatSuggestions = !busy && !plan && briefInterpreted ? liveEssentialSuggestions(brief) : [];
  function updateEstimate(id: string, value: string) { setEstimates(previous => ({ ...previous, [id]: value })); }
  return <main className="live-shell">
    <header className="live-header"><Link className="mmt-logo-link" href="/" aria-label="Trip planner home"><Image className="mmt-logo" src="/figma/itinerary/mmt-logo.png" alt="MakeMyTrip" width={169} height={40} priority /></Link><Badge tone="info"><AppIcon name="sparkles" size={13} /> Live planning</Badge></header>
    <div className="live-layout">
      <section className="live-chat planner-panel" aria-label="Planning conversation">
        {!messages.length && !busy ? <div className="live-chat-intro"><h1>Plan your trip</h1><p>Start from a destination on the <Link href="/">globe</Link>, complete the Trip Brief, or describe everything here.</p></div> : null}
        <div className="live-messages conversation" ref={conversation} aria-live="polite">
          {messages.map((m, i) => <div className={`message message-${m.role}`} key={i}><p>{m.text}</p></div>)}
          {busy && <p className="live-search-status" role="status"><AppIcon name="sparkles" size={16} /> {progress || 'Starting live planning…'}</p>}
        </div>
        {chatSuggestions.length ? <div className="conversation-actions" aria-label="Suggested answers">{chatSuggestions.map(suggestion => <Chip className="guided-action-chip" key={suggestion.label} onClick={() => {
          if (suggestion.action === 'compose_pickup') { editBrief('pickup'); return; }
          if (suggestion.action === 'current_location') { void locatePickup().then(answer => { if (answer) void sendMessage(answer.message); }); return; }
          void sendMessage(suggestion.message);
        }}>{suggestion.label}</Chip>)}</div> : null}
        <form className="conversation-composer live-composer" onSubmit={submit}>
          <label htmlFor="live-message">Ask anything</label>
          <div><textarea ref={composer} id="live-message" rows={2} maxLength={1200} value={text} onChange={event => setText(event.target.value)} placeholder={plan ? 'Ask why, or request a change…' : 'Describe the trip you have in mind…'} disabled={busy} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !busy) { event.preventDefault(); void sendMessage(text); } }} />
            {busy ? <IconButton type="button" className="live-stop-button" aria-label="Stop planning" onClick={() => controller.current?.abort()}><AppIcon name="stop" size={13} fill="currentColor" /></IconButton> : <IconButton type="submit" aria-label="Send message" disabled={!text.trim()}><Image src="/figma/arrow-up.svg" alt="" width={24} height={24} /></IconButton>}
          </div>
          <small>Draft stays in this session. Refreshing clears it.</small>
        </form>
      </section>
      <section className="live-results" ref={results} aria-label={plan ? 'Live itinerary' : 'Trip setup'}>
        {briefInterpreted ? <LiveTripBriefBar key={JSON.stringify(brief)} brief={brief} busy={busy} editing={editingFact} onEditingChange={setEditingFact} onSubmit={message => void sendMessage(message)} onPrefill={message => { setText(message); requestAnimationFrame(() => composer.current?.focus()); }} /> : null}
        {!plan && busy ? <section className="planning-state"><PlanningAnimation phase={planningPhase(progress, elapsed)} origin={brief.origin} status={progress || 'Understanding the places, dates, travellers, and preferences you shared'} /><div className="planning-meta"><span className="live-dot" />Working for {elapsed}s</div></section> : null}
        {!plan && !busy && briefInterpreted ? <LiveTripEssentials brief={brief} busy={busy} planningIssue={planningIssue} onEdit={editBrief} onSubmit={message => void sendMessage(message)} onLocate={locatePickup} /> : null}
        {!plan && !busy && !briefInterpreted ? <div className="live-empty"><span className="eyebrow">{messages.length ? 'TRY AGAIN' : 'YOUR NEXT ADVENTURE'}</span><h2>{messages.length ? 'Planning couldn’t start this time.' : <>Start with an idea.<br />Make it a trip.</>}</h2><p>{messages.length ? 'Your request is still in chat and the composer. Retry it when ready; no Trip Brief details were changed.' : 'Share a destination, dates, and who is coming. The planner will interpret your message before showing any Trip Brief fields.'}</p></div> : null}
        {plan && <>
          <header className="live-trip-heading"><div><p className="eyebrow">YOUR TRIP</p><h2>{plan.brief.destination}</h2><p>From {plan.brief.origin} · {dateLabel(plan.brief.startDate!)} – {dateLabel(plan.days.at(-1)!.date)} · {plan.brief.travellers} travellers · {destinationStayNights} destination night{destinationStayNights === 1 ? '' : 's'} · {plan.scheduling?.pace ?? 'balanced'} pace{plan.scheduling?.paceDefaulted ? ' (default)' : ''}</p></div><Badge tone="warning">{planNeedsRefresh ? 'Previous plan' : 'Provisional plan'}</Badge></header>
          {lastImpact ? <section className="live-impact-summary" data-status={lastImpact.status} aria-live="polite"><strong>Last itinerary change · {lastImpact.status}</strong><span>{impactSummary(lastImpact)}</span></section> : null}
          {planNeedsRefresh ? <p className="live-plan-stale" role="status"><AppIcon name="alert-circle" size={16} /> Your request has changed. This is the previous plan until you answer the clarification and a new plan is built.</p> : null}
          {plan.eveningPrompt && plan.eveningOptions?.length ? <section className="live-evening-suggestion" aria-label="Optional evening ideas"><div><AppIcon name="sparkles" size={17} /><p><strong>Optional evening ideas</strong><span>{plan.eveningOptions.slice(0, 3).map(option => option.name).join(' · ')}</span><small>{plan.eveningPrompt}</small></p></div><Button variant="secondary" onClick={() => setText(plan.brief.dayRhythm === 'nightlife' ? 'Add a nightlife option to one suitable evening and recalculate the return to my stay.' : 'Show me suitable evening experiences and how they would affect the itinerary.')}>Explore in chat</Button></section> : null}
          <details className="live-review"><summary><AppIcon name="alert-circle" size={16} /> A few details still to confirm <span>Travel, prices &amp; timing</span></summary><ul>{plan.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>
          <nav className="live-days" ref={daysNav} aria-label="Jump to itinerary day">{plan.days.map((d, i) => <Chip key={d.date} aria-pressed={day === i} onClick={() => jumpToDay(i)}>Day {i + 1} · {dateLabel(d.date)}</Chip>)}<MapVisibilityToggle visible={mapVisible} onToggle={() => setMapVisible(value => !value)} /></nav>
          <div className={itineraryGridClass(mapVisible)}>
            <div className="live-card-column">
              {plan.days.map((itineraryDay, index) => <section className="live-day-section" data-day={index} key={itineraryDay.date} aria-label={`Day ${index + 1}, ${dateLabel(itineraryDay.date)}`}>
                <div className="live-section-heading"><h3>{outboundRoad && index < arrivalDayIndex ? `Day ${index + 1} · journey to ${plan.brief.destination}` : endRoad && index >= endJourneyDayIndex ? `Day ${index + 1} · ${plan.brief.endIntent === 'continue_elsewhere' ? `onward to ${plan.brief.onwardDestination}` : `return to ${plan.brief.origin}`}` : `Day ${index + 1} in ${plan.brief.destination}`}</h3><span>{dateLabel(itineraryDay.date)}</span></div>
                {plan.brief.travelMode === 'flight' && !outboundFlight && !outbound && index === 0 && <MissingFlightCard direction="outbound" plan={plan} busy={busy} onRetry={() => applySelection({ type:'retry_flights' })} onCompare={() => setPicker({ kind:'travel', direction:'outbound' })} />}
                {outboundRoad?.status === 'not_feasible' && !outbound && index === 0 ? <RoadFeasibilityNotice message={outboundRoad.message} onCompare={() => setPicker({ kind:'travel', direction:'outbound' })} /> : null}
                {plan.travel && outbound && index === 0 && !outboundRoad && <div className="live-timeline-event" data-focus="travel:outbound"><div className="live-time-rail"><strong>{time(outboundDeparture)}</strong><span>{time(outboundArrival)}</span><b>{outbound.minutes} min</b></div><LiveTravelCard travel={plan.travel} direction="outbound" date={dateLabel(itineraryDay.date)} locked={plan.locks?.outboundTravel} busy={busy} onLock={() => applySelection({ type:'set_lock', target:'outboundTravel', locked:!plan.locks?.outboundTravel })} onChange={() => setPicker({ kind:'travel', direction:'outbound' })} /></div>}
                {flight && outboundFlight && index === 0 && <><TransferEvent option={flight.outboundFirstMile} label={`Drive to ${flight.originAirport.name}`} start={pickupDeparture} end={airportArrival} focus="flight:outbound-first" /><div className="live-timeline-event live-buffer" data-focus="flight:outbound"><div className="live-time-rail"><strong>{time(airportArrival)}</strong><span>{time(flightDeparture)}</span><b>120 min</b></div><p><strong>Airport check-in buffer</strong><span>Planning assumption; confirm airline requirements</span></p></div><div className="live-timeline-event" data-focus="flight:outbound"><div className="live-time-rail"><strong>{time(flightDeparture)}</strong><span>{time(flightArrival)}</span><b>{outboundFlight.durationMinutes} min</b></div><LiveFlightCard offer={outboundFlight} direction="outbound" from={flight.originAirport} to={flight.destinationAirport} travellers={plan.brief.travellers!} locked={plan.locks?.outboundFlight} selectionBusy={busy} onLock={() => applySelection({ type:'set_lock', target:'outboundFlight', locked:!plan.locks?.outboundFlight })} onChange={() => setPicker({ kind:'flight', direction:'outbound' })} /></div><TransferEvent option={flight.outboundLastMile} label={`Drive from ${flight.destinationAirport.name} to your stay`} start={flightArrival} end={stayArrival} focus="flight:outbound-last" /></>}
                {outboundRoad?.segments[index] ? <LiveRoadJourneyDay segment={outboundRoad.segments[index]} destination={plan.brief.destination!} direction="outbound" finalDay={index === arrivalDayIndex} showActions={index === 0} locked={plan.locks?.outboundTravel} busy={busy} onLock={() => applySelection({ type:'set_lock', target:'outboundTravel', locked:!plan.locks?.outboundTravel })} onChange={() => setPicker({ kind:'travel', direction:'outbound' })} /> : null}
                {hotel && (index === arrivalDayIndex ? <div className="live-timeline-event" data-focus="hotel"><div className="live-time-rail"><strong>{time(selectedStayArrival)}</strong><span>{time(selectedFirstDayStart)}</span><b>{selectedStayArrival === null ? 'Unresolved' : '30 min'}</b></div><LivePlaceCard place={hotel} kind="hotel" heading={`Arrive at your stay · ${destinationStayNights} night${destinationStayNights === 1 ? '' : 's'}`} selected locked={plan.locks?.hotel} selectionBusy={busy} onLock={() => applySelection({ type:'set_lock', target:'hotel', locked:!plan.locks?.hotel })} onChange={() => setPicker({ kind:'hotel' })} subtitle={selectedStayArrival === null ? `${plan.brief.travellers} travellers · arrival/check-in time unresolved · room allocation to confirm` : `${plan.brief.travellers} travellers · 30-minute arrival/check-in buffer · room allocation to confirm`} estimate={estimates[hotel.id] ?? ''} onEstimate={value => updateEstimate(hotel.id, value)} /></div> : index > arrivalDayIndex && index < endJourneyDayIndex ? <p className="live-day-base" data-focus="hotel"><AppIcon name="hotel" size={16} /> Starting from {hotel.name}</p> : null)}
                {!(outboundRoad && index < arrivalDayIndex) && !(endRoad && index >= endJourneyDayIndex) ? <DayTimeline day={itineraryDay} dayIndex={index} first={index === 0} last={index === plan.days.length - 1} endsAtDestination={plan.brief.endIntent === 'end_at_destination'} startMinutes={itineraryDay.availableStartMinutes !== undefined ? itineraryDay.availableStartMinutes : index === 0 ? selectedFirstDayStart : 480} hasOutboundTravel={Boolean(outbound || outboundFlight)} hasReturnTravel={Boolean(returning || returnFlight)} estimates={estimates} busy={busy} lockedActivityIds={plan.locks?.activityIds ?? []} lockedMealKeys={plan.locks?.mealKeys ?? []} onEstimate={updateEstimate} onLockActivity={(placeId, locked) => applySelection({ type:'set_activity_lock', placeId, locked })} onChangeActivity={(dayIndex, visitIndex) => setPicker({ kind:'activity', dayIndex, visitIndex })} onLockMeal={(dayIndex, mealType, locked) => applySelection({ type:'set_meal_lock', dayIndex, mealType, locked })} onChangeMeal={(dayIndex, mealType) => setPicker({ kind:'meal', dayIndex, mealType })} /> : null}
                {plan.travel && returning && index === endJourneyDayIndex && !endRoad && <div className="live-timeline-event" data-focus="travel:return"><div className="live-time-rail"><strong>{time(returnDeparture)}</strong><span>{time(returnArrival)}</span><b>{returning.minutes} min</b></div><LiveTravelCard travel={plan.travel} direction="return" date={dateLabel(itineraryDay.date)} locked={plan.locks?.returnTravel} busy={busy} onLock={() => applySelection({ type:'set_lock', target:'returnTravel', locked:!plan.locks?.returnTravel })} onChange={() => setPicker({ kind:'travel', direction:'return' })} /></div>}
                {endRoad?.segments[index - endJourneyDayIndex] ? <LiveRoadJourneyDay segment={endRoad.segments[index - endJourneyDayIndex]} destination={plan.brief.endIntent === 'continue_elsewhere' ? plan.brief.onwardDestination! : plan.brief.origin!} direction="return" finalDay={index === plan.days.length - 1} showActions={index === endJourneyDayIndex} locked={plan.locks?.returnTravel} busy={busy} onLock={() => applySelection({ type:'set_lock', target:'returnTravel', locked:!plan.locks?.returnTravel })} onChange={() => setPicker({ kind:'travel', direction:'return' })} /> : null}
                {plan.brief.endIntent !== 'end_at_destination' && plan.brief.endTravelMode === 'flight' && !returnFlight && !returning && index === plan.days.length - 1 && <MissingFlightCard direction="return" plan={plan} busy={busy} onRetry={() => applySelection({ type:'retry_flights' })} onCompare={() => setPicker({ kind:'travel', direction:'return' })} />}
                {flight && returnFlight && index === plan.days.length - 1 && <><TransferEvent option={flight.returnFirstMile} label={`Drive from your stay to ${flight.destinationAirport.name}`} start={returnHotelDeparture} end={returnAirportArrival} focus="flight:return-first" /><div className="live-timeline-event live-buffer" data-focus="flight:return"><div className="live-time-rail"><strong>{time(returnAirportArrival)}</strong><span>{time(returnFlightDeparture)}</span><b>120 min</b></div><p><strong>Airport check-in buffer</strong><span>Planning assumption; confirm airline requirements</span></p></div><div className="live-timeline-event" data-focus="flight:return"><div className="live-time-rail"><strong>{time(returnFlightDeparture)}</strong><span>{time(returnFlightArrival)}</span><b>{returnFlight.durationMinutes} min</b></div><LiveFlightCard offer={returnFlight} direction="return" journeyLabel={plan.brief.endIntent === 'continue_elsewhere' ? 'onward' : 'return'} from={flight.destinationAirport} to={flight.endDestinationAirport ?? flight.originAirport} travellers={plan.brief.travellers!} locked={plan.locks?.returnFlight} selectionBusy={busy} onLock={() => applySelection({ type:'set_lock', target:'returnFlight', locked:!plan.locks?.returnFlight })} onChange={() => setPicker({ kind:'flight', direction:'return' })} /></div><TransferEvent option={flight.returnLastMile} label={`Drive from ${(flight.endDestinationAirport ?? flight.originAirport).name} to ${(flight.endDestination ?? flight.origin).name}`} start={returnFlightArrival} end={homeArrival} focus="flight:return-last" /></>}
              </section>)}
            </div>
            {mapVisible ? <aside className="live-map-panel" aria-label="Map beside itinerary"><header><div><AppIcon name="map-pin" size={18} /><strong>Your route on the map</strong></div><Badge tone="neutral">Day {day + 1}</Badge></header><div className="live-map-follow"><Button variant="text" aria-pressed={followMap} onClick={() => setFollowMap(value => !value)}>{followMap ? 'Following timeline · Pause' : 'Follow timeline'}</Button></div><LiveMap hotel={hotel} day={plan.days[day]} travel={plan.travel} flight={plan.flight} focus={focus} follow={followMap} roadJourney={outboundRoad?.segments[day] ? { direction:'outbound', plan:outboundRoad, segment:outboundRoad.segments[day] } : endRoad?.segments[day - endJourneyDayIndex] ? { direction:'return', plan:endRoad, segment:endRoad.segments[day - endJourneyDayIndex] } : undefined} /><p>Google Maps · route and local driving estimates</p><small>Checked {new Date(plan.checkedAt).toLocaleString()} · traffic and schedules depend on lookup assumptions</small></aside> : null}
          </div>
        </>}
      </section>
    </div>
    {plan && picker && <LiveOptionDrawer plan={plan} picker={picker} busy={busy} onSelect={applySelection} onClose={closePicker} />}
    {pendingConfirmation && <aside className="live-constraint-confirm" role="alertdialog" aria-modal="true" aria-labelledby="constraint-confirm-title">
      <h3 id="constraint-confirm-title">Review schedule conflict</h3>
      <p>{impactSummary(pendingConfirmation.impact)}</p>
      <ul>{pendingConfirmation.findings.map(finding => <li key={finding.id}>{finding.message}</li>)}</ul>
      <div><Button variant="secondary" onClick={() => setPendingConfirmation(undefined)} disabled={busy}>Keep current option</Button><Button onClick={async () => { const applied = await applySelection(pendingConfirmation.command); if (applied) { setPicker(undefined); setPendingConfirmation(undefined); } }} disabled={busy}>Apply anyway</Button></div>
    </aside>}
  </main>;
}

function RoadFeasibilityNotice({ message, onCompare }: { message: string; onCompare(): void }) {
  return <section className="road-feasibility-notice" role="status"><AppIcon name="alert-circle" size={18} /><div><strong>This road journey does not fit the current dates</strong><p>{message} Extend the dates, choose a faster mode, or make the journey itself part of the trip.</p><Button variant="secondary" size="sm" onClick={onCompare}>Compare travel options</Button></div></section>;
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
  return localClockMinutes(travelOptionInstant(option, arrival ? 'arrival' : 'departure'), offsetMinutes, date);
}
