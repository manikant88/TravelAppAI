import type { LiveProvider } from './google.server';
import type { LivePlan, LiveSelectionRequest, LiveSelectionResponse, LiveTravelOption } from './contracts';
import { hoursValidationNote, regularHoursStatus } from './opening-hours';
import type { FlightHub, FlightProvider } from '@/transport/providers/nuitee-flight.server';
import type { TransportOffer } from '@/inventory/contracts';
import { dayStops } from './timeline';
import { applyScheduleValidations } from './planner';

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
    return { kind: 'live-selection', plan, message: `${label(command.target)} ${command.locked ? 'locked' : 'unlocked'} for this session.` };
  }

  if (command.type === 'set_activity_lock') {
    const selected = plan.days.some(day => day.visits.some(visit => visit.place.id === command.placeId));
    if (!selected) throw new LiveSelectionError('That activity is not selected in the current itinerary.');
    const ids = new Set(plan.locks.activityIds ?? []);
    if (command.locked) ids.add(command.placeId); else ids.delete(command.placeId);
    plan.locks.activityIds = [...ids];
    return { kind: 'live-selection', plan, message: `Activity ${command.locked ? 'locked' : 'unlocked'} for this session.` };
  }

  if (command.type === 'retry_flights') {
    if (!deps.flightProvider) throw new LiveSelectionError('Nuitée flight sandbox access is not configured.', 409);
    const origin = plan.flight?.origin ?? plan.travel?.origin;
    const hotel = selectedHotel(plan);
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
      throw new LiveSelectionError(`Flight search failed again${detail}. The Google route alternatives remain unchanged.`, 502);
    }
    const outbound = chooseFlight(result.outbound, 'outbound');
    const returning = chooseFlight(result.returning, 'return');
    if (!outbound && !returning) throw new LiveSelectionError('Nuitée returned no direct flight offers for either direction. The Google route alternatives remain available.', 409);
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
    applyScheduleValidations(plan, plan.days[0], 0, plan.warnings);
    return { kind: 'live-selection', plan, message: `Flight search refreshed. ${outbound ? 'An outbound flight is available.' : 'Outbound flights remain unavailable.'} ${returning ? 'A return flight is available.' : 'Return flights remain unavailable.'}` };
  }

  if (command.type === 'select_travel') {
    const target = command.direction === 'outbound' ? 'outboundTravel' : 'returnTravel';
    if (plan.locks[target]) throw new LiveSelectionError(`Unlock the ${command.direction} travel route before changing it.`, 409);
    if (!plan.travel) throw new LiveSelectionError('This plan has no Google travel routes to change.');
    const options = command.direction === 'outbound' ? plan.travel.outbound : plan.travel.return;
    const option = options.find(candidate => candidate.id === command.optionId);
    if (!option) throw new LiveSelectionError('That route is not part of the current Google results.');
    if (command.direction === 'outbound') plan.travel.suggestedOutboundId = option.id;
    else plan.travel.suggestedReturnId = option.id;
    if (plan.travel.context === 'flight_fallback' && plan.flight) {
      if (command.direction === 'outbound') plan.flight.suggestedOutboundId = null;
      else plan.flight.suggestedReturnId = null;
    }
    plan.checkedAt = new Date().toISOString();
    if (command.direction === 'outbound') applyScheduleValidations(plan, plan.days[0], 0, plan.warnings);
    return { kind: 'live-selection', plan, message: `Selected the ${command.direction} ${option.label} route. The itinerary timing and map now use that route evidence.` };
  }

  if (command.type === 'select_flight') {
    const target = command.direction === 'outbound' ? 'outboundFlight' : 'returnFlight';
    if (plan.locks[target]) throw new LiveSelectionError(`Unlock the ${command.direction} flight before changing it.`, 409);
    const flight = plan.flight;
    if (!flight) throw new LiveSelectionError('This plan has no flight journey to change.');
    const offers = command.direction === 'outbound' ? flight.outbound : flight.return;
    const offer = offers.find(candidate => candidate.id === command.offerId);
    if (!offer) throw new LiveSelectionError('That flight is not part of the current supplier results.');
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
    if (command.direction === 'outbound') applyScheduleValidations(plan, plan.days[0], 0, plan.warnings);
    addWarning(plan, `You selected ${offer.operator} ${offer.segments[0]?.number ?? ''} for the ${command.direction} journey. Its fare and availability still require refresh before booking.`);
    return { kind: 'live-selection', plan, message: `Selected the ${command.direction} flight and refreshed its airport road transfers and timeline.` };
  }

  if (command.type === 'select_activity') {
    const day = plan.days[command.dayIndex];
    const current = day?.visits[command.visitIndex];
    if (!day || !current) throw new LiveSelectionError('That itinerary activity no longer exists.');
    if ((plan.locks.activityIds ?? []).includes(current.place.id)) throw new LiveSelectionError('Unlock the activity before changing it.', 409);
    const candidate = plan.activityOptions?.find(place => place.id === command.placeId);
    if (!candidate) throw new LiveSelectionError('That activity is not part of the current Google results.');
    const usedElsewhere = plan.days.some((value, dayIndex) => value.visits.some((visit, visitIndex) => visit.place.id === candidate.id && (dayIndex !== command.dayIndex || visitIndex !== command.visitIndex)));
    if (usedElsewhere) throw new LiveSelectionError('That activity is already included elsewhere in the itinerary.', 409);
    let place = candidate;
    try { place = await deps.provider.details(candidate.id); }
    catch { /* The observed search result remains usable, with its missing facts explicit. */ }
    const status = regularHoursStatus(place, day.date);
    if (status === 'closed') throw new LiveSelectionError(`${place.name} is usually closed on ${day.date}. Choose another valid option.`, 409);
    day.visits[command.visitIndex] = { ...current, place, hoursStatus: status === 'open' ? 'open' : 'unknown', hoursNote: hoursValidationNote(status, day.date) };
    plan.activityOptions = plan.activityOptions?.map(option => option.id === place.id ? place : option);
    invalidateMealRouteEvidence(day, selectedHotel(plan));
    await refreshDayRoutes(day, selectedHotel(plan), deps);
    applyScheduleValidations(plan, day, command.dayIndex, plan.warnings);
    plan.checkedAt = new Date().toISOString();
    return { kind: 'live-selection', plan, message: `Selected ${place.name} and refreshed the affected day routes and timeline.` };
  }

  if (command.type !== 'select_hotel') throw new LiveSelectionError('Unsupported live selection.');
  if (plan.locks.hotel) throw new LiveSelectionError('Unlock the stay before changing it.', 409);
  const hotel = plan.hotels.find(candidate => candidate.id === command.hotelId);
  if (!hotel) throw new LiveSelectionError('That stay is not part of the current results.');
  if (hotel.stayOffer) assertSelectable(hotel.stayOffer.availability, hotel.stayOffer.source.expiresAt, deps.now);
  plan.selectedHotelId = hotel.id;
  await refreshHotelDependencies(plan, hotel, deps);
  plan.checkedAt = new Date().toISOString();
  addWarning(plan, `You selected ${hotel.name}. Dependent Google routes were refreshed; supplier price and availability must still be refreshed before booking.`);
  return { kind: 'live-selection', plan, message: `Selected ${hotel.name} and refreshed the affected travel, airport-transfer and daily driving routes.` };
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
      const mode = plan.travel.outbound[0]?.mode ?? plan.travel.return[0]?.mode ?? (plan.brief.travelMode === 'self_drive' ? 'drive' : 'transit');
      [outbound, returning] = await Promise.all([
        routeOptions(deps, plan.travel.origin, hotel, 'outbound', mode, departureTime(firstDate, 8, plan.travel.origin.utcOffsetMinutes)),
        routeOptions(deps, hotel, plan.travel.origin, 'return', mode, departureTime(lastDate, 17, hotel.utcOffsetMinutes)),
      ]);
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
    invalidateMealRouteEvidence(day, hotel);
    await refreshDayRoutes(day, hotel, deps);
    applyScheduleValidations(plan, day, index, plan.warnings);
  }
}

function invalidateMealRouteEvidence(day: LivePlan['days'][number], hotel: LivePlan['hotels'][number]) {
  const lunch = day.meals?.find(meal => meal.type === 'lunch');
  const dinner = day.meals?.find(meal => meal.type === 'dinner');
  if (lunch?.routeFit) {
    const from = day.visits[0]?.place ?? hotel;
    const to = day.visits[1]?.place ?? hotel;
    if (lunch.routeFit.fromId !== from.id || lunch.routeFit.toId !== to.id) lunch.routeFit = { basis: 'destination_fallback', fromId: from.id, toId: to.id, directMinutes: null };
  }
  if (dinner?.routeFit) {
    const from = day.visits.length > 1 ? day.visits.at(-1)!.place : lunch?.place ?? day.visits.at(-1)?.place ?? hotel;
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

function selectedHotel(plan: LivePlan) {
  const hotel = plan.hotels.find(candidate => candidate.id === plan.selectedHotelId);
  if (!hotel) throw new LiveSelectionError('The selected stay is unavailable, so activity routes cannot be refreshed.', 409);
  return hotel;
}

async function routeOptions(deps: Dependencies, from: LivePlan['hotels'][number], to: LivePlan['hotels'][number], direction: 'outbound' | 'return', mode: 'drive' | 'transit', departure: string) {
  try { return [...await deps.provider.travelRoutes(from, to, { direction, mode, departureTime: departure })].sort((a, b) => a.minutes - b.minutes); }
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
  if (availability === 'unavailable') throw new LiveSelectionError('That supplier option is unavailable.', 409);
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(now)) throw new LiveSelectionError('That supplier option has expired. Rebuild the plan to refresh the results.', 409);
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
