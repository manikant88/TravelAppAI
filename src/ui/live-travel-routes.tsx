import type { AppIconName } from './components/app-icon';
import { AppIcon } from './components/app-icon';
import { Button } from './components/primitives';
import type { LiveRoadJourneySegment, LiveTravel, LiveTravelOption } from '@/live/contracts';
import { travelOptionInstant } from '@/live/timeline';

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
}

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${currency} ${amount}`; }
}

function localTime(value: string | undefined, offsetMinutes: number | undefined) {
  if (!value || offsetMinutes === undefined) return 'Time unresolved';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return 'Time unresolved';
  const shifted = new Date(instant.getTime() + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(shifted);
}
function clock(minutes: number) { const normalized = ((minutes % 1440) + 1440) % 1440; const hour = Math.floor(normalized / 60); const minute = normalized % 60; return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2020, 0, 1, hour, minute))); }

function optionIcon(option: LiveTravelOption): AppIconName {
  if (option.mode === 'drive') return 'car';
  return option.transitModes.some(mode => mode.includes('TRAIN') || mode === 'RAIL' || mode === 'SUBWAY') ? 'train' : 'bus';
}

function directionsUrl(travel: LiveTravel, option: LiveTravelOption) {
  const from = option.direction === 'outbound' ? travel.origin : travel.destination;
  const to = option.direction === 'outbound' ? travel.destination : travel.endDestination ?? travel.origin;
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${option.mode === 'drive' ? 'driving' : 'transit'}`;
}

export function LiveTravelCard({ travel, direction, date, optionId, selected = true, locked = false, busy = false, showRoadPlan = true, onLock, onChange, onSelect, decisionNote }: { travel: LiveTravel; direction: 'outbound' | 'return'; date: string; optionId?: string; selected?: boolean; locked?: boolean; busy?: boolean; showRoadPlan?: boolean; onLock?(): void; onChange?(): void; onSelect?(): void; decisionNote?: string }) {
  const id = optionId ?? (direction === 'outbound' ? travel.suggestedOutboundId : travel.suggestedReturnId);
  const options = direction === 'outbound' ? travel.outbound : travel.return;
  const option = options.find(candidate => candidate.id === id);
  if (!option) return null;
  const from = direction === 'outbound' ? travel.origin : travel.destination;
  const to = direction === 'outbound' ? travel.destination : travel.endDestination ?? travel.origin;
  const roadPlan = direction === 'outbound' ? travel.outboundRoadPlan : travel.endRoadPlan;
  const departureLabel = roadPlan ? clock(roadPlan.segments[0].departureMinutes) : localTime(travelOptionInstant(option, 'departure'), from.utcOffsetMinutes);
  const arrivalLabel = roadPlan ? clock(roadPlan.segments.at(-1)!.arrivalMinutes) : localTime(travelOptionInstant(option, 'arrival'), to.utcOffsetMinutes);
  const arrivalDate = roadPlan?.segments.at(-1)?.date;
  const icon = optionIcon(option);
  const directionLabel = direction === 'return' && travel.endIntent === 'continue_elsewhere' ? 'onward' : direction;
  return <article className={`itinerary-card itinerary-flight-card live-route-card ${selected ? 'is-suggested' : ''}`}>
    <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true"><AppIcon name={icon} /></span><strong>{selected ? 'Suggested' : 'Alternative'} {directionLabel} travel · {option.label} · {duration(option.minutes)}</strong><div className="live-card-actions">{onLock && <Button variant="text" size="sm" aria-pressed={locked} disabled={busy} onClick={onLock}>{locked ? 'Unlock' : 'Lock'}</Button>}{onLock && (onChange || onSelect) && <span aria-hidden="true">·</span>}{onChange && <Button variant="text" size="sm" disabled={busy || locked} onClick={onChange}>Change</Button>}{onSelect && <Button size="sm" disabled={busy} onClick={onSelect}>Select travel</Button>}</div></header>
    <div className="flight-card-body">
      <div className="airline-mark"><AppIcon name={icon} size={28} aria-label={option.label} /></div>
      <div className="flight-stop"><strong>{departureLabel}</strong><span>{date}</span><small>{from.name}</small></div>
      <div className="flight-line"><i /><span><AppIcon name="arrow-right" size={15} /></span></div>
      <div className="flight-stop"><strong>{arrivalLabel}</strong><span>{arrivalDate ? `${arrivalDate} · planned with rests` : option.timingKind === 'scheduled' ? 'Scheduled' : 'Estimated'}</span><small>{to.name}</small></div>
      <dl className="flight-facts"><div><dt>Duration</dt><dd>{duration(option.minutes)}</dd></div>{option.meters !== null && <div><dt>Distance</dt><dd>{(option.meters / 1000).toFixed(0)} km</dd></div>}{!!option.transitLines.length && <div><dt>Lines</dt><dd>{option.transitLines.join(' · ')}</dd></div>}</dl>
      <div className="card-price"><strong>{option.fare ? money(option.fare.amount, option.fare.currency) : option.roadUse === 'cab' ? 'Cab fare unavailable' : option.mode === 'drive' ? 'Cost not estimated' : 'Fare not provided'}</strong><span>{option.fare ? 'Google-returned fare' : option.roadUse === 'cab' ? 'route duration only; cab availability unverified' : option.mode === 'drive' ? 'fuel, tolls and parking excluded' : 'ticket price unavailable'}</span></div>
    </div>
    <div className="card-grounding"><i aria-hidden="true"><AppIcon name="sparkles" size={17} /></i><div><span>{decisionNote ?? `${travel.selectionReason} ${option.timingKind === 'estimated' ? 'Departure and arrival are planning estimates.' : 'Times are from the returned public-transit schedule.'} This does not confirm a ticket or seat.`}</span></div></div>
    {roadPlan && showRoadPlan ? <div className={`road-journey-plan is-${roadPlan.status}`}><strong>{roadPlan.message}</strong><ol>{roadPlan.segments.map(segment => <li key={segment.date}><span>Day {segment.dayOffset + 1} · {segment.date}</span><b>{duration(segment.driveMinutes)} driving</b><small>{duration(segment.breakMinutes)} breaks{segment.mealBreaks.length ? ` · ${segment.mealBreaks.join(' and ')}` : ''}{segment.overnightRestMinutes ? ` · overnight rest${segment.transitStay ? ` near ${segment.transitStay.name}${segment.transitStay.stayOffer ? ' · dated stay available' : ' · availability to confirm'}` : ' stop to confirm'}` : ''}</small></li>)}</ol></div> : null}
    <footer className="live-route-footer"><span>Google Routes · checked {new Date(option.checkedAt).toLocaleString()}</span><a href={directionsUrl(travel, option)} target="_blank" rel="noreferrer">View route <AppIcon name="arrow-right" size={13} /></a></footer>
  </article>;
}

export function LiveRoadJourneyDay({ segment, destination, direction, finalDay, showActions = false, locked = false, busy = false, onLock, onChange }: { segment: LiveRoadJourneySegment; destination: string; direction: 'outbound' | 'return'; finalDay: boolean; showActions?: boolean; locked?: boolean; busy?: boolean; onLock?(): void; onChange?(): void }) {
  const events: { kind: 'drive' | 'rest' | 'meal'; start: number; end: number; label: string; note: string; stopIndex?: number }[] = [];
  let cursor = segment.departureMinutes;
  for (const [stopIndex, stop] of segment.breakStops.entries()) {
    if (stop.startMinutes > cursor) events.push({ kind: 'drive', start: cursor, end: stop.startMinutes, label: `Drive toward ${destination}`, note: 'Part of today’s road journey' });
    events.push({ kind: stop.type === 'rest' ? 'rest' : 'meal', start: stop.startMinutes, end: stop.startMinutes + stop.durationMinutes, label: stop.place?.name ?? (stop.type === 'rest' ? 'Road rest break' : `${stop.type[0].toUpperCase()}${stop.type.slice(1)} break`), note: stop.place ? `${stop.type === 'rest' ? 'Rest stop' : `${stop.type[0].toUpperCase()}${stop.type.slice(1)} stop`} · ${stop.place.address}` : stop.type === 'rest' ? 'Planned pause along the route; confirm a safe stopping place' : 'No suitable open restaurant was verified near this route point', stopIndex });
    cursor = stop.startMinutes + stop.durationMinutes;
  }
  if (cursor < segment.arrivalMinutes) events.push({ kind: 'drive', start: cursor, end: segment.arrivalMinutes, label: finalDay ? `Final drive to ${destination}` : `Continue toward ${destination}`, note: finalDay ? 'Arrival follows this driving block' : 'Today’s final driving block' });
  return <section className="road-day-timeline" aria-label={`Road journey on ${segment.date}`}>
    <div className="road-day-summary"><div><span><strong>{duration(segment.driveMinutes)}</strong> driving</span><span><strong>{duration(segment.breakMinutes)}</strong> breaks</span>{segment.overnightRestMinutes ? <span><strong>{duration(segment.overnightRestMinutes)}</strong> overnight rest</span> : <span><strong>Arrival</strong> in {destination}</span>}</div>{showActions ? <div className="road-day-actions">{onLock ? <Button variant="text" size="sm" aria-pressed={locked} disabled={busy} onClick={onLock}>{locked ? 'Unlock travel' : 'Lock travel'}</Button> : null}{onChange ? <Button variant="text" size="sm" disabled={busy || locked} onClick={onChange}>Change travel</Button> : null}</div> : null}</div>
    {events.map((event, index) => <div className={`live-timeline-event road-day-event is-${event.kind}`} data-focus={`road:${direction}:${segment.dayOffset}:${event.stopIndex === undefined ? `drive:${index}` : `stop:${event.stopIndex}`}`} key={`${event.kind}-${event.start}-${index}`}><div className="live-time-rail"><strong>{clock(event.start)}</strong><span>{clock(event.end)}</span><b>{duration(event.end - event.start)}</b></div><div className="live-transfer"><span className="road-day-event-icon"><AppIcon name={event.kind === 'drive' ? 'car' : event.kind === 'meal' ? 'meal' : 'dot'} size={17} /></span><div><strong>{event.label}</strong><span>{event.note}</span></div></div></div>)}
    {segment.overnightRestMinutes ? <div className="live-timeline-event road-day-event is-overnight" data-focus={`road:${direction}:${segment.dayOffset}:overnight`}><div className="live-time-rail"><strong>{clock(segment.arrivalMinutes)}</strong><span>Next day</span><b>{duration(segment.overnightRestMinutes)}</b></div><div className="live-transfer"><span className="road-day-event-icon"><AppIcon name="hotel" size={17} /></span><div><strong>Overnight rest{segment.transitStay ? ` at ${segment.transitStay.name}` : ''}</strong><span>{segment.transitStay ? `${segment.transitStay.address || 'Along the route'} · ${segment.transitStay.stayOffer ? 'dated stay available' : 'availability needs confirmation'}` : 'Choose and confirm a suitable stay along the route'}</span></div></div></div> : null}
  </section>;
}
