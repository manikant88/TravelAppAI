"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TransportOffer } from '@/inventory/contracts';
import type { LiveDay, LiveMeal, LivePlan, LivePlace, LiveSelectionRequest, LiveTravelOption } from '@/live/contracts';
import { AppIcon } from './components/app-icon';
import { Button, IconButton } from './components/primitives';
import { LiveFlightCard } from './live-flight-card';
import { LivePlaceCard } from './live-place-card';
import { LiveTravelCard } from './live-travel-routes';

export type LiveOptionPicker =
  | { kind: 'hotel' }
  | { kind: 'flight'; direction: 'outbound' | 'return' }
  | { kind: 'travel'; direction: 'outbound' | 'return' }
  | { kind: 'activity'; dayIndex: number; visitIndex: number }
  | { kind: 'meal'; dayIndex: number; mealType: LiveMeal['type'] };

type Option =
  | { type: 'hotel'; place: LivePlace; selected: boolean }
  | { type: 'activity'; place: LivePlace; selected: boolean }
  | { type: 'meal'; place: LivePlace; selected: boolean }
  | { type: 'flight'; offer: TransportOffer; selected: boolean }
  | { type: 'travel'; option: LiveTravelOption; selected: boolean };

function money(amount: number, currency = 'INR') {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${currency} ${Math.round(amount)}`; }
}
function duration(minutes: number) {
  const hours = Math.floor(minutes / 60); const remainder = minutes % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
}
function signedMinutes(value: number) { return value === 0 ? 'Same elapsed time' : `${value > 0 ? '+' : '−'}${duration(Math.abs(value))} travel time`; }
function signedMoney(value: number, currency: string) { return value === 0 ? 'Same price' : `${value > 0 ? '+' : '−'}${money(Math.abs(value), currency)}`; }
function placeCost(place: LivePlace) { return place.stayOffer?.totalPrice?.amount; }
function dateLabel(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }

export function LiveOptionDrawer({ plan, picker, busy, onSelect, onClose }: {
  plan: LivePlan;
  picker: LiveOptionPicker;
  busy: boolean;
  onSelect(command: LiveSelectionRequest['command']): Promise<boolean>;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const returnFocus = returnFocusRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]; const last = focusable.at(-1)!; const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); returnFocus?.focus(); };
  }, [onClose]);

  const selectedHotel = plan.hotels.find(place => place.id === plan.selectedHotelId);
  const currentVisit = picker.kind === 'activity' ? plan.days[picker.dayIndex]?.visits[picker.visitIndex] : undefined;
  const currentMeal = picker.kind === 'meal' ? plan.days[picker.dayIndex]?.meals?.find(meal => meal.type === picker.mealType) : undefined;
  const options = useMemo<Option[]>(() => {
    if (picker.kind === 'hotel') return plan.hotels.map(place => ({ type: 'hotel', place, selected: place.id === plan.selectedHotelId }));
    if (picker.kind === 'flight') {
      const journey = plan.flight; if (!journey) return [];
      const values = picker.direction === 'outbound' ? journey.outbound : journey.return;
      const selectedId = picker.direction === 'outbound' ? journey.suggestedOutboundId : journey.suggestedReturnId;
      return values.map(offer => ({ type: 'flight', offer, selected: offer.id === selectedId }));
    }
    if (picker.kind === 'travel') {
      const travel = plan.travel; if (!travel) return [];
      const values = picker.direction === 'outbound' ? travel.outbound : travel.return;
      const selectedId = picker.direction === 'outbound' ? travel.suggestedOutboundId : travel.suggestedReturnId;
      return values.map(option => ({ type: 'travel', option, selected: option.id === selectedId }));
    }
    if (picker.kind === 'meal') {
      if (!currentMeal) return [];
      const usedToday = new Set(plan.days[picker.dayIndex]?.meals?.filter(meal => meal.type !== picker.mealType && meal.location === 'restaurant').map(meal => meal.place.id) ?? []);
      const candidates = (plan.mealOptions ?? []).filter(place => !usedToday.has(place.id));
      const withCurrent = candidates.some(place => place.id === currentMeal.place.id) ? candidates : [currentMeal.place, ...candidates];
      return withCurrent.map(place => ({ type: 'meal', place, selected: place.id === currentMeal.place.id }));
    }
    if (!currentVisit) return [];
    const used = new Set(plan.days.flatMap((day, dayIndex) => day.visits.flatMap((visit, visitIndex) => dayIndex === picker.dayIndex && visitIndex === picker.visitIndex ? [] : [visit.place.id])));
    const candidates = (plan.activityOptions ?? []).filter(place => !used.has(place.id));
    const withCurrent = candidates.some(place => place.id === currentVisit.place.id) ? candidates : [currentVisit.place, ...candidates];
    return withCurrent.map(place => ({ type: 'activity', place, selected: place.id === currentVisit.place.id }));
  }, [currentMeal, currentVisit, picker, plan]);

  const visible = options.filter(option => optionText(option).includes(query.trim().toLowerCase())).sort((a, b) => Number(b.selected) - Number(a.selected));
  const title = picker.kind === 'hotel' ? 'Change stay' : picker.kind === 'activity' ? 'Change activity' : picker.kind === 'meal' ? `Change ${picker.mealType}` : picker.kind === 'flight' ? `Change ${picker.direction} flight` : `Change ${picker.direction} travel`;
  const noun = picker.kind === 'hotel' ? 'stays' : picker.kind === 'activity' ? 'activities' : picker.kind === 'meal' ? 'restaurants' : picker.kind === 'flight' ? 'flights' : 'routes';

  async function select(option: Option) {
    let command: LiveSelectionRequest['command'];
    if (option.type === 'hotel') command = { type: 'select_hotel', hotelId: option.place.id };
    else if (option.type === 'activity' && picker.kind === 'activity') command = { type: 'select_activity', dayIndex: picker.dayIndex, visitIndex: picker.visitIndex, placeId: option.place.id };
    else if (option.type === 'meal' && picker.kind === 'meal') command = { type: 'select_meal', dayIndex: picker.dayIndex, mealType: picker.mealType, placeId: option.place.id };
    else if (option.type === 'flight' && picker.kind === 'flight') command = { type: 'select_flight', direction: picker.direction, offerId: option.offer.id };
    else if (option.type === 'travel' && picker.kind === 'travel') command = { type: 'select_travel', direction: picker.direction, optionId: option.option.id };
    else return;
    if (await onSelect(command)) onClose();
  }

  return <div className="inventory-drawer-overlay live-option-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={dialogRef} className="inventory-drawer live-option-drawer" role="dialog" aria-modal="true" aria-labelledby="live-option-title" tabIndex={-1}>
      <header className="inventory-drawer-header">
        <h2 id="live-option-title">{title}</h2>
        <label><span className="sr-only">Search {noun}</span><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${noun}`} /></label>
        <IconButton aria-label="Close options" onClick={onClose}><AppIcon name="close" /></IconButton>
      </header>
      <div className="inventory-drawer-filter">Showing {visible.length} observed {noun} <span>· Current option first, then available alternatives</span>{picker.kind === 'travel' && plan.travel?.context === 'flight_fallback' && <Button variant="text" size="sm" disabled={busy} onClick={async () => { if (await onSelect({ type: 'retry_flights' })) onClose(); }}>Retry flights</Button>}</div>
      <div className="inventory-drawer-list">
        {!visible.length && <p className="inventory-picker-status">No matching alternatives are available in the current live results.</p>}
        {visible.map(option => <OptionRow key={optionId(option)} option={option} picker={picker} plan={plan} currentHotel={selectedHotel} currentVisit={currentVisit} currentMeal={currentMeal} busy={busy} onSelect={() => select(option)} />)}
      </div>
    </aside>
  </div>;
}

function OptionRow({ option, picker, plan, currentHotel, currentVisit, currentMeal, busy, onSelect }: { option: Option; picker: LiveOptionPicker; plan: LivePlan; currentHotel?: LivePlace; currentVisit?: LiveDay['visits'][number]; currentMeal?: LiveMeal; busy: boolean; onSelect(): void }) {
  const note = impact(option, picker, plan, currentHotel, currentVisit?.place, currentMeal?.place);
  if (option.type === 'hotel') return <LivePlaceCard place={option.place} kind="hotel" heading={`${option.selected ? 'Current' : 'Alternative'} stay · ${plan.brief.days! - 1} nights`} subtitle={`${plan.brief.travellers} travellers · room allocation to confirm`} selected={option.selected} selectionBusy={busy} onSelect={option.selected ? undefined : onSelect} decisionNote={note} />;
  if (option.type === 'activity') return <LivePlaceCard place={option.place} kind="activity" heading={`${option.selected ? 'Current' : 'Alternative'} stop ${picker.kind === 'activity' ? picker.visitIndex + 1 : ''} · ${currentVisit?.durationMinutes ?? 60} min visit`} subtitle="Opening-day validity is checked before this replaces the current activity" selected={option.selected} selectionBusy={busy} onSelect={option.selected ? undefined : onSelect} decisionNote={note} />;
  if (option.type === 'meal' && picker.kind === 'meal') return <LivePlaceCard place={option.place} kind="meal" heading={`${option.selected ? 'Current' : 'Alternative'} ${picker.mealType} · ${currentMeal?.durationMinutes ?? 60} min`} subtitle="Opening hours, meal timing and surrounding drives will be checked before applying" selected={option.selected} selectionBusy={busy} onSelect={option.selected ? undefined : onSelect} decisionNote={note} />;
  if (option.type === 'flight' && picker.kind === 'flight' && plan.flight) {
    const from = picker.direction === 'outbound' ? plan.flight.originAirport : plan.flight.destinationAirport;
    const to = picker.direction === 'outbound' ? plan.flight.destinationAirport : plan.flight.originAirport;
    return <LiveFlightCard offer={option.offer} direction={picker.direction} from={from} to={to} travellers={plan.brief.travellers!} selected={option.selected} selectionBusy={busy} onSelect={option.selected ? undefined : onSelect} decisionNote={note} />;
  }
  if (option.type === 'travel' && picker.kind === 'travel' && plan.travel) return <LiveTravelCard travel={plan.travel} direction={picker.direction} date={dateLabel(picker.direction === 'outbound' ? plan.days[0].date : plan.days.at(-1)!.date)} optionId={option.option.id} selected={option.selected} busy={busy} onSelect={option.selected ? undefined : onSelect} decisionNote={note} />;
  return null;
}

function optionId(option: Option) { return option.type === 'flight' ? option.offer.id : option.type === 'travel' ? option.option.id : option.place.id; }
function optionName(option: Option) { return option.type === 'flight' ? `${option.offer.operator} ${option.offer.segments[0]?.number ?? ''}` : option.type === 'travel' ? option.option.label : option.place.name; }
function optionText(option: Option) { return `${optionName(option)} ${option.type === 'flight' ? `${option.offer.from} ${option.offer.to}` : option.type === 'travel' ? option.option.transitLines.join(' ') : option.place.address}`.toLowerCase(); }
function selectedFlight(plan: LivePlan, direction: 'outbound' | 'return') { const journey = plan.flight; if (!journey) return undefined; const id = direction === 'outbound' ? journey.suggestedOutboundId : journey.suggestedReturnId; return (direction === 'outbound' ? journey.outbound : journey.return).find(offer => offer.id === id); }
function selectedTravel(plan: LivePlan, direction: 'outbound' | 'return') { const travel = plan.travel; if (!travel) return undefined; const id = direction === 'outbound' ? travel.suggestedOutboundId : travel.suggestedReturnId; return (direction === 'outbound' ? travel.outbound : travel.return).find(option => option.id === id); }
function impact(option: Option, picker: LiveOptionPicker, plan: LivePlan, currentHotel?: LivePlace, currentVisit?: LivePlace, currentMeal?: LivePlace) {
  if (option.selected) return 'This is the option currently used by the itinerary and map.';
  if (option.type === 'hotel') { const current = currentHotel && placeCost(currentHotel); const next = placeCost(option.place); const currency = option.place.stayOffer?.totalPrice?.currency; const priceEffect = current !== undefined && next !== undefined && currency && currentHotel?.stayOffer?.totalPrice?.currency === currency ? `${signedMoney(next - current, currency)} for the stay. ` : ''; return `${priceEffect}Changing from ${currentHotel?.name ?? 'the current stay'} will recalculate airport or intercity transfers and every daily driving connection.`; }
  if (option.type === 'activity') return `Replaces ${currentVisit?.name ?? 'the current activity'} in the same time block; opening-day validity and adjacent driving routes will be checked before applying.`;
  if (option.type === 'meal') return `Replaces ${currentMeal?.name ?? 'the current restaurant'} for this meal; opening hours, the flexible meal window and adjacent driving routes will be checked before applying.`;
  if (option.type === 'flight' && picker.kind === 'flight') { const current = selectedFlight(plan, picker.direction); if (!current) return 'Airport road transfers and the affected itinerary timing will refresh.'; const arrivalDelta = Math.round((Date.parse(option.offer.arrivalAt) - Date.parse(current.arrivalAt)) / 60000); const arrivalImpact = arrivalDelta === 0 ? 'same arrival time' : `${duration(Math.abs(arrivalDelta))} ${arrivalDelta > 0 ? 'later' : 'earlier'} arrival`; const travellers = plan.brief.travellers ?? 1; const priceEffect = current.price.currency === option.offer.price.currency ? `${signedMoney((option.offer.price.amount - current.price.amount) * travellers, option.offer.price.currency)} for ${travellers} travellers · ` : ''; return `${priceEffect}${signedMinutes(option.offer.durationMinutes - current.durationMinutes)} · ${arrivalImpact}; both airport road transfers will refresh.`; }
  if (option.type === 'travel' && picker.kind === 'travel') { const current = selectedTravel(plan, picker.direction); if (!current) return 'The itinerary timing and map route will update.'; const priceEffect = current.fare && option.option.fare && current.fare.currency === option.option.fare.currency ? `${signedMoney(option.option.fare.amount - current.fare.amount, option.option.fare.currency)} · ` : ''; return `${priceEffect}${signedMinutes(option.option.minutes - current.minutes)}; the affected arrival or departure timing and map route will update.`; }
  return 'The affected itinerary dependencies will be checked before applying.';
}
