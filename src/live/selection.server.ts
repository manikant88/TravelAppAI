import type { LiveProvider } from './google.server';
import type { LivePlace, LivePlan, LiveSelectionImpact, LiveSelectionRequest, LiveSelectionResponse, LiveTravelOption } from './contracts';
import { hoursValidationNote, regularHoursStatus } from './opening-hours';
import type { FlightHub, FlightProvider } from '@/transport/providers/nuitee-flight.server';
import type { TransportOffer } from '@/inventory/contracts';
import { dayStops, projectLiveDay } from './timeline';
import { applyScheduleValidations, plannerDayEnd, plannerDayStart } from './planner';
import { activityDuration, activityDurationProfile, prepareDaySchedule, reflowAndAssessDay } from './scheduler';

export class LiveSelectionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Dependencies = { provider: LiveProvider; flightProvider?: FlightProvider; guestNationality?: string; signal: AbortSignal; now?: string };
const unlocked = { hotel: false, outboundFlight: false, returnFlight: false, outboundTravel: false, returnTravel: false, activityIds: [] as string[] };

export async function applyLiveSelection(input: LiveSelectionRequest, deps: Dependencies): Promise<LiveSelectionResponse> {
  deps.signal.throwIfAborted();
  const plan = structuredClone(input.plan) as LivePlan;
  plan.locks = { ...unlocked, ...plan.locks };
  const command = input.command;

  if (command.type === 'set_lock') {
    plan.locks[command.target] = command.locked;
    return { kind: 'live-selection', plan, message: command.locked ? `I’ll keep the ${label(command.target).toLowerCase()} fixed while you change the rest of the trip.` : `The ${label(command.target).toLowerCase()} can be changed again.` };
  }

  if (command.type === 'set_activity_lock') {
    const selected = plan.days.some(day => day.visits.some(visit => visit.place.id === command.placeId));
    if (!selected) throw new LiveSelectionError('That activity is not selected in the current itinerary.');
    const ids = new Set(plan.locks.activityIds ?? []);
    if (command.locked) ids.add(command.placeId); else ids.delete(command.placeId);
    plan.locks.activityIds = [...ids];
    return { kind: 'live-selection', plan, message: command.locked ? 'I’ll keep this activity fixed while you change the rest of the day.' : 'This activity can be changed again.' };
  }

  if (command.type === 'retry_flights') {
    if (!deps.flightProvider) throw new LiveSelectionError('Flight search is not configured yet.', 409);
    const origin = plan.flight?.origin ?? plan.travel?.origin;
    const hotel = selectedHotel(plan, plan.flight?.destination ?? plan.travel?.destination);
    if (!origin || origin.utcOffsetMinutes === undefined || hotel.utcOffsetMinutes === undefined) throw new LiveSelectionError('The origin or destination time zone is unavailable, so flights cannot be normalized.', 409);
    let result;
    try {
      result = await deps.flightProvider.search({
        origin: { lat: origin.lat, lng: origin.lng, utcOffsetMinutes: origin.utcOffsetMinutes },
        destination: { lat: hotel.lat, lng: hotel.lng, utcOffsetMinutes: hotel.utcOffsetMinutes },
        departureDate: plan.days[0].date,
        returnDate: plan.days.at(-1)!.date,
        travellers: plan.brief.travellers!,
        currency: 'INR',
        country: deps.guestNationality ?? 'IN',
      });
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() ? `: ${error.message.trim()}` : '';
      throw new LiveSelectionError(`I couldn’t complete the flight search${detail}. Your alternative routes are still available.`, 502);
    }
    const outbound = chooseFlight(result.outbound, 'outbound');
    const returning = chooseFlight(result.returning, 'return');
    if (!outbound && !returning) throw new LiveSelectionError('I couldn’t find a direct flight for either journey. Your alternative routes are still available.', 409);
    const originAirport = hubPlace(result.originHub, origin.utcOffsetMinutes, result.checkedAt);
    const destinationAirport = hubPlace(result.destinationHub, hotel.utcOffsetMinutes, result.checkedAt);
    plan.flight = {
      origin,
      destination: hotel,
      originAirport,
      destinationAirport,
      outbound: result.outbound,
      return: result.returning,
      suggestedOutboundId: outbound?.id ?? null,
      suggestedReturnId: returning?.id ?? null,
      outboundFirstMile: outbound ? await roadRoute(deps, origin, originAirport, 'outbound', minutesBefore(outbound.departureAt, 180)) : undefined,
      outboundLastMile: outbound ? await roadRoute(deps, destinationAirport, hotel, 'outbound', outbound.arrivalAt) : undefined,
      returnFirstMile: returning ? await roadRoute(deps, hotel, destinationAirport, 'return', minutesBefore(returning.departureAt, 180)) : undefined,
      returnLastMile: returning ? await roadRoute(deps, originAirport, origin, 'return', returning.arrivalAt) : undefined,
      assumptions: [`${result.environment === 'sandbox' ? 'Sandbox' : 'Live'} fares expire and must be refreshed before booking.`],
    };
    if (plan.travel?.context === 'flight_fallback') {
      if (outbound) plan.travel.suggestedOutboundId = null;
      if (returning) plan.travel.suggestedReturnId = null;
    }
    plan.warnings = plan.warnings.filter(warning => !warning.startsWith('Flight search failed'));
    for (const warning of result.warnings) addWarning(plan, `Flight search: ${warning}`);
    if (!outbound) addWarning(plan, 'No direct outbound flight offer was returned. Choose a Google route fallback for Day 1.');
    if (!returning) addWarning(plan, 'No direct return flight offer was returned. Choose a Google route fallback for the return journey.');
    plan.checkedAt = new Date().toISOString();
    refreshScheduleAssessment(plan, [0, plan.days.length - 1]);
    return { kind: 'live-selection', plan, message: `I checked the flights again. ${outbound ? `I found ${flightName(outbound)} for the outward journey.` : 'The outward journey still needs another option.'} ${returning ? `I found ${flightName(returning)} for the return.` : 'The return journey still needs another option.'} I recalculated the airport transfers and the time available on your first and last days.` };
  }

  if (command.type === 'select_travel') {
    const target = command.direction === 'outbound' ? 'outboundTravel' : 'returnTravel';
    if (plan.locks[target]) throw new LiveSelectionError(`Unlock the ${command.direction} travel route before changing it.`, 409);
    if (!plan.travel) throw new LiveSelectionError('There are no alternative travel routes to choose from yet.');
    const options = command.direction === 'outbound' ? plan.travel.outbound : plan.travel.return;
    const option = options.find(candidate => candidate.id === command.optionId);
    if (!option) throw new LiveSelectionError('That route is no longer in the available options. Please reopen the list and choose again.');
    if (command.direction === 'outbound') plan.travel.suggestedOutboundId = option.id;
    else plan.travel.suggestedReturnId = option.id;
    if (plan.travel.context === 'flight_fallback' && plan.flight) {
      if (command.direction === 'outbound') plan.flight.suggestedOutboundId = null;
      else plan.flight.suggestedReturnId = null;
    }
    plan.checkedAt = new Date().toISOString();
    refreshScheduleAssessment(plan, command.direction === 'outbound' ? [0] : [plan.days.length - 1]);
    return responseForSelection(input.plan, plan, command, `I switched the ${command.direction} journey to ${option.label}. Its arrival or departure time can change how much of that day is usable, so I recalculated the timeline and map around it.`);
  }

  if (command.type === 'select_flight') {
    const target = command.direction === 'outbound' ? 'outboundFlight' : 'returnFlight';
    if (plan.locks[target]) throw new LiveSelectionError(`Unlock the ${command.direction} flight before changing it.`, 409);
    const flight = plan.flight;
    if (!flight) throw new LiveSelectionError('This plan has no flight journey to change.');
    const offers = command.direction === 'outbound' ? flight.outbound : flight.return;
    const offer = offers.find(candidate => candidate.id === command.offerId);
    if (!offer) throw new LiveSelectionError('That flight is no longer in the available options. Please reopen the list and choose again.');
    assertSelectable(offer.availability, offer.source.expiresAt, deps.now);
    if (command.direction === 'outbound') {
      flight.suggestedOutboundId = offer.id;
      if (plan.travel?.context === 'flight_fallback') plan.travel.suggestedOutboundId = null;
      const [first, last] = await Promise.all([
        roadRoute(deps, flight.origin, flight.originAirport, 'outbound', minutesBefore(offer.departureAt, 180)),
        roadRoute(deps, flight.destinationAirport, flight.destination, 'outbound', offer.arrivalAt),
      ]);
      flight.outboundFirstMile = first;
      flight.outboundLastMile = last;
    } else {
      flight.suggestedReturnId = offer.id;
      if (plan.travel?.context === 'flight_fallback') plan.travel.suggestedReturnId = null;
      const [first, last] = await Promise.all([
        roadRoute(deps, flight.destination, flight.destinationAirport, 'return', minutesBefore(offer.departureAt, 180)),
        roadRoute(deps, flight.originAirport, flight.origin, 'return', offer.arrivalAt),
      ]);
      flight.returnFirstMile = first;
      flight.returnLastMile = last;
    }
    plan.checkedAt = new Date().toISOString();
    refreshScheduleAssessment(plan, command.direction === 'outbound' ? [0] : [plan.days.length - 1]);
    addWarning(plan, `You selected ${offer.operator} ${offer.segments[0]?.number ?? ''} for the ${command.direction} journey. Its fare and availability still require refresh before booking.`);
    return responseForSelection(input.plan, plan, command, `I switched the ${command.direction} journey to ${flightName(offer)}. I also recalculated the airport transfers and the time available on that travel day.`);
  }

  if (command.type === 'select_activity') {
    const day = plan.days[command.dayIndex];
    const current = day?.visits[command.visitIndex];
    if (!day || !current) throw new LiveSelectionError('That itinerary activity no longer exists.');
    if ((plan.locks.activityIds ?? []).includes(current.place.id)) throw new LiveSelectionError('Unlock the activity before changing it.', 409);
    const candidate = plan.activityOptions?.find(place => place.id === command.placeId);
    if (!candidate) throw new LiveSelectionError('That activity is no longer in the available options. Please reopen the list and choose again.');
    const usedElsewhere = plan.days.some((value, dayIndex) => value.visits.some((visit, visitIndex) => visit.place.id === candidate.id && (dayIndex !== command.dayIndex || visitIndex !== command.visitIndex)));
    if (usedElsewhere) throw new LiveSelectionError('That activity is already included elsewhere in the itinerary.', 409);
    let place = candidate;
    try { place = await deps.provider.details(candidate.id); }
    catch { /* The observed search result remains usable, with its missing facts explicit. */ }
    const status = regularHoursStatus(place, day.date);
    if (status === 'closed') throw new LiveSelectionError(`${place.name} is usually closed on ${day.date}. Choose another valid option.`, 409);
    const durationProfile = activityDurationProfile(place, current.durationMinutes, current.timingEvidence);
    day.visits[command.visitIndex] = { ...current, place, durationProfile, durationMinutes: activityDuration(durationProfile, plan.brief.travellers ?? 1), timingKind: current.timingEvidence ? 'fixed' : 'estimated', fixedStartMinutes: current.timingEvidence?.startMinutes, hoursStatus: status === 'open' ? 'open' : 'unknown', hoursNote: hoursValidationNote(status, day.date) };
    plan.activityOptions = plan.activityOptions?.map(option => option.id === place.id ? place : option);
    invalidateMealRouteEvidence(day, selectedHotel(plan));
    await refreshDayRoutes(day, selectedHotel(plan), deps);
    refreshScheduleAssessment(plan, [command.dayIndex]);
    plan.checkedAt = new Date().toISOString();
    return responseForSelection(input.plan, plan, command, `I replaced ${current.place.name} with ${place.name}. I checked its regular hours, recalculated the surrounding transfers and moved later items only where the day still fits.`);
  }

  if (command.type !== 'select_hotel') throw new LiveSelectionError('Unsupported live selection.');
  if (plan.locks.hotel) throw new LiveSelectionError('Unlock the stay before changing it.', 409);
  const hotel = plan.hotels.find(candidate => candidate.id === command.hotelId);
  if (!hotel) throw new LiveSelectionError('That stay is not part of the current results.');
  if (hotel.stayOffer) assertSelectable(hotel.stayOffer.availability, hotel.stayOffer.source.expiresAt, deps.now);
  plan.selectedHotelId = hotel.id;
  await refreshHotelDependencies(plan, hotel, deps);
  refreshScheduleAssessment(plan, plan.days.map((_, index) => index));
  plan.checkedAt = new Date().toISOString();
  addWarning(plan, `You selected ${hotel.name}. The connected routes were refreshed; its price and availability still need a final check before booking.`);
  return responseForSelection(input.plan, plan, command, `I switched your stay to ${hotel.name}. Because this changes the base for the trip, I recalculated airport or intercity travel, daily transfers and meal routes before keeping the new schedule.`);
}

async function refreshHotelDependencies(plan: LivePlan, hotel: LivePlan['hotels'][number], deps: Dependencies) {
  if (plan.travel) {
    const firstDate = plan.days[0].date;
    const lastDate = plan.days.at(-1)!.date;
    const previousOutbound = plan.travel.outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
    const previousReturn = plan.travel.return.find(option => option.id === plan.travel?.suggestedReturnId);
    let outbound: LiveTravelOption[];
    let returning: LiveTravelOption[];
    if (plan.travel.context === 'flight_fallback') {
      const [outboundRoad, outboundTransit, returnRoad, returnTransit] = await Promise.all([
        routeOptions(deps, plan.travel.origin, hotel, 'outbound', 'drive', departureTime(firstDate, 8, plan.travel.origin.utcOffsetMinutes)),
        routeOptions(deps, plan.travel.origin, hotel, 'outbound', 'transit', departureTime(firstDate, 8, plan.travel.origin.utcOffsetMinutes)),
        routeOptions(deps, hotel, plan.travel.origin, 'return', 'drive', departureTime(lastDate, 17, hotel.utcOffsetMinutes)),
        routeOptions(deps, hotel, plan.travel.origin, 'return', 'transit', departureTime(lastDate, 17, hotel.utcOffsetMinutes)),
      ]);
      outbound = [...outboundTransit, ...roadFallbackOptions(outboundRoad)];
      returning = [...returnTransit, ...roadFallbackOptions(returnRoad)];
    } else {
      const profiles = preferredRouteProfiles(plan.brief.travelMode);
      const refreshed = await Promise.all(profiles.flatMap(profile => [
        routeOptions(deps, plan.travel!.origin, hotel, 'outbound', profile.mode, departureTime(firstDate, 8, plan.travel!.origin.utcOffsetMinutes), profile),
        routeOptions(deps, hotel, plan.travel!.origin, 'return', profile.mode, departureTime(lastDate, 17, hotel.utcOffsetMinutes), profile),
      ]));
      outbound = refreshed.filter((_, index) => index % 2 === 0).flat().sort((a, b) => a.minutes - b.minutes);
      returning = refreshed.filter((_, index) => index % 2 === 1).flat().sort((a, b) => a.minutes - b.minutes);
    }
    plan.travel.destination = hotel;
    plan.travel.outbound = outbound;
    plan.travel.return = returning;
    plan.travel.suggestedOutboundId = refreshedSelectionId(outbound, previousOutbound, plan.travel.context !== 'flight_fallback');
    plan.travel.suggestedReturnId = refreshedSelectionId(returning, previousReturn, plan.travel.context !== 'flight_fallback');
  }

  if (plan.flight) {
    const flight = plan.flight;
    flight.destination = hotel;
    const outbound = flight.outbound.find(value => value.id === flight.suggestedOutboundId);
    const returning = flight.return.find(value => value.id === flight.suggestedReturnId);
    flight.outboundLastMile = outbound ? await roadRoute(deps, flight.destinationAirport, hotel, 'outbound', outbound.arrivalAt) : undefined;
    flight.returnFirstMile = returning ? await roadRoute(deps, hotel, flight.destinationAirport, 'return', minutesBefore(returning.departureAt, 180)) : undefined;
  }

  for (let index = 0; index < plan.days.length; index++) {
    const day = plan.days[index];
    day.meals = day.meals?.map(meal => meal.location === 'stay' ? { ...meal, place: hotel } : meal);
    invalidateMealRouteEvidence(day, hotel);
    await refreshDayRoutes(day, hotel, deps);
    applyScheduleValidations(plan, day, index, plan.warnings);
  }
}

type ConfirmableCommand = Extract<LiveSelectionRequest['command'], { type: 'select_hotel' | 'select_flight' | 'select_travel' | 'select_activity' }>;

function responseForSelection(original: LivePlan, plan: LivePlan, command: ConfirmableCommand, message: string): LiveSelectionResponse {
  const impact = selectionImpact(original, plan, command);
  const nonOverridable = impact.findings.filter(finding => finding.severity === 'blocking' && !finding.overridable);
  if (nonOverridable.length) {
    return { kind: 'live-selection', plan: original, message: `I couldn’t make this change because it would overlap an item whose time cannot move. I’ve left your itinerary unchanged and shown alternatives that fit the day.`, impact };
  }
  const confirmable = impact.findings.filter(finding => finding.overridable && (finding.severity === 'warning' || finding.severity === 'blocking'));
  if (confirmable.length && !command.confirmConstraints) {
    return {
      kind: 'live-selection',
      plan: original,
      message: `This option can work, but it introduces ${confirmable.length} timing ${confirmable.length === 1 ? 'warning' : 'warnings'} and may move nearby meals or transfers. I haven’t applied it yet; review what changes before you confirm.`,
      impact,
      confirmation: { command: { ...command, confirmConstraints: true }, findings: confirmable, impact },
    };
  }
  return { kind: 'live-selection', plan, message, impact: { ...impact, requiresConfirmation: false } };
}

function selectionImpact(original: LivePlan, plan: LivePlan, command: ConfirmableCommand): LiveSelectionImpact {
  const previousFindingKeys = new Set((original.scheduling?.findings ?? []).map(finding => `${finding.id}:${finding.message}`));
  const findings = (plan.scheduling?.findings ?? []).filter(finding => !previousFindingKeys.has(`${finding.id}:${finding.message}`));
  const movedItems: LiveSelectionImpact['movedItems'] = [];
  const mealChanges: LiveSelectionImpact['mealChanges'] = [];
  const transferChanges: LiveSelectionImpact['transferChanges'] = [];
  const affectedDays = new Set<number>();
  let usableTimeDeltaMinutes = 0;

  for (let dayIndex = 0; dayIndex < Math.max(original.days.length, plan.days.length); dayIndex++) {
    const before = original.days[dayIndex];
    const after = plan.days[dayIndex];
    if (!before || !after) continue;
    const beforeProjection = projectLiveDay(before, plannerDayStart(original, dayIndex));
    const afterProjection = projectLiveDay(after, plannerDayStart(plan, dayIndex));
    const beforeRows = new Map(beforeProjection.rows.map(row => [impactItemKey(row.visit), row]));
    for (const row of afterProjection.rows) {
      const previous = beforeRows.get(impactItemKey(row.visit));
      if (!previous || previous.start === row.start) continue;
      affectedDays.add(dayIndex);
      movedItems.push({ dayIndex, itemId: row.visit.place.id, label: row.visit.place.name, kind: row.visit.kind, previousStartMinutes: previous.start, nextStartMinutes: row.start, deltaMinutes: minuteDelta(previous.start, row.start) });
    }
    const beforeMeals = new Map(beforeProjection.rows.flatMap(row => row.visit.kind === 'meal' ? [[row.visit.type, row] as const] : []));
    for (const row of afterProjection.rows) {
      if (row.visit.kind !== 'meal') continue;
      const previous = beforeMeals.get(row.visit.type);
      if (!previous || previous.start === row.start) continue;
      mealChanges.push({ dayIndex, type: row.visit.type, previousStartMinutes: previous.start, nextStartMinutes: row.start, deltaMinutes: minuteDelta(previous.start, row.start) });
    }
    const legs = Math.max(before.legs.length, after.legs.length);
    for (let index = 0; index < legs; index++) {
      const previous = before.legs[index];
      const next = after.legs[index];
      if (previous?.fromId === next?.fromId && previous?.toId === next?.toId && previous?.minutes === next?.minutes) continue;
      affectedDays.add(dayIndex);
      transferChanges.push({ dayIndex, previousFromId: previous?.fromId ?? null, previousToId: previous?.toId ?? null, nextFromId: next?.fromId ?? null, nextToId: next?.toId ?? null, previousMinutes: previous?.minutes ?? null, nextMinutes: next?.minutes ?? null });
    }
    const previousUsable = usableMinutes(original, dayIndex);
    const nextUsable = usableMinutes(plan, dayIndex);
    if (previousUsable !== null && nextUsable !== null && previousUsable !== nextUsable) {
      affectedDays.add(dayIndex);
      usableTimeDeltaMinutes += nextUsable - previousUsable;
    }
  }
  for (const change of journeyTransferChanges(original, plan)) {
    affectedDays.add(change.dayIndex);
    transferChanges.push(change);
  }
  findings.forEach(finding => affectedDays.add(finding.dayIndex));
  const status = findings.some(finding => finding.severity === 'blocking') ? 'blocking'
    : findings.some(finding => finding.severity === 'warning') ? 'warning'
      : findings.some(finding => finding.severity === 'unresolved') ? 'unresolved' : 'safe';
  const requiresConfirmation = findings.some(finding => finding.overridable && (finding.severity === 'warning' || finding.severity === 'blocking'));
  return { status, requiresConfirmation, affectedDays: [...affectedDays].sort((a, b) => a - b), movedItems, transferChanges, mealChanges, usableTimeDeltaMinutes, findings, alternatives: selectionAlternatives(original, command) };
}

function impactItemKey(visit: ReturnType<typeof dayStops>[number]) { return visit.kind === 'meal' ? `meal:${visit.type}` : `activity:${visit.place.id}`; }
function minuteDelta(previous: number | null, next: number | null) { return previous === null || next === null ? null : next - previous; }
function usableMinutes(plan: LivePlan, dayIndex: number) {
  const start = plannerDayStart(plan, dayIndex); const end = plannerDayEnd(plan, dayIndex);
  return start === null || end === null ? null : Math.max(0, end - start);
}
function selectionAlternatives(plan: LivePlan, command: ConfirmableCommand) {
  if (command.type === 'select_activity') {
    const day = plan.days[command.dayIndex];
    const selectedElsewhere = new Set(plan.days.flatMap((value, dayIndex) => value.visits.flatMap((visit, visitIndex) =>
      dayIndex === command.dayIndex && visitIndex === command.visitIndex ? [] : [visit.place.id])));
    return (plan.activityOptions ?? [])
      .filter(place => place.id !== command.placeId && !selectedElsewhere.has(place.id) && (!day || regularHoursStatus(place, day.date) !== 'closed'))
      .slice(0, 3)
      .map(place => ({ id: place.id, label: place.name }));
  }
  if (command.type === 'select_hotel') return plan.hotels
    .filter(hotel => hotel.id !== command.hotelId && hotel.stayOffer?.availability !== 'unavailable')
    .slice(0, 3)
    .map(hotel => ({ id: hotel.id, label: hotel.name }));
  if (command.type === 'select_flight') return (command.direction === 'outbound' ? plan.flight?.outbound : plan.flight?.return)
    ?.filter(offer => offer.id !== command.offerId && offer.availability !== 'unavailable')
    .slice(0, 3)
    .map(offer => ({ id: offer.id, label: `${offer.operator} ${offer.segments[0]?.number ?? ''}`.trim() })) ?? [];
  return (command.direction === 'outbound' ? plan.travel?.outbound : plan.travel?.return)?.filter(option => option.id !== command.optionId).slice(0, 3).map(option => ({ id: option.id, label: option.label })) ?? [];
}

function journeyTransferChanges(original: LivePlan, plan: LivePlan): LiveSelectionImpact['transferChanges'] {
  const before = journeyLegs(original);
  const after = journeyLegs(plan);
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].flatMap(key => {
    const previous = before.get(key); const next = after.get(key);
    if (previous?.fromId === next?.fromId && previous?.toId === next?.toId && previous?.minutes === next?.minutes) return [];
    return [{ dayIndex: next?.dayIndex ?? previous?.dayIndex ?? 0, previousFromId: previous?.fromId ?? null, previousToId: previous?.toId ?? null, nextFromId: next?.fromId ?? null, nextToId: next?.toId ?? null, previousMinutes: previous?.minutes ?? null, nextMinutes: next?.minutes ?? null }];
  });
}

function journeyLegs(plan: LivePlan) {
  const result = new Map<string, { dayIndex: number; fromId: string; toId: string; minutes: number | null }>();
  const last = plan.days.length - 1;
  const outbound = plan.travel?.outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
  const returning = plan.travel?.return.find(option => option.id === plan.travel?.suggestedReturnId);
  if (outbound && plan.travel) result.set('intercity-outbound', { dayIndex: 0, fromId: plan.travel.origin.id, toId: plan.travel.destination.id, minutes: outbound.minutes });
  if (returning && plan.travel) result.set('intercity-return', { dayIndex: last, fromId: plan.travel.destination.id, toId: plan.travel.origin.id, minutes: returning.minutes });
  if (plan.flight?.outboundFirstMile) result.set('flight-outbound-first-mile', { dayIndex: 0, fromId: plan.flight.origin.id, toId: plan.flight.originAirport.id, minutes: plan.flight.outboundFirstMile.minutes });
  if (plan.flight?.outboundLastMile) result.set('flight-outbound-last-mile', { dayIndex: 0, fromId: plan.flight.destinationAirport.id, toId: plan.flight.destination.id, minutes: plan.flight.outboundLastMile.minutes });
  if (plan.flight?.returnFirstMile) result.set('flight-return-first-mile', { dayIndex: last, fromId: plan.flight.destination.id, toId: plan.flight.destinationAirport.id, minutes: plan.flight.returnFirstMile.minutes });
  if (plan.flight?.returnLastMile) result.set('flight-return-last-mile', { dayIndex: last, fromId: plan.flight.originAirport.id, toId: plan.flight.origin.id, minutes: plan.flight.returnLastMile.minutes });
  return result;
}

function refreshScheduleAssessment(plan: LivePlan, dayIndexes: number[]) {
  const targets = new Set(dayIndexes);
  for (const dayIndex of targets) {
    const day = plan.days[dayIndex];
    if (!day) continue;
    const start = plannerDayStart(plan, dayIndex);
    const end = plannerDayEnd(plan, dayIndex);
    prepareDaySchedule(day, plan.brief.travellers ?? 1, { startMinutes: start, endMinutes: end }, plan.brief);
    reflowAndAssessDay(day, dayIndex, start, end, plan.brief);
    applyScheduleValidations(plan, day, dayIndex, plan.warnings);
    reflowAndAssessDay(day, dayIndex, start, end, plan.brief);
  }
  const findings = plan.days.flatMap(day => day.findings ?? []);
  plan.scheduling = { pace: plan.scheduling?.pace ?? plan.brief.pace ?? 'balanced', paceDefaulted: plan.scheduling?.paceDefaulted ?? plan.brief.pace === null, findings };
  plan.warnings = plan.warnings.filter(warning => !/^\d+ schedule (constraint|connection)/.test(warning));
  const blocking = findings.filter(finding => finding.severity === 'blocking').length;
  const unresolved = findings.filter(finding => finding.severity === 'unresolved').length;
  if (blocking) addWarning(plan, `${blocking} schedule constraint${blocking === 1 ? '' : 's'} need changes before this itinerary can be relied on.`);
  if (unresolved) addWarning(plan, `${unresolved} schedule connection${unresolved === 1 ? '' : 's'} remain unresolved.`);
}

function invalidateMealRouteEvidence(day: LivePlan['days'][number], hotel: LivePlan['hotels'][number]) {
  const lunch = day.meals?.find(meal => meal.type === 'lunch');
  const dinner = day.meals?.find(meal => meal.type === 'dinner');
  if (lunch?.routeFit) {
    const morning = day.visits.filter((visit, index) => (visit.sequenceOrder ?? (index === 0 ? 10 : 40 + index * 10)) < 30);
    const later = day.visits.filter((visit, index) => { const order = visit.sequenceOrder ?? (index === 0 ? 10 : 40 + index * 10); return order > 30 && order < 70; });
    const from = morning.at(-1)?.place ?? hotel;
    const to = later[0]?.place ?? hotel;
    if (lunch.routeFit.fromId !== from.id || lunch.routeFit.toId !== to.id) lunch.routeFit = { basis: 'destination_fallback', fromId: from.id, toId: to.id, directMinutes: null };
  }
  if (dinner?.routeFit) {
    const later = day.visits.filter((visit, index) => { const order = visit.sequenceOrder ?? (index === 0 ? 10 : 40 + index * 10); return order > 30 && order < 70; });
    const from = later.at(-1)?.place ?? lunch?.place ?? day.visits.at(-1)?.place ?? hotel;
    if (dinner.routeFit.fromId !== from.id || dinner.routeFit.toId !== hotel.id) dinner.routeFit = { basis: 'destination_fallback', fromId: from.id, toId: hotel.id, directMinutes: null };
  }
}

async function refreshDayRoutes(day: LivePlan['days'][number], hotel: LivePlan['hotels'][number], deps: Dependencies) {
  const chain = [hotel, ...dayStops(day).map(stop => stop.place), hotel];
  day.legs = [];
  for (let index = 1; index < chain.length; index++) {
    deps.signal.throwIfAborted();
    if (chain[index - 1].id === chain[index].id) {
      day.legs.push({ fromId: chain[index - 1].id, toId: chain[index].id, minutes: 0, meters: 0, path: [], checkedAt: new Date().toISOString() });
      continue;
    }
    try { day.legs.push(await deps.provider.route(chain[index - 1], chain[index])); }
    catch { day.legs.push({ fromId: chain[index - 1].id, toId: chain[index].id, minutes: null, meters: null, path: [], checkedAt: new Date().toISOString(), error: 'Driving connection unavailable; timing needs review.' }); }
  }
}

function selectedHotel(plan: LivePlan, journeyDestination?: LivePlace) {
  const hotel = plan.hotels.find(candidate => candidate.id === plan.selectedHotelId)
    ?? (journeyDestination ? plan.hotels.find(candidate => candidate.id === journeyDestination.id) : undefined);
  if (!hotel) throw new LiveSelectionError('The selected stay is unavailable, so activity routes cannot be refreshed.', 409);
  plan.selectedHotelId = hotel.id;
  return hotel;
}

type RouteProfile = { mode: 'drive' | 'transit'; transitModes?: ('BUS' | 'TRAIN' | 'LIGHT_RAIL' | 'RAIL' | 'SUBWAY')[]; roadUse?: 'self_drive' | 'cab' };

function preferredRouteProfiles(mode: LivePlan['brief']['travelMode']): RouteProfile[] {
  if (mode === 'self_drive') return [{ mode: 'drive', roadUse: 'self_drive' }];
  if (mode === 'cab') return [{ mode: 'drive', roadUse: 'cab' }];
  if (mode === 'train') return [{ mode: 'transit', transitModes: ['TRAIN', 'LIGHT_RAIL', 'RAIL', 'SUBWAY'] }];
  if (mode === 'bus') return [{ mode: 'transit', transitModes: ['BUS'] }];
  if (mode === 'recommend') return [{ mode: 'transit' }, { mode: 'drive', roadUse: 'cab' }];
  return [{ mode: 'transit' }];
}

async function routeOptions(deps: Dependencies, from: LivePlan['hotels'][number], to: LivePlan['hotels'][number], direction: 'outbound' | 'return', mode: 'drive' | 'transit', departure: string, profile?: RouteProfile) {
  try { return [...await deps.provider.travelRoutes(from, to, { direction, mode, departureTime: departure, ...(profile?.transitModes ? { transitModes: profile.transitModes } : {}), ...(profile?.roadUse ? { roadUse: profile.roadUse } : {}) })].sort((a, b) => a.minutes - b.minutes); }
  catch { return []; }
}

async function roadRoute(deps: Dependencies, from: LivePlan['hotels'][number], to: LivePlan['hotels'][number], direction: 'outbound' | 'return', departureTime: string): Promise<LiveTravelOption | undefined> {
  const options = await routeOptions(deps, from, to, direction, 'drive', departureTime);
  return options[0];
}

function roadFallbackOptions(options: LiveTravelOption[]) {
  return options.slice(0, 1).flatMap(option => [
    { ...option, id: `${option.id}:self-drive`, roadUse: 'self_drive' as const, label: 'Self-drive' },
    { ...option, id: `${option.id}:cab`, roadUse: 'cab' as const, label: 'Cab route estimate' },
  ]);
}

function refreshedSelectionId(options: LiveTravelOption[], previous: LiveTravelOption | undefined, selectFirst: boolean) {
  if (!previous) return selectFirst ? options[0]?.id ?? null : null;
  const match = options.find(option => option.roadUse === previous.roadUse && option.label === previous.label)
    ?? options.find(option => option.label === previous.label);
  return match?.id ?? null;
}

function assertSelectable(availability: 'available' | 'unavailable' | 'unknown', expiresAt?: string, now = new Date().toISOString()) {
  if (availability === 'unavailable') throw new LiveSelectionError('That option is no longer available. Choose another one from the current list.', 409);
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(now)) throw new LiveSelectionError('That option has expired. Rebuild the plan to check current availability.', 409);
}

function flightName(offer: TransportOffer) {
  const number = offer.segments[0]?.number;
  return `${offer.operator}${number ? ` ${number}` : ''}`;
}
function minutesBefore(value: string, minutes: number) { return new Date(Date.parse(value) - minutes * 60_000).toISOString(); }
function departureTime(date: string, hour: number, offsetMinutes = 0) {
  const sign = offsetMinutes >= 0 ? '+' : '-'; const absolute = Math.abs(offsetMinutes);
  return `${date}T${String(hour).padStart(2, '0')}:00:00${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
function label(target: 'hotel' | 'outboundFlight' | 'returnFlight' | 'outboundTravel' | 'returnTravel') {
  if (target === 'hotel') return 'Stay';
  if (target === 'outboundFlight') return 'Outbound flight';
  if (target === 'returnFlight') return 'Return flight';
  return target === 'outboundTravel' ? 'Outbound travel route' : 'Return travel route';
}
function addWarning(plan: LivePlan, warning: string) { if (!plan.warnings.includes(warning)) plan.warnings.push(warning); }

function chooseFlight(offers: TransportOffer[], direction: 'outbound' | 'return') {
  const usable = offers.filter(offer => {
    const value = direction === 'outbound' ? offer.arrivalAt : offer.departureAt;
    const minutes = Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
    return direction === 'outbound' ? minutes <= 13 * 60 : minutes >= 17 * 60;
  });
  return [...(usable.length ? usable : offers)].sort((a, b) => a.price.amount - b.price.amount || a.durationMinutes - b.durationMinutes)[0];
}

function hubPlace(hub: FlightHub, utcOffsetMinutes: number, checkedAt: string) {
  const query = `${hub.latitude},${hub.longitude}`;
  return { id: `iata:${hub.code}`, airportCode: hub.code, name: hub.name, address: `${hub.code} · ${hub.countryCode}`, lat: hub.latitude, lng: hub.longitude, source: 'Nuitée Connect' as const, checkedAt, mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, utcOffsetMinutes, attributions: [{ name: 'Nuitée Connect', url: 'https://www.nuitee.com/' }] };
}
