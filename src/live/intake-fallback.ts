import type { LiveBrief, LiveRequest } from './contracts';
import { explicitLiveDateRange } from './explicit-dates';

export function deterministicBriefFallback(input: LiveRequest): LiveBrief | undefined {
  const brief: LiveBrief = { ...input.brief };
  const text = input.message.trim();
  let changed = false;
  let recognized = false;
  const route = /\bfrom\s+([^,.;]{2,60}?)\s+to\s+([^,.;]{2,60}?)(?=\s+(?:for|from|between|on|starting|with)\b|[,.]|$)/i.exec(text);
  if (route) {
    recognized = true;
    const origin = route[1].trim();
    const destination = route[2].trim();
    if (origin && origin !== brief.origin) { brief.origin = origin; changed = true; }
    if (destination && destination !== brief.destination) { brief.destination = destination; changed = true; }
  }
  const dates = explicitLiveDateRange(text);
  if (dates) {
    recognized = true;
    if (dates.startDate !== brief.startDate || dates.days !== brief.days || !brief.nightsConfirmed) {
      brief.startDate = dates.startDate;
      brief.days = dates.days;
      brief.nightsConfirmed = true;
      changed = true;
    }
  }
  const count = travellerCount(text);
  if (count) { recognized = true; if (count !== brief.travellers) { brief.travellers = count; changed = true; } }
  const mode = explicitTravelMode(text);
  if (mode) { recognized = true; if (mode !== brief.travelMode) { brief.travelMode = mode; brief.roadTripConfirmed = false; changed = true; } }
  const pickup = explicitPickupLocation(text);
  if (pickup) { recognized = true; if (pickup !== brief.pickupLocation) { brief.pickupLocation = pickup; changed = true; } }
  const endIntent = explicitEndIntent(text, brief);
  if (endIntent) {
    recognized = true;
    if (endIntent.intent !== brief.endIntent || endIntent.onwardDestination !== undefined && endIntent.onwardDestination !== brief.onwardDestination) {
      brief.endIntent = endIntent.intent;
      brief.onwardDestination = endIntent.intent === 'continue_elsewhere' ? endIntent.onwardDestination ?? null : null;
      if (endIntent.intent === 'end_at_destination') brief.endTravelMode = null;
      changed = true;
    }
  }
  const endMode = explicitEndTravelMode(text, brief.travelMode);
  if (endMode) { recognized = true; if (endMode !== brief.endTravelMode) { brief.endTravelMode = endMode; changed = true; } }
  if (/\b(?:make|treat) (?:it|the (?:multi-day )?journey) as (?:a|the main part of (?:the|my)) road trip\b/i.test(text) && !brief.roadTripConfirmed) {
    brief.roadTripConfirmed = true;
    recognized = true;
    changed = true;
  }
  const pace = /\brelaxed\b/i.test(text) ? 'relaxed' : /\b(?:balanced|moderate)\b/i.test(text) ? 'balanced' : /\b(?:packed|fast[- ]paced)\b/i.test(text) ? 'packed' : undefined;
  if (pace) { recognized = true; if (pace !== brief.pace) { brief.pace = pace; changed = true; } }
  const interests = /\b(?:prioriti[sz]e|interested in)\s+(.+?)(?:\.|$)/i.exec(text)?.[1]?.trim();
  if (interests) { recognized = true; if (interests !== brief.preferences) { brief.preferences = interests; changed = true; } }
  return changed || recognized ? brief : undefined;
}

function travellerCount(text: string) {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const value = (raw: string) => Number(raw) || words[raw.toLowerCase()];
  const generic = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:travellers?|travelers?|guests?|people|persons?)\b/i.exec(text);
  if (generic) return value(generic[1]);
  let total = 0;
  let found = false;
  for (const match of text.matchAll(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:adults?|children|child|seniors?)\b/gi)) {
    total += value(match[1]);
    found = true;
  }
  if (found) return total;
  if (/\bwith my (?:wife|husband|partner)\b/i.test(text)) return 2;
  return undefined;
}

function explicitTravelMode(text: string): LiveBrief['travelMode'] | undefined {
  const outwardText = text.split(/[.!?;]+/).filter(sentence => !/\b(?:after|return|back|onward|later journey|journey after)\b/i.test(sentence)).join('. ');
  return travelModeIn(outwardText);
}

function explicitEndTravelMode(text: string, outwardMode: LiveBrief['travelMode']): LiveBrief['endTravelMode'] | undefined {
  const endText = text.split(/[.!?;]+/).filter(sentence => /\b(?:after|return|back|onward|later journey|journey after|for that journey)\b/i.test(sentence)).join('. ');
  if (/\b(?:same|the same) (?:travel )?mode\b/i.test(endText) && outwardMode) return outwardMode;
  return travelModeIn(endText);
}

function travelModeIn(text: string): LiveBrief['travelMode'] | undefined {
  if (/\b(?:self[- ]drive|drive my own|own vehicle)\b/i.test(text)) return 'self_drive';
  if (/\b(?:private cab|by cab|take a cab)\b/i.test(text)) return 'cab';
  if (/\b(?:fly|flight|by air)\b/i.test(text)) return 'flight';
  if (/\b(?:by train|train travel|take a train)\b/i.test(text)) return 'train';
  if (/\b(?:by bus|bus travel|take a bus)\b/i.test(text)) return 'bus';
  if (/\brecommend (?:the )?(?:best )?(?:travel mode|way to travel)|recommend how I should travel\b/i.test(text)) return 'recommend';
  return undefined;
}

function explicitPickupLocation(text: string) {
  const match = /\buse\s+(.{2,120}?)\s+as my (?:pickup|starting) (?:point|location)\b/i.exec(text)
    ?? /\b(?:pick me up|pickup(?: location)? is)\s+(?:at|from)?\s*(.{2,120}?)(?:[.!?]|$)/i.exec(text);
  return match?.[1]?.trim().replace(/[,.]+$/, '');
}

function explicitEndIntent(text: string, brief: LiveBrief): { intent: NonNullable<LiveBrief['endIntent']>; onwardDestination?: string } | undefined {
  if (/\b(?:my trip ends|end (?:my|the) trip) (?:here|there|in|at)\b/i.test(text)) return { intent: 'end_at_destination' };
  const onward = /\b(?:continue|go|travel) to\s+([^,.;]{2,60}?)\s+after\s+(?:this destination|[^,.;]+)/i.exec(text);
  if (onward) return { intent: 'continue_elsewhere', onwardDestination: onward[1].trim() };
  if (/\b(?:want to|will|plan to)?\s*return to\s+[^,.;]+?(?:\s+after\s+(?:this destination|[^,.;]+))?(?:[,.]|$)/i.test(text)) return { intent: 'return_to_origin' };
  if (/\bcontinue (?:elsewhere|to another destination)\b/i.test(text)) return { intent: 'continue_elsewhere', onwardDestination: brief.onwardDestination ?? undefined };
  return undefined;
}
