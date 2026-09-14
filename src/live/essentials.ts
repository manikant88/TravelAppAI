import { addCalendarDays } from '@/domain/dates';
import { LIVE_TRIP_MAX_DAYS, LIVE_TRIP_MIN_DAYS, type LiveBrief } from './contracts';

export type LiveEssentialField = 'destination' | 'origin' | 'dates' | 'travellers' | 'transport' | 'pickup' | 'trip_end' | 'onward_destination' | 'end_transport' | 'dining' | 'pace';

export type LiveEssentialsDraft = {
  destination: string;
  origin: string;
  startDate: string;
  days: string;
  travellers: string;
  travelMode: '' | 'self_drive' | 'public_transit' | 'flight' | 'train' | 'bus' | 'cab' | 'recommend';
  pickupLocation: string;
  endIntent: '' | 'return_to_origin' | 'end_at_destination' | 'continue_elsewhere';
  onwardDestination: string;
  endTravelMode: LiveEssentialsDraft['travelMode'];
  nightsConfirmed: boolean;
  dietaryPreference: '' | 'vegetarian' | 'pure_vegetarian' | 'non_vegetarian' | 'both';
  dietaryNotes: string;
  pace: '' | 'relaxed' | 'balanced' | 'packed';
};

export type LiveEssentialRequirementContext = {
  today: string;
  flightConfigured: boolean;
  modelQuestion?: string | null;
};

export type LiveEssentialSuggestion = { label: string; message: string; action?: 'current_location' | 'compose_pickup' };

export function liveEssentialSuggestions(brief: LiveBrief): LiveEssentialSuggestion[] {
  if (!brief.destination) return [{ label: 'Help me choose', message: 'Help me choose a destination based on my dates, budget, and interests.' }];
  if (!brief.origin) return [
    { label: 'Start from Delhi', message: 'My starting city is Delhi.' },
    { label: 'Start from Mumbai', message: 'My starting city is Mumbai.' },
    { label: 'Start from Bengaluru', message: 'My starting city is Bengaluru.' },
  ];
  if (!brief.travellers) return [
    { label: 'Just me', message: 'It is just me, one adult traveller.' },
    { label: '2 adults', message: 'There are 2 adult travellers.' },
    { label: '2 adults + 1 child', message: 'There are 2 adults and 1 child, 3 travellers total.' },
  ];
  if (!brief.days) return [
    { label: '3 days', message: 'Plan this as a 3-day trip.' },
    { label: '4 days', message: 'Plan this as a 4-day trip.' },
    { label: '5 days', message: 'Plan this as a 5-day trip.' },
  ];
  if (!brief.startDate) return [];
  if (!brief.nightsConfirmed) return [
    { label: `Yes, ${brief.days - 1} nights`, message: `Yes, use ${brief.days} calendar days as ${brief.days - 1} hotel nights and checkout on ${addCalendarDays(brief.startDate, brief.days - 1)}.` },
  ];
  if ((brief.travelMode === 'flight' || brief.travelMode === 'self_drive' || brief.travelMode === 'cab') && !brief.pickupLocation) return brief.origin ? [
    { label: `${brief.origin} city centre`, message: `Use ${brief.origin} city centre as my starting point.` },
    { label: `${brief.origin} airport`, message: `Use ${brief.origin} airport as my starting point.` },
    { label: `${brief.origin} railway station`, message: `Use ${brief.origin} railway station as my starting point.` },
    { label: 'My current location', message: 'Use my current location as my starting point.', action: 'current_location' },
    { label: 'Add address in chat', message: 'I want to add my pickup address in chat.', action: 'compose_pickup' },
  ] : [];
  if (brief.endIntent === 'continue_elsewhere' && !brief.onwardDestination) return [];
  return [];
}

/** Applies planner-owned defaults only where the traveller has not expressed a choice. */
export function applyLivePlanningDefaults(brief: LiveBrief): LiveBrief {
  const next = { ...brief };
  if (!next.travelMode) next.travelMode = 'recommend';
  if (!next.endIntent) next.endIntent = 'return_to_origin';
  if (next.endIntent === 'end_at_destination') next.endTravelMode = null;
  else if (!next.endTravelMode) next.endTravelMode = 'recommend';
  return next;
}

export function missingLiveEssential(brief: LiveBrief, context: LiveEssentialRequirementContext): string | null {
  if (!brief.destination) return 'Which destination would you like to explore?';
  if (!brief.origin) return 'Which city are you travelling from?';
  if (!brief.travellers) return 'How many travellers are going?';
  if (!brief.days) return `How many calendar days will you travel? This live planner supports ${LIVE_TRIP_MIN_DAYS}–${LIVE_TRIP_MAX_DAYS} days.`;
  if (!brief.startDate) return `Please confirm your start date including the year. Should I treat ${brief.days} days as ${brief.days - 1} nights?`;
  if (brief.startDate < context.today) return 'That start date is in the past. What future date should I use?';
  if (!brief.nightsConfirmed) return `Should I treat ${brief.days} days as ${brief.days - 1} nights, checking out on ${addCalendarDays(brief.startDate, brief.days - 1)}? Please confirm the year too.`;
  if ((brief.travelMode === 'self_drive' || brief.travelMode === 'flight' || brief.travelMode === 'cab') && !brief.pickupLocation) {
    return brief.travelMode === 'flight'
      ? 'Where should your airport transfer start? A neighbourhood, landmark or public meeting point is enough.'
      : brief.travelMode === 'cab'
        ? 'Where should the cab pick you up? A neighbourhood, landmark or public meeting point is enough.'
        : 'Where will you start driving from? A neighbourhood or nearby landmark is enough.';
  }
  if (brief.travelMode === 'flight' && !context.flightConfigured) return 'Flight search is not available in this environment yet. You can choose train, bus, cab, self-drive or Recommend Me, or try flights again after it is configured.';
  if (brief.endIntent === 'continue_elsewhere' && !brief.onwardDestination) return `Where would you like to go after ${brief.destination}?`;
  if (brief.endTravelMode === 'flight' && !context.flightConfigured) return 'Flight search is not available for your journey after the destination in this environment yet. Choose another mode or try again after it is configured.';
  // Optional model questions never override the deterministic readiness contract.
  // In particular, a later flight begins at the selected stay and does not need a
  // second pickup address before the stay has even been chosen.
  return null;
}

export function liveEssentialReadiness(brief: LiveBrief) {
  const pickupRequired = brief.travelMode === 'self_drive' || brief.travelMode === 'flight' || brief.travelMode === 'cab';
  const checks = [
    Boolean(brief.destination),
    Boolean(brief.origin),
    Boolean(brief.startDate),
    Boolean(brief.days),
    Boolean(brief.travellers),
    brief.nightsConfirmed,
    ...(pickupRequired ? [Boolean(brief.pickupLocation)] : []),
    ...(brief.endIntent === 'continue_elsewhere' ? [Boolean(brief.onwardDestination)] : []),
  ];
  return { complete: checks.filter(Boolean).length, total: checks.length, ready: checks.every(Boolean) };
}

export function draftFromLiveBrief(brief: LiveBrief): LiveEssentialsDraft {
  return {
    destination: brief.destination ?? '',
    origin: brief.origin ?? '',
    startDate: brief.startDate ?? '',
    days: brief.days?.toString() ?? '',
    travellers: brief.travellers?.toString() ?? '',
    travelMode: brief.travelMode ?? '',
    pickupLocation: brief.pickupLocation ?? '',
    endIntent: brief.endIntent ?? 'return_to_origin',
    onwardDestination: brief.onwardDestination ?? '',
    endTravelMode: brief.endTravelMode ?? (brief.endIntent === 'end_at_destination' ? '' : 'recommend'),
    nightsConfirmed: brief.nightsConfirmed,
    dietaryPreference: brief.dietaryPreference ?? '',
    dietaryNotes: brief.dietaryNotes,
    pace: brief.pace ?? '',
  };
}

export function liveEssentialsMessage(draft: LiveEssentialsDraft) {
  const days = Number(draft.days);
  const travellers = Number(draft.travellers);
  const travel = draft.travelMode === 'flight' ? 'I prefer to fly.'
    : draft.travelMode === 'self_drive' ? 'I will drive my own vehicle.'
    : draft.travelMode === 'train' ? 'I prefer to travel by train.'
    : draft.travelMode === 'bus' ? 'I prefer to travel by bus.'
    : draft.travelMode === 'cab' ? 'I prefer a private cab.'
    : draft.travelMode === 'recommend' ? 'Recommend a travel option that suits my budget and group size.'
    : 'I prefer public transport such as trains or buses.';
  const parts = [
    `Plan a ${days}-day trip from ${draft.origin.trim()} to ${draft.destination.trim()} starting ${draft.startDate} for ${travellers} traveller${travellers === 1 ? '' : 's'}.`,
    `I confirm ${days - 1} hotel night${days - 1 === 1 ? '' : 's'} and checkout on ${addCalendarDays(draft.startDate, days - 1)}.`,
    travel,
  ];
  if (draft.pickupLocation.trim() && (draft.travelMode === 'flight' || draft.travelMode === 'self_drive' || draft.travelMode === 'cab')) parts.push(`Use ${draft.pickupLocation.trim()} as my starting point.`);
  if (draft.endIntent === 'end_at_destination') parts.push(`My trip ends in ${draft.destination.trim()}.`);
  if (draft.endIntent === 'return_to_origin') parts.push(`I will return to ${draft.origin.trim()} after this destination.`);
  if (draft.endIntent === 'continue_elsewhere' && draft.onwardDestination.trim()) parts.push(`After this destination I will continue to ${draft.onwardDestination.trim()}.`);
  if (draft.endIntent !== 'end_at_destination' && draft.endTravelMode) parts.push(`For that journey, ${travelModeSentence(draft.endTravelMode)}`);
  if (draft.dietaryPreference) parts.push(`My dining preference is ${draft.dietaryPreference.replaceAll('_', ' ')}.`);
  if (draft.dietaryNotes.trim()) parts.push(`Dining notes: ${draft.dietaryNotes.trim()}.`);
  if (draft.pace) parts.push(`Use a ${draft.pace} trip pace.`);
  return parts.join(' ');
}

function travelModeSentence(mode: Exclude<LiveEssentialsDraft['endTravelMode'], ''>) {
  return mode === 'self_drive' ? 'I will drive myself.' : mode === 'cab' ? 'I prefer a private cab.' : mode === 'recommend' ? 'recommend the most practical mode.' : mode === 'public_transit' ? 'I prefer public transport.' : `I prefer ${mode}.`;
}
