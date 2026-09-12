import type { TransportOffer } from '@/inventory/contracts';
import type { LivePlace } from '@/live/contracts';
import { AppIcon } from './components/app-icon';
import { Button } from './components/primitives';

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60); const remainder = minutes % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
}
function money(amount: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}
function localTime(value: string, offsetMinutes: number) {
  const shifted = new Date(Date.parse(value) + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(shifted);
}

export function LiveFlightCard({ offer, direction, journeyLabel, from, to, travellers, selected = true, locked = false, onLock, onChange, onSelect, selectionBusy = false, decisionNote }: { offer: TransportOffer; direction: 'outbound' | 'return'; journeyLabel?: 'outbound' | 'return' | 'onward'; from: LivePlace; to: LivePlace; travellers: number; selected?: boolean; locked?: boolean; onLock?(): void; onChange?(): void; onSelect?(): void; selectionBusy?: boolean; decisionNote?: string }) {
  const segment = offer.segments[0];
  return <article className={`itinerary-card itinerary-flight-card live-route-card ${selected ? 'is-suggested' : ''}`}>
    <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true"><AppIcon name="flight" /></span><strong>{selected ? 'Selected' : 'Alternative'} {journeyLabel ?? direction} flight · {segment.number} · {duration(offer.durationMinutes)}</strong><div className="live-card-actions">{onLock && <Button variant="text" size="sm" aria-pressed={locked} disabled={selectionBusy} onClick={onLock}>{locked ? 'Unlock' : 'Lock'}</Button>}{onLock && (onChange || onSelect) && <span aria-hidden="true">·</span>}{onChange && <Button variant="text" size="sm" onClick={onChange} disabled={selectionBusy || locked}>Change</Button>}{onSelect && <Button size="sm" onClick={onSelect} disabled={selectionBusy}>Select flight</Button>}</div></header>
    <div className="flight-card-body">
      <div className="airline-mark"><AppIcon name="flight" size={28} aria-label="Flight" /></div>
      <div className="flight-stop"><strong>{localTime(offer.departureAt, from.utcOffsetMinutes ?? 0)}</strong><span>{from.airportCode}</span><small>{from.name}</small></div>
      <div className="flight-line"><i /><span><AppIcon name="arrow-right" size={15} /></span></div>
      <div className="flight-stop"><strong>{localTime(offer.arrivalAt, to.utcOffsetMinutes ?? 0)}</strong><span>{to.airportCode}</span><small>{to.name}</small></div>
      <dl className="flight-facts"><div><dt>Duration</dt><dd>{duration(offer.durationMinutes)}</dd></div><div><dt>Stops</dt><dd>Direct</dd></div><div><dt>Operator</dt><dd>{offer.operator}</dd></div></dl>
      <div className="card-price"><strong>{money(offer.price.amount, offer.price.currency)}</strong><span>per adult · {money(offer.price.amount * travellers, offer.price.currency)} for {travellers}</span></div>
    </div>
    <div className="card-grounding"><i aria-hidden="true"><AppIcon name="sparkles" size={17} /></i><div><span>{decisionNote ?? `${selected ? 'Current itinerary selection.' : 'Available supplier alternative.'} Schedule, fare and remaining-seat evidence came from Nuitée; refresh before relying on it.`}</span></div></div>
    <footer className="live-route-footer"><span>Nuitée Connect Flights · checked {new Date(offer.source.checkedAt!).toLocaleString()}</span><span>{offer.cancellationTerms?.summary}</span></footer>
  </article>;
}
