import { addCalendarDays } from '@/domain/dates';
import type { LiveBrief } from './contracts';

export type LiveEssentialField = 'destination' | 'origin' | 'dates' | 'travellers' | 'transport' | 'pickup' | 'dining' | 'pace';

export type LiveEssentialsDraft = {
  destination: string;
  origin: string;
  startDate: string;
  days: string;
  travellers: string;
  travelMode: '' | 'self_drive' | 'public_transit' | 'flight' | 'train' | 'bus' | 'cab' | 'recommend';
  pickupLocation: string;
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

export type LiveEssentialSuggestion = { label: string; message: string };

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
  if (!brief.travelMode) return [
    { label: 'Flight', message: 'I prefer to fly.' },
    { label: 'Train', message: 'I prefer to travel by train.' },
    { label: 'Bus', message: 'I prefer to travel by bus.' },
    { label: 'Cab', message: 'I prefer a private cab.' },
    { label: 'Self Drive', message: 'I will drive my own vehicle.' },
    { label: 'Recommend Me', message: 'Recommend the best travel mode using observed route evidence, my budget and group size.' },
  ];
  if ((brief.travelMode === 'flight' || brief.travelMode === 'self_drive' || brief.travelMode === 'cab') && !brief.pickupLocation) return brief.origin ? [
    { label: `${brief.origin} city centre`, message: `Use ${brief.origin} city centre as my starting point.` },
    { label: 'I’ll enter a pickup point', message: 'I want to provide a specific pickup area or public meeting point.' },
  ] : [];
  return [];
}

export function missingLiveEssential(brief: LiveBrief, context: LiveEssentialRequirementContext): string | null {
  if (!brief.destination) return 'Which destination would you like to explore?';
  if (!brief.origin) return 'Which city are you travelling from?';
  if (!brief.travellers) return 'How many travellers are going?';
  if (!brief.days) return 'How many calendar days will you travel? This live planner supports 2–7 days.';
  if (!brief.startDate) return `Please confirm your start date including the year. Should I treat ${brief.days} days as ${brief.days - 1} nights?`;
  if (brief.startDate < context.today) return 'That start date is in the past. What future date should I use?';
  if (!brief.nightsConfirmed) return `Should I treat ${brief.days} days as ${brief.days - 1} nights, checking out on ${addCalendarDays(brief.startDate, brief.days - 1)}? Please confirm the year too.`;
  if (!brief.travelMode) return 'How would you prefer to travel for this trip: flight, train, bus, cab, self drive, or should I recommend a route from the available evidence?';
  if ((brief.travelMode === 'self_drive' || brief.travelMode === 'flight' || brief.travelMode === 'cab') && !brief.pickupLocation) {
    return `What starting area or pickup address should I use for your ${brief.travelMode === 'flight' ? 'airport transfer' : brief.travelMode === 'cab' ? 'cab estimate' : 'driving estimate'}? You can use a public meeting point instead of a private address. Your answer is sent to the AI planner and Google Maps for this local session, is not shared with other travellers, and is cleared on refresh.`;
  }
  if (brief.travelMode === 'flight' && !context.flightConfigured) return 'Flight search is not available in this environment yet. You can choose train, bus, cab, self-drive or Recommend Me, or try flights again after it is configured.';
  return context.modelQuestion ?? null;
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
    Boolean(brief.travelMode),
    ...(pickupRequired ? [Boolean(brief.pickupLocation)] : []),
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
    : draft.travelMode === 'recommend' ? 'Recommend the best travel mode using observed route evidence, my budget and group size.'
    : 'I prefer public transport such as trains or buses.';
  const parts = [
    `Plan a ${days}-day trip from ${draft.origin.trim()} to ${draft.destination.trim()} starting ${draft.startDate} for ${travellers} traveller${travellers === 1 ? '' : 's'}.`,
    `I confirm ${days - 1} hotel night${days - 1 === 1 ? '' : 's'} and checkout on ${addCalendarDays(draft.startDate, days - 1)}.`,
    travel,
  ];
  if (draft.pickupLocation.trim() && (draft.travelMode === 'flight' || draft.travelMode === 'self_drive' || draft.travelMode === 'cab')) parts.push(`Use ${draft.pickupLocation.trim()} as my starting point.`);
  if (draft.dietaryPreference) parts.push(`My dining preference is ${draft.dietaryPreference.replaceAll('_', ' ')}.`);
  if (draft.dietaryNotes.trim()) parts.push(`Dining notes: ${draft.dietaryNotes.trim()}.`);
  if (draft.pace) parts.push(`Use a ${draft.pace} trip pace.`);
  return parts.join(' ');
}
