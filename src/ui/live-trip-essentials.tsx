"use client";

import { useEffect, useRef, useState, type RefObject } from 'react';
import { LIVE_TRIP_MAX_DAYS, type LiveBrief, type LiveGenerationIssue } from '@/live/contracts';
import type { LiveEssentialField } from '@/live/essentials';
import { AppIcon } from './components/app-icon';
import { Button, Chip } from './components/primitives';

export type BriefFact = 'origin' | 'destination' | 'dates' | 'guests' | 'preferences';
type TravelChoice = '' | 'flight' | 'train' | 'bus' | 'cab' | 'self_drive' | 'recommend';
type EndIntentChoice = '' | 'return_to_origin' | 'end_at_destination' | 'continue_elsewhere';
type BriefDraft = { origin: string; destination: string; start: string; end: string; adults: number; children: number; seniors: number; budget: string; pace: '' | 'relaxed' | 'balanced' | 'packed'; interests: string; travel: TravelChoice; endIntent: EndIntentChoice; onwardDestination: string; endTravel: TravelChoice };
export type EssentialAnswer = { label: string; message: string; patch?: Partial<LiveBrief>; action?: 'current_location' | 'compose_pickup' };
export type StagedEssentialAnswers = Partial<Record<LiveEssentialField, EssentialAnswer>>;

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
    <Button className="trip-update-button" disabled={busy || !dirty} onClick={() => { onEditingChange(undefined); onSubmit(liveBriefUpdateMessage(brief, draft)); }}>Update</Button>
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
      <label className="field"><span>After this destination</span><select value={draft.endIntent} onChange={event => update('endIntent', event.target.value as EndIntentChoice)}><option value="">Select what happens next</option><option value="return_to_origin">Return to origin</option><option value="end_at_destination">End trip here</option><option value="continue_elsewhere">Continue elsewhere</option></select></label>
      {draft.endIntent === 'continue_elsewhere' ? <label className="field"><span>Next destination</span><input value={draft.onwardDestination} onChange={event => update('onwardDestination', event.target.value)} placeholder="City or destination" /></label> : null}
      {draft.endIntent && draft.endIntent !== 'end_at_destination' ? <label className="field"><span>Travel after destination</span><select value={draft.endTravel} onChange={event => update('endTravel', event.target.value as TravelChoice)}><option value="">Select independently</option><option value="flight">Flight</option><option value="train">Train</option><option value="bus">Bus</option><option value="cab">Cab</option><option value="self_drive">Self Drive</option><option value="recommend">Recommend Me</option></select></label> : null}
      <label className="field"><span>Interests</span><input value={draft.interests} onChange={event => update('interests', event.target.value)} placeholder="food, beaches" /></label>
    </div> : null}
  </div>;
}

export function LiveTripEssentials({ brief, busy, planningIssue, onEdit, onSubmit, onLocate }: { brief: LiveBrief; busy: boolean; planningIssue?: LiveGenerationIssue; onEdit(field: LiveEssentialField): void; onSubmit(message: string): void; onLocate?(): Promise<EssentialAnswer | undefined> }) {
  const [answers, setAnswers] = useState<StagedEssentialAnswers>({});
  const [recoveryAnswers, setRecoveryAnswers] = useState<Record<string, RecoveryChoice>>({});
  const effectiveBrief = Object.values(answers).reduce<LiveBrief>((current, answer) => ({ ...current, ...answer?.patch }), brief);
  if (answers.end_transport?.label === 'Same as outward') effectiveBrief.endTravelMode = effectiveBrief.travelMode;
  const pickupRequired = effectiveBrief.travelMode === 'flight' || effectiveBrief.travelMode === 'self_drive' || effectiveBrief.travelMode === 'cab';
  const items: { field: LiveEssentialField; label: string; complete: boolean; recommendations?: EssentialAnswer[] }[] = [
    { field: 'origin', label: 'Starting city', complete: Boolean(effectiveBrief.origin), recommendations: [{ label: 'Start from Delhi', message: 'My starting city is Delhi.' }, { label: 'Start from Mumbai', message: 'My starting city is Mumbai.' }, { label: 'Start from Bengaluru', message: 'My starting city is Bengaluru.' }] },
    { field: 'destination', label: 'Destination or recommendations', complete: Boolean(effectiveBrief.destination), recommendations: [{ label: 'Help me choose', message: 'Help me choose a destination based on my dates, budget, and interests.' }] },
    { field: 'dates', label: 'Travel dates and hotel nights', complete: Boolean(effectiveBrief.startDate && effectiveBrief.days && effectiveBrief.nightsConfirmed), recommendations: brief.startDate && brief.days && !brief.nightsConfirmed ? [{ label: `Confirm ${brief.days - 1} hotel nights`, message: `I confirm ${brief.days - 1} hotel nights and checkout on ${addDays(brief.startDate, brief.days - 1)}.` }] : undefined },
    { field: 'travellers', label: 'Traveller details', complete: Boolean(effectiveBrief.travellers), recommendations: [{ label: 'Just me', message: 'It is just me, one adult traveller.' }, { label: '2 adults', message: 'There are 2 adult travellers.' }, { label: '2 adults + 1 child', message: 'There are 2 adults and 1 child, 3 travellers total.' }] },
    { field: 'transport', label: 'Travel preference', complete: Boolean(effectiveBrief.travelMode), recommendations: [{ label: 'Flight', message: 'I prefer to fly.', patch: { travelMode: 'flight' } }, { label: 'Train', message: 'I prefer to travel by train.', patch: { travelMode: 'train' } }, { label: 'Bus', message: 'I prefer to travel by bus.', patch: { travelMode: 'bus' } }, { label: 'Cab', message: 'I prefer a private cab.', patch: { travelMode: 'cab' } }, { label: 'Self Drive', message: 'I will drive my own vehicle.', patch: { travelMode: 'self_drive' } }, { label: 'Recommend Me', message: 'Recommend the best travel mode using observed route evidence, my budget and group size.', patch: { travelMode: 'recommend' } }] },
    ...(pickupRequired ? [{ field: 'pickup' as const, label: effectiveBrief.travelMode === 'flight' ? 'Airport transfer starting point' : effectiveBrief.travelMode === 'cab' ? 'Cab pickup point' : 'Driving starting point', complete: Boolean(effectiveBrief.pickupLocation), recommendations: effectiveBrief.origin ? pickupAnswers(effectiveBrief.origin) : undefined }] : []),
    { field: 'trip_end', label: 'After this destination', complete: Boolean(effectiveBrief.endIntent), recommendations: effectiveBrief.origin && effectiveBrief.destination ? [{ label: `Return to ${effectiveBrief.origin}`, message: `I want to return to ${effectiveBrief.origin} after ${effectiveBrief.destination}.`, patch: { endIntent: 'return_to_origin' } }, { label: 'End trip here', message: `My trip ends in ${effectiveBrief.destination}.`, patch: { endIntent: 'end_at_destination', onwardDestination: null, endTravelMode: null } }, { label: 'Continue elsewhere', message: `I want to continue to another destination after ${effectiveBrief.destination}.`, patch: { endIntent: 'continue_elsewhere' } }] : undefined },
    ...(effectiveBrief.endIntent === 'continue_elsewhere' ? [{ field: 'onward_destination' as const, label: 'Next destination', complete: Boolean(effectiveBrief.onwardDestination) }] : []),
    ...(effectiveBrief.endIntent && effectiveBrief.endIntent !== 'end_at_destination' ? [{ field: 'end_transport' as const, label: effectiveBrief.endIntent === 'return_to_origin' ? 'Return travel preference' : 'Onward travel preference', complete: Boolean(effectiveBrief.endTravelMode), recommendations: [
      essentialAnswer('Same as outward', `Use the same travel mode after ${brief.destination}.`, effectiveBrief.travelMode ? { endTravelMode: effectiveBrief.travelMode } : undefined),
      essentialAnswer('Flight', `I want to fly after ${brief.destination}.`, { endTravelMode: 'flight' }),
      essentialAnswer('Train', `I want to take a train after ${brief.destination}.`, { endTravelMode: 'train' }),
      essentialAnswer('Bus', `I want to take a bus after ${brief.destination}.`, { endTravelMode: 'bus' }),
      essentialAnswer('Cab', `I want to take a private cab after ${brief.destination}.`, { endTravelMode: 'cab' }),
      essentialAnswer('Self Drive', `I want to self-drive after ${brief.destination}.`, { endTravelMode: 'self_drive' }),
      essentialAnswer('Recommend Me', `Recommend how I should travel after ${brief.destination}.`, { endTravelMode: 'recommend' }),
    ] }] : []),
  ];
  const pendingItems = items.filter(item => !item.complete);
  const missing = pendingItems.length;
  const recoveryActions = planningIssue ? livePlanningRecoveryActions(planningIssue, brief) : [];
  return <section className="brief-setup-workspace" aria-labelledby="live-essentials-title">
    <div className={`brief-setup-icon${planningIssue ? ' has-issue' : ''}`}>{planningIssue ? <AppIcon name="alert-circle" size={24} /> : missing ? missing : <AppIcon name="sparkles" size={24} />}</div><p className="eyebrow">Trip essentials</p>
    <h2 id="live-essentials-title">{planningIssue ? 'Let’s adjust this trip' : missing ? `Complete ${missing} detail${missing === 1 ? '' : 's'} to start planning` : 'Preparing your itinerary'}</h2>
    <p>{planningIssue?.message ?? (missing ? 'Choose all the answers you want to add. Nothing is applied until you send them together, and you can also add the remaining details through the Trip Brief or chat.' : 'Everything needed is available, so planning continues automatically.')}</p>
    {recoveryActions.length ? <div className="brief-recovery-actions" aria-label="Ways to make this trip work"><small>Choose one answer from any section</small><div>{recoveryActions.map(action => <div className="brief-recovery-option" key={action.label}><strong>{action.label}</strong><span>{action.description}</span><div className="brief-recovery-choices">{action.options.map(option => <Chip key={option.label} aria-pressed={recoveryAnswers[action.label]?.label === option.label} disabled={busy} onClick={() => {
        if (option.field) { onEdit(option.field); return; }
        setRecoveryAnswers(current => stageRecoveryAnswer(current, action.label, option));
      }}>{option.label}</Chip>)}</div></div>)}</div></div> : null}
    <div className="brief-setup-list">{pendingItems.map(item => <div className="brief-setup-item is-missing" key={item.field}><button className="brief-setup-row" type="button" onClick={() => onEdit(item.field)}><i className={answers[item.field] ? 'is-staged' : ''} /><span>{item.label}</span><strong>{answers[item.field] ? 'Ready to apply' : 'Add manually'}</strong></button>{item.recommendations?.length ? <div className="brief-setup-recommendations"><small>Recommended</small><div>{item.recommendations.map(option => <Chip key={option.label} aria-pressed={answers[item.field]?.label === option.label} disabled={busy || (option.action === 'current_location' && !onLocate)} onClick={() => {
      if (option.action === 'compose_pickup') { onEdit('pickup'); return; }
      if (option.action === 'current_location') { void onLocate?.().then(answer => { if (answer) setAnswers(current => stageEssentialAnswer(current, item.field, answer)); }); return; }
      setAnswers(current => stageEssentialAnswer(current, item.field, option));
    }}>{option.label}</Chip>)}</div></div> : null}</div>)}</div>
    {planningIssue && recoveryActions.length ? <div className="live-essentials-ready"><Button disabled={busy || !Object.keys(recoveryAnswers).length} onClick={() => onSubmit(batchRecoveryAnswerMessage(recoveryAnswers))}>Apply answers</Button></div> : missing ? <div className="live-essentials-ready"><Button disabled={busy || !stagedEssentialAnswerCount(answers)} onClick={() => onSubmit(batchEssentialAnswerMessage(answers))}>Apply answers</Button></div> : null}
  </section>;
}

export type RecoveryChoice = { label: string; message?: string; field?: LiveEssentialField };
type RecoveryAction = { label: string; description: string; options: RecoveryChoice[] };
export function livePlanningRecoveryActions(issue: LiveGenerationIssue, brief: LiveBrief): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  const journey = issue.journey ?? 'outbound';
  const destination = brief.destination ?? 'the destination';
  const journeyLabel = journey === 'outbound' ? 'outbound' : 'after the destination';
  const journeyMessage = journey === 'outbound' ? 'outward journey' : `journey after ${destination}`;

  const roadMode = brief.travelMode === 'cab' || brief.travelMode === 'self_drive';
  const suggestedModes = issue.suggestedTravelModes ?? (roadMode ? ['flight', 'train', 'bus', 'recommend'] as const : []);
  const travelOptions: RecoveryChoice[] = [];
  for (const mode of suggestedModes) {
    if (mode === brief.travelMode && journey === 'outbound') continue;
    const copy = recoveryTravelCopy(mode, journeyLabel);
    travelOptions.push({
      label: copy.label,
      message: `Change my ${journeyMessage} to ${recoveryTravelMessage(mode)}. Keep the other journey and the rest of my Trip Brief unchanged.`,
    });
  }
  if (roadMode && issue.code !== 'road_infeasible') travelOptions.push({
    label: brief.travelMode === 'cab' ? 'Keep cab · make it a road trip' : 'Keep self-drive · make it a road trip',
    message: `Keep my ${brief.travelMode === 'cab' ? 'private cab' : 'self-drive'} preference and treat the multi-day road journey as a main part of this trip. I understand this can leave less time at ${destination}.`,
  });
  if (travelOptions.length) actions.push({
    label: issue.code === 'road_confirmation' ? 'Choose how this long journey should work' : 'Optional: reconsider the long road journey',
    description: issue.code === 'road_confirmation'
      ? `This road journey would use much of the available trip. Choose faster travel or confirm that the journey itself is part of the experience.`
      : `Long-distance ${brief.travelMode === 'cab' ? 'cab travel' : 'self-driving'} can take multiple days and leave less time at ${destination}. You can switch modes, confirm a road trip, or leave this unchanged.`,
    options: travelOptions,
  });
  if (issue.minimumTripDays && brief.startDate && issue.minimumTripDays > (brief.days ?? 0)) {
    const endDate = addDays(brief.startDate, issue.minimumTripDays - 1);
    actions.push({
      label: 'Extend the trip to fit the journey',
      description: `Keeps the ${formatShortDate(brief.startDate)} start and adds enough calendar time for the journeys, breaks, and destination stay.`,
      options: [{ label: `Extend to ${issue.minimumTripDays} days · until ${formatShortDate(endDate)}`, message: `Extend my trip from ${brief.startDate} through ${endDate} to ${issue.minimumTripDays} calendar days and ${issue.minimumTripDays - 1} hotel nights. Keep my other Trip Brief choices unchanged.` }],
    });
  }
  if (issue.code === 'road_infeasible' || issue.code === 'road_confirmation' || (issue.code === 'blocking_constraints' && issue.journey)) return actions;

  if (issue.code === 'no_stays') {
    actions.push(
      { label: 'Try dates with more stay availability', description: 'Move or extend the trip before searching for stays again.', options: [{ label: 'Edit travel dates', field: 'dates' }] },
      { label: 'Choose another destination', description: 'Use this when the destination is flexible and the current stay search returned no usable base.', options: [{ label: 'Edit destination', field: 'destination' }] },
    );
  } else if (issue.code === 'no_activities' || issue.code === 'schedule_empty') {
    actions.push({ label: 'Broaden the activity mix', description: 'Add another interest so there are more suitable places to build the days around.', options: [
      { label: 'Nature & viewpoints', message: 'Add nature and viewpoints to my interests, while keeping my current interests.' },
      { label: 'Culture & heritage', message: 'Add local culture and heritage to my interests, while keeping my current interests.' },
      { label: 'Food & markets', message: 'Add local food and markets to my interests, while keeping my current interests.' },
    ] });
    const extensions = dateExtensionChoices(brief);
    if (extensions.length) actions.push({ label: 'Give the itinerary more time', description: 'Extend the end date to create more usable time for activities and transfers.', options: extensions });
    actions.push({ label: 'Choose another destination', description: 'Use this if the destination is flexible and the current options are too limited.', options: [{ label: 'Edit destination', field: 'destination' }] });
  } else if (issue.code === 'blocking_constraints') {
    const extensions = dateExtensionChoices(brief);
    if (extensions.length) actions.push({ label: 'Add enough calendar time', description: 'Extend the end date so the affected travel and activities can fit.', options: extensions });
    actions.push({ label: 'Build a lighter day-by-day plan', description: 'Keep the Trip Brief but use fewer activities that fit the available time.', options: [{ label: 'Use a lighter itinerary', message: 'Rebuild this trip with a lighter day-by-day activity arrangement. Keep the same dates, travel choices, stay and preferences, but only use activities that fit the available times.' }] });
  }
  if (issue.retryable) {
    const selectionRetry = issue.code === 'selection_invalid';
    actions.push({
      label: selectionRetry ? 'Try a different day-by-day arrangement' : issue.code === 'no_stays' ? 'Retry the stay search' : 'Retry the activity search',
      description: selectionRetry ? 'The place searches succeeded; only the previous arrangement failed validation.' : `The previous ${issue.code === 'no_stays' ? 'stay' : 'activity'} search did not finish, so a fresh request can return different results.`,
      options: [{ label: selectionRetry ? 'Rearrange these places' : issue.code === 'no_stays' ? 'Search for stays again' : 'Search for activities again', message: selectionRetry ? 'Arrange the same verified stays and activities again, using a different day-by-day combination that fits the available times.' : 'Repeat the live searches that did not finish and plan again with the rest of my Trip Brief unchanged.' }],
    });
  }
  return actions;
}

function dateExtensionChoices(brief: LiveBrief): RecoveryChoice[] {
  if (!brief.startDate || !brief.days || brief.days >= LIVE_TRIP_MAX_DAYS) return [];
  return [1, 2].flatMap(extra => {
    const days = brief.days! + extra;
    if (days > LIVE_TRIP_MAX_DAYS) return [];
    const endDate = addDays(brief.startDate!, days - 1);
    return [{ label: `Add ${extra} day${extra === 1 ? '' : 's'} · until ${formatShortDate(endDate)}`, message: `Extend my trip through ${endDate} to ${days} calendar days and ${days - 1} hotel nights. Keep the start date and my other Trip Brief choices unchanged.` }];
  });
}

function recoveryTravelCopy(mode: NonNullable<LiveBrief['travelMode']>, journeyLabel: string) {
  if (mode === 'flight') return { label: journeyLabel === 'outbound' ? 'Fly outbound instead' : 'Fly after the destination', description: `Replaces the long ${journeyLabel} road journey with a flight and preserves more destination time.` };
  if (mode === 'train') return { label: journeyLabel === 'outbound' ? 'Take a train outbound' : 'Take a train after the destination', description: `Replaces the long ${journeyLabel} drive with a train search.` };
  if (mode === 'bus') return { label: journeyLabel === 'outbound' ? 'Take a bus outbound' : 'Take a bus after the destination', description: `Replaces the long ${journeyLabel} drive with a bus search.` };
  if (mode === 'recommend') return { label: 'Let the planner choose faster travel', description: `Compares faster options for the ${journeyLabel} journey using duration, available fare evidence, budget, and group size.` };
  return { label: `Use ${mode === 'self_drive' ? 'self drive' : 'a private cab'} ${journeyLabel}`, description: `Changes only the ${journeyLabel} journey and checks whether it fits the available dates.` };
}

function recoveryTravelMessage(mode: NonNullable<LiveBrief['travelMode']>) {
  return mode === 'flight' ? 'a flight' : mode === 'train' ? 'a train' : mode === 'bus' ? 'a bus' : mode === 'cab' ? 'a private cab' : mode === 'self_drive' ? 'self drive' : 'the fastest practical option you can verify';
}

export function draftFromBrief(brief: LiveBrief): BriefDraft { return { origin: brief.origin ?? '', destination: brief.destination ?? '', start: brief.startDate ?? '', end: brief.startDate && brief.days ? addDays(brief.startDate, brief.days - 1) : '', adults: brief.travellers ?? 0, children: 0, seniors: 0, budget: '', pace: brief.pace ?? '', interests: brief.preferences, travel: brief.travelMode === 'public_transit' ? 'recommend' : brief.travelMode ?? '', endIntent: brief.endIntent ?? '', onwardDestination: brief.onwardDestination ?? '', endTravel: brief.endTravelMode === 'public_transit' ? 'recommend' : brief.endTravelMode ?? '' }; }
function essentialAnswer(label: string, message: string, patch?: Partial<LiveBrief>): EssentialAnswer { return { label, message, patch }; }
function pickupAnswers(origin: string): EssentialAnswer[] {
  return [
    essentialAnswer(`${origin} city centre`, `Use ${origin} city centre as my starting point.`, { pickupLocation: `${origin} city centre` }),
    essentialAnswer(`${origin} airport`, `Use ${origin} airport as my starting point.`, { pickupLocation: `${origin} airport` }),
    essentialAnswer(`${origin} railway station`, `Use ${origin} railway station as my starting point.`, { pickupLocation: `${origin} railway station` }),
    { label: 'My current location', message: 'Use my current location as my starting point.', action: 'current_location' },
    { label: 'Add address in chat', message: 'I want to add my pickup address in chat.', action: 'compose_pickup' },
  ];
}
export function currentLocationAnswer(latitude: number, longitude: number): EssentialAnswer {
  const coordinates = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  return { label: 'My current location', message: `Use my current location (${coordinates}) as my starting point.`, patch: { pickupLocation: coordinates } };
}
export function stageEssentialAnswer(current: StagedEssentialAnswers, field: LiveEssentialField, answer: EssentialAnswer): StagedEssentialAnswers {
  const next = { ...current };
  if (current[field]?.label === answer.label) delete next[field];
  else next[field] = answer;
  if (field === 'trip_end') {
    delete next.onward_destination;
    delete next.end_transport;
  }
  return next;
}
export function stagedEssentialAnswerCount(answers: StagedEssentialAnswers) { return Object.values(answers).filter(Boolean).length; }
export function batchEssentialAnswerMessage(answers: StagedEssentialAnswers) {
  return `Update these Trip Essentials together: ${Object.values(answers).map(answer => answer?.message).filter(Boolean).join(' ')}`;
}
export function stageRecoveryAnswer(current: Record<string, RecoveryChoice>, group: string, answer: RecoveryChoice) {
  const next = { ...current };
  if (current[group]?.label === answer.label) delete next[group];
  else next[group] = answer;
  return next;
}
export function batchRecoveryAnswerMessage(answers: Record<string, RecoveryChoice>) {
  return `Apply these trip adjustments together: ${Object.values(answers).map(answer => answer.message).filter(Boolean).join(' ')}`;
}
function requiredPreferencesPresent(brief: LiveBrief) {
  if (!brief.travelMode) return false;
  const pickupRequired = brief.travelMode === 'flight' || brief.travelMode === 'self_drive' || brief.travelMode === 'cab';
  if (pickupRequired && !brief.pickupLocation) return false;
  if (!brief.endIntent) return false;
  if (brief.endIntent === 'continue_elsewhere' && !brief.onwardDestination) return false;
  return brief.endIntent === 'end_at_destination' || Boolean(brief.endTravelMode);
}
export function liveBriefUpdateMessage(brief: LiveBrief, draft: BriefDraft) {
  const initial = draftFromBrief(brief);
  const messages: string[] = [];
  if (draft.origin.trim() && draft.origin.trim() !== initial.origin.trim()) messages.push(`Change my starting city to ${draft.origin.trim()}`);
  if (draft.destination.trim() && draft.destination.trim() !== initial.destination.trim()) messages.push(`change my destination to ${draft.destination.trim()}`);
  if ((draft.start !== initial.start || draft.end !== initial.end) && draft.start && draft.end && draft.end >= draft.start) { const days = daysBetween(draft.start, draft.end) + 1; messages.push(`change my travel dates to ${draft.start} through ${draft.end} (${days} calendar days and ${days - 1} hotel nights, checking out on ${draft.end})`); }
  const guests = draft.adults + draft.children + draft.seniors;
  const initialGuests = initial.adults + initial.children + initial.seniors;
  if (guests && (guests !== initialGuests || draft.adults !== initial.adults || draft.children !== initial.children || draft.seniors !== initial.seniors)) messages.push(`change the group to ${draft.adults} adults, ${draft.children} children, and ${draft.seniors} seniors (${guests} travellers total)`);
  if (draft.travel && draft.travel !== initial.travel) messages.push(`change my outward travel preference: ${travelMessage(draft.travel)}`);
  if (draft.endIntent !== initial.endIntent) {
    if (draft.endIntent === 'end_at_destination') messages.push(`end my trip in ${draft.destination.trim()}`);
    if (draft.endIntent === 'return_to_origin') messages.push(`return to ${draft.origin.trim()} after ${draft.destination.trim()}`);
    if (draft.endIntent === 'continue_elsewhere') messages.push(draft.onwardDestination.trim() ? `continue to ${draft.onwardDestination.trim()} after ${draft.destination.trim()}` : `continue elsewhere after ${draft.destination.trim()}`);
  } else if (draft.endIntent === 'continue_elsewhere' && draft.onwardDestination.trim() !== initial.onwardDestination.trim()) {
    messages.push(`change my next destination to ${draft.onwardDestination.trim()}`);
  }
  if (draft.endIntent !== 'end_at_destination' && draft.endTravel && draft.endTravel !== initial.endTravel) messages.push(`change my travel after ${draft.destination.trim()}: ${travelMessage(draft.endTravel)}`);
  if (draft.budget !== initial.budget && draft.budget) messages.push(`set my total trip budget to ₹${draft.budget}`);
  if (draft.pace && draft.pace !== initial.pace) messages.push(`change the pace to ${draft.pace}`);
  if (draft.interests.trim() !== initial.interests.trim()) messages.push(`change my interests to ${draft.interests.trim()}`);
  return `Update my Trip Brief: ${messages.join('; ')}.`;
}
function travelMessage(choice: TravelChoice) { return choice === 'flight' ? 'I prefer to fly' : choice === 'train' ? 'I prefer train travel' : choice === 'bus' ? 'I prefer bus travel' : choice === 'cab' ? 'I prefer a private cab' : choice === 'self_drive' ? 'I will drive my own vehicle' : 'recommend the best travel mode using observed duration, available fare evidence, my budget, interests, and group size'; }
function addDays(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function daysBetween(start: string, end: string) { return Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000); }
function formatDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function formatShortDate(date: string) { return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function guestLabel(draft: BriefDraft) { const total = draft.adults + draft.children + draft.seniors; return total ? `${total} traveller${total === 1 ? '' : 's'}` : 'Select guests'; }
function preferenceLabel(draft: BriefDraft) { const end = draft.endIntent === 'end_at_destination' ? 'Ends here' : draft.endIntent === 'return_to_origin' ? `Return${draft.endTravel ? ` by ${travelLabel(draft.endTravel)}` : ''}` : draft.endIntent === 'continue_elsewhere' ? `Continue to ${draft.onwardDestination || 'another destination'}` : ''; const parts = [draft.travel ? travelLabel(draft.travel) : '', end, draft.budget ? `₹${draft.budget}` : '', draft.pace ? `${draft.pace} pace` : '', draft.interests].filter(Boolean); return parts.length ? parts.join(' · ') : 'Add preferences'; }
function travelLabel(choice: TravelChoice) { return choice === 'self_drive' ? 'Self Drive' : choice === 'recommend' ? 'Recommend Me' : choice ? choice[0].toUpperCase() + choice.slice(1) : ''; }
