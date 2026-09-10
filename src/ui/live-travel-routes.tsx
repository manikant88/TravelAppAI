import type { AppIconName } from './components/app-icon';
import { AppIcon } from './components/app-icon';
import { Button } from './components/primitives';
import type { LiveTravel, LiveTravelOption } from '@/live/contracts';
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

function optionIcon(option: LiveTravelOption): AppIconName {
  if (option.mode === 'drive') return 'car';
  return option.transitModes.some(mode => mode.includes('TRAIN') || mode === 'RAIL' || mode === 'SUBWAY') ? 'train' : 'bus';
}

function directionsUrl(travel: LiveTravel, option: LiveTravelOption) {
  const from = option.direction === 'outbound' ? travel.origin : travel.destination;
  const to = option.direction === 'outbound' ? travel.destination : travel.origin;
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${option.mode === 'drive' ? 'driving' : 'transit'}`;
}

export function LiveTravelCard({ travel, direction, date, optionId, selected = true, locked = false, busy = false, onLock, onChange, onSelect, decisionNote }: { travel: LiveTravel; direction: 'outbound' | 'return'; date: string; optionId?: string; selected?: boolean; locked?: boolean; busy?: boolean; onLock?(): void; onChange?(): void; onSelect?(): void; decisionNote?: string }) {
  const id = optionId ?? (direction === 'outbound' ? travel.suggestedOutboundId : travel.suggestedReturnId);
  const options = direction === 'outbound' ? travel.outbound : travel.return;
  const option = options.find(candidate => candidate.id === id);
  if (!option) return null;
  const from = direction === 'outbound' ? travel.origin : travel.destination;
  const to = direction === 'outbound' ? travel.destination : travel.origin;
  const icon = optionIcon(option);
  return <article className={`itinerary-card itinerary-flight-card live-route-card ${selected ? 'is-suggested' : ''}`}>
    <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true"><AppIcon name={icon} /></span><strong>{selected ? 'Suggested' : 'Alternative'} {direction} travel · {option.label} · {duration(option.minutes)}</strong><div className="live-card-actions">{onLock && <Button variant="text" size="sm" aria-pressed={locked} disabled={busy} onClick={onLock}>{locked ? 'Unlock' : 'Lock'}</Button>}{onLock && (onChange || onSelect) && <span aria-hidden="true">·</span>}{onChange && <Button variant="text" size="sm" disabled={busy || locked} onClick={onChange}>Change</Button>}{onSelect && <Button size="sm" disabled={busy} onClick={onSelect}>Select travel</Button>}</div></header>
    <div className="flight-card-body">
      <div className="airline-mark"><AppIcon name={icon} size={28} aria-label={option.label} /></div>
      <div className="flight-stop"><strong>{localTime(travelOptionInstant(option, 'departure'), from.utcOffsetMinutes)}</strong><span>{date}</span><small>{from.name}</small></div>
      <div className="flight-line"><i /><span><AppIcon name="arrow-right" size={15} /></span></div>
      <div className="flight-stop"><strong>{localTime(travelOptionInstant(option, 'arrival'), to.utcOffsetMinutes)}</strong><span>{option.timingKind === 'scheduled' ? 'Scheduled' : 'Estimated'}</span><small>{to.name}</small></div>
      <dl className="flight-facts"><div><dt>Duration</dt><dd>{duration(option.minutes)}</dd></div>{option.meters !== null && <div><dt>Distance</dt><dd>{(option.meters / 1000).toFixed(0)} km</dd></div>}{!!option.transitLines.length && <div><dt>Lines</dt><dd>{option.transitLines.join(' · ')}</dd></div>}</dl>
      <div className="card-price"><strong>{option.fare ? money(option.fare.amount, option.fare.currency) : option.roadUse === 'cab' ? 'Cab fare unavailable' : option.mode === 'drive' ? 'Cost not estimated' : 'Fare not provided'}</strong><span>{option.fare ? 'Google-returned fare' : option.roadUse === 'cab' ? 'route duration only; cab availability unverified' : option.mode === 'drive' ? 'fuel, tolls and parking excluded' : 'ticket price unavailable'}</span></div>
    </div>
    {decisionNote && <div className="card-grounding"><i aria-hidden="true"><AppIcon name="sparkles" size={17} /></i><div><span>{decisionNote}</span></div></div>}
    <footer className="live-route-footer"><span>Google Routes · checked {new Date(option.checkedAt).toLocaleString()}</span><a href={directionsUrl(travel, option)} target="_blank" rel="noreferrer">View route <AppIcon name="arrow-right" size={13} /></a></footer>
  </article>;
}
