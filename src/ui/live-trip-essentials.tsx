"use client";

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LiveBrief } from '@/live/contracts';
import { liveEssentialReadiness, type LiveEssentialField } from '@/live/essentials';
import { AppIcon } from './components/app-icon';
import { Button, Chip } from './components/primitives';

export type BriefFact = 'origin' | 'destination' | 'dates' | 'guests' | 'preferences';
type TravelChoice = '' | 'flight' | 'train' | 'bus' | 'cab' | 'self_drive' | 'recommend';
type BriefDraft = { origin: string; destination: string; start: string; end: string; adults: number; children: number; seniors: number; budget: string; pace: '' | 'relaxed' | 'balanced' | 'packed'; interests: string; travel: TravelChoice };

export function LiveTripBriefBar({ brief, busy, editing, onEditingChange, onSubmit, onPrefill }: { brief: LiveBrief; busy: boolean; editing?: BriefFact; onEditingChange(field?: BriefFact): void; onSubmit(message: string): void; onPrefill(message: string): void }) {
  const [draft, setDraft] = useState(() => draftFromBrief(brief));
  const editor = useRef<HTMLDivElement>(null);
  const initial = draftFromBrief(brief);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => {
    if (!editing) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!editor.current?.contains(target) && !target.closest('[data-trip-fact]')) onEditingChange(undefined);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [editing, onEditingChange]);
  const facts = [
    { field: 'origin' as const, label: 'From city', value: draft.origin || 'Select origin', present: Boolean(brief.origin) },
    { field: 'destination' as const, label: 'To city / country', value: draft.destination || 'Select destination', present: Boolean(brief.destination) },
    { field: 'dates' as const, label: 'Travel dates', value: draft.start && draft.end ? `${formatDate(draft.start)} – ${formatDate(draft.end)}` : 'Select dates', present: Boolean(brief.startDate && brief.days && brief.nightsConfirmed) },
    { field: 'guests' as const, label: 'Guests', value: guestLabel(draft), present: Boolean(brief.travellers) },
    { field: 'preferences' as const, label: 'Preferences', value: preferenceLabel(draft), present: requiredPreferencesPresent(brief) },
  ];
  return <section className={`trip-brief-bar${editing ? ` fact-editing-${editing}` : ''}`} aria-label="Current Trip Brief">
    {facts.map(fact => <button data-trip-fact key={fact.field} type="button" className={`trip-fact${fact.present ? '' : ' trip-fact-empty essential-missing'}`} onClick={() => onEditingChange(editing === fact.field ? undefined : fact.field)}><span>{fact.label}</span><strong>{fact.value}</strong></button>)}
    <Button className="trip-update-button" disabled={busy || !dirty} onClick={() => { onEditingChange(undefined); onSubmit(messageFromDraft(draft)); }}>Update</Button>
    {editing ? <FactEditor editorRef={editor} fact={editing} draft={draft} setDraft={setDraft} onPrefill={message => { onEditingChange(undefined); onPrefill(message); }} /> : null}
  </section>;
}

function FactEditor({ editorRef, fact, draft, setDraft, onPrefill }: { editorRef: RefObject<HTMLDivElement | null>; fact: BriefFact; draft: BriefDraft; setDraft(value: BriefDraft | ((current: BriefDraft) => BriefDraft)): void; onPrefill(message: string): void }) {
  const update = <K extends keyof BriefDraft>(key: K, value: BriefDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  return <div ref={editorRef} className="trip-form fact-editor">
    {fact === 'origin' ? <label className="field"><span>From city</span><div className="location-input-wrap"><span className="field-icon"><AppIcon name="map-pin" /></span><input autoFocus value={draft.origin} onChange={event => update('origin', event.target.value)} placeholder="Search city or airport" maxLength={120} /></div></label> : null}
    {fact === 'destination' ? <><label className="field"><span>To city / country</span><div className="location-input-wrap"><span className="field-icon"><AppIcon name="map-pin" /></span><input autoFocus value={draft.destination} onChange={event => update('destination', event.target.value)} placeholder="Search destination" maxLength={120} /></div></label><button className="open-destination-button" type="button" onClick={() => onPrefill('Help me choose a destination based on my dates, budget, and interests.')}>Not sure where? Help me choose</button></> : null}
    {fact === 'dates' ? <div className="fact-editor-grid"><label className="field"><span>Start</span><input autoFocus type="date" value={draft.start} onChange={event => update('start', event.target.value)} /></label><label className="field"><span>End</span><input type="date" min={draft.start} value={draft.end} onChange={event => update('end', event.target.value)} /></label></div> : null}
    {fact === 'guests' ? <div className="fact-editor-grid guest-grid">{(['adults', 'children', 'seniors'] as const).map(key => <label className="field" key={key}><span>{key}</span><input type="number" min="0" max="12" value={draft[key]} onChange={event => update(key, Number(event.target.value))} /></label>)}</div> : null}
    {fact === 'preferences' ? <div className="fact-editor-grid">
      <label className="field"><span>Budget</span><div className="money-input"><span>₹</span><input inputMode="numeric" value={draft.budget} onChange={event => update('budget', event.target.value.replace(/\D/g, ''))} /></div></label>
      <label className="field"><span>Pace</span><select value={draft.pace} onChange={event => update('pace', event.target.value as BriefDraft['pace'])}><option value="">Select pace</option><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="packed">Packed</option></select></label>
      <label className="field"><span>Travel mode</span><select value={draft.travel} onChange={event => update('travel', event.target.value as TravelChoice)}><option value="">Select mode</option><option value="flight">Flight</option><option value="train">Train</option><option value="bus">Bus</option><option value="cab">Cab</option><option value="self_drive">Self Drive</option><option value="recommend">Recommend Me</option></select></label>
      <label className="field"><span>Interests</span><input value={draft.interests} onChange={event => update('interests', event.target.value)} placeholder="food, beaches" /></label>
    </div> : null}
  </div>;
}

export function LiveTripEssentials({ brief, busy, onEdit, onSubmit }: { brief: LiveBrief; busy: boolean; onEdit(field: LiveEssentialField): void; onSubmit(message: string): void }) {
  const readiness = liveEssentialReadiness(brief);
  const pickupRequired = brief.travelMode === 'flight' || brief.travelMode === 'self_drive' || brief.travelMode === 'cab';
  const items: { field: LiveEssentialField; label: string; complete: boolean; recommendations?: { label: string; message: string }[] }[] = [
    { field: 'origin', label: 'Starting city', complete: Boolean(brief.origin), recommendations: [{ label: 'Start from Delhi', message: 'My starting city is Delhi.' }, { label: 'Start from Mumbai', message: 'My starting city is Mumbai.' }, { label: 'Start from Bengaluru', message: 'My starting city is Bengaluru.' }] },
    { field: 'destination', label: 'Destination or recommendations', complete: Boolean(brief.destination), recommendations: [{ label: 'Help me choose', message: 'Help me choose a destination based on my dates, budget, and interests.' }] },
    { field: 'dates', label: 'Travel dates and hotel nights', complete: Boolean(brief.startDate && brief.days && brief.nightsConfirmed), recommendations: brief.startDate && brief.days && !brief.nightsConfirmed ? [{ label: `Confirm ${brief.days - 1} hotel nights`, message: `I confirm ${brief.days - 1} hotel nights and checkout on ${addDays(brief.startDate, brief.days - 1)}.` }] : undefined },
    { field: 'travellers', label: 'Traveller details', complete: Boolean(brief.travellers), recommendations: [{ label: 'Just me', message: 'It is just me, one adult traveller.' }, { label: '2 adults', message: 'There are 2 adult travellers.' }, { label: '2 adults + 1 child', message: 'There are 2 adults and 1 child, 3 travellers total.' }] },
    { field: 'transport', label: 'Travel preference', complete: Boolean(brief.travelMode), recommendations: [{ label: 'Flight', message: 'I prefer to fly.' }, { label: 'Train', message: 'I prefer to travel by train.' }, { label: 'Bus', message: 'I prefer to travel by bus.' }, { label: 'Cab', message: 'I prefer a private cab.' }, { label: 'Self Drive', message: 'I will drive my own vehicle.' }, { label: 'Recommend Me', message: 'Recommend the best travel mode using observed route evidence, my budget and group size.' }] },
    ...(pickupRequired ? [{ field: 'pickup' as const, label: brief.travelMode === 'flight' ? 'Airport transfer starting point' : brief.travelMode === 'cab' ? 'Cab pickup point' : 'Driving starting point', complete: Boolean(brief.pickupLocation), recommendations: brief.origin ? [{ label: `${brief.origin} city centre`, message: `Use ${brief.origin} city centre as my starting point.` }] : undefined }] : []),
  ];
  const pendingItems = items.filter(item => !item.complete);
  const missing = pendingItems.length;
  return <section className="brief-setup-workspace" aria-labelledby="live-essentials-title">
    <div className="brief-setup-icon">{missing}</div><p className="eyebrow">Trip essentials</p>
    <h2 id="live-essentials-title">{missing ? `Complete ${missing} detail${missing === 1 ? '' : 's'} to start planning` : 'Your trip brief is ready'}</h2>
    <p>{missing ? 'The highlighted fields in the Trip Brief are required. Add them in any order; this checklist updates after the AI validates each reply.' : 'Review the Trip Brief, then build your itinerary. You can change any detail through the fields or chat.'}</p>
    <div className="brief-setup-list">{pendingItems.map(item => <div className="brief-setup-item is-missing" key={item.field}><button className="brief-setup-row" type="button" onClick={() => onEdit(item.field)}><i /><span>{item.label}</span><strong>Add manually</strong></button>{item.recommendations?.length ? <div className="brief-setup-recommendations"><small>Recommended</small><div>{item.recommendations.map(option => <Chip key={option.label} disabled={busy} onClick={() => onSubmit(option.message)}>{option.label}</Chip>)}</div></div> : null}</div>)}</div>
    {!missing ? <div className="live-essentials-ready"><Button disabled={busy || !readiness.ready} onClick={() => onSubmit('Build my itinerary using the validated Trip Brief.')}>Build my trip <AppIcon name="arrow-right" size={14} /></Button></div> : null}
  </section>;
}

function draftFromBrief(brief: LiveBrief): BriefDraft { return { origin: brief.origin ?? '', destination: brief.destination ?? '', start: brief.startDate ?? '', end: brief.startDate && brief.days ? addDays(brief.startDate, brief.days - 1) : '', adults: brief.travellers ?? 0, children: 0, seniors: 0, budget: '', pace: brief.pace ?? '', interests: brief.preferences, travel: brief.travelMode === 'public_transit' ? 'recommend' : brief.travelMode ?? '' }; }
function requiredPreferencesPresent(brief: LiveBrief) {
  if (!brief.travelMode) return false;
  const pickupRequired = brief.travelMode === 'flight' || brief.travelMode === 'self_drive' || brief.travelMode === 'cab';
  return !pickupRequired || Boolean(brief.pickupLocation);
}
function messageFromDraft(draft: BriefDraft) {
  const messages: string[] = [];
  if (draft.origin.trim()) messages.push(`My starting city is ${draft.origin.trim()}`);
  if (draft.destination.trim()) messages.push(`my destination is ${draft.destination.trim()}`);
  if (draft.start && draft.end && draft.end >= draft.start) { const days = daysBetween(draft.start, draft.end) + 1; messages.push(`travel from ${draft.start} through ${draft.end} for ${days} calendar days and ${days - 1} hotel nights; I confirm checkout on ${draft.end}`); }
  const guests = draft.adults + draft.children + draft.seniors;
  if (guests) messages.push(`${draft.adults} adults, ${draft.children} children, and ${draft.seniors} seniors (${guests} travellers total)`);
  if (draft.travel) messages.push(travelMessage(draft.travel));
  if (draft.budget) messages.push(`my total trip budget is ₹${draft.budget}`);
  if (draft.pace) messages.push(`use a ${draft.pace} pace`);
  if (draft.interests.trim()) messages.push(`prioritise ${draft.interests.trim()}`);
  return `Update my Trip Brief: ${messages.join('; ')}.`;
}
function travelMessage(choice: TravelChoice) { return choice === 'flight' ? 'I prefer to fly' : choice === 'train' ? 'I prefer train travel' : choice === 'bus' ? 'I prefer bus travel' : choice === 'cab' ? 'I prefer a private cab' : choice === 'self_drive' ? 'I will drive my own vehicle' : 'recommend the best travel mode using observed duration, available fare evidence, my budget, interests, and group size'; }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function daysBetween(start: string, end: string) { return Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000); }
function formatDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function guestLabel(draft: BriefDraft) { const total = draft.adults + draft.children + draft.seniors; return total ? `${total} traveller${total === 1 ? '' : 's'}` : 'Select guests'; }
function preferenceLabel(draft: BriefDraft) { const parts = [draft.travel ? travelLabel(draft.travel) : '', draft.budget ? `₹${draft.budget}` : '', draft.pace ? `${draft.pace} pace` : '', draft.interests].filter(Boolean); return parts.length ? parts.join(' · ') : 'Add preferences'; }
function travelLabel(choice: TravelChoice) { return choice === 'self_drive' ? 'Self Drive' : choice === 'recommend' ? 'Recommend Me' : choice ? choice[0].toUpperCase() + choice.slice(1) : ''; }
