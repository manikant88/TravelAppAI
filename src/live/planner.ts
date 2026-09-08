import { z } from 'zod';
import { addCalendarDays } from '@/domain/dates';
import { liveBriefSchema, type LiveRequest, type LiveResponse, type LivePlan, type LivePlace, type LiveTravelOption } from './contracts';
import type { LiveProvider } from './google.server';
import type { StayProvider, SupplierStaySearchResult } from '@/inventory/providers/stay-provider';
import type { StayOffer } from '@/inventory/contracts';
import { hoursValidationNote, regularHoursStatus, validateRegularHoursInterval } from './opening-hours';
import { dayStops, localClockMinutes, projectLiveDay } from './timeline';
import type { FlightHub, FlightProvider } from '@/transport/providers/nuitee-flight.server';

export const extractionSchema = z.object({ brief: liveBriefSchema, question: z.string().max(500).nullable() }).strict();
export const selectionSchema = z.object({
  hotelId: z.string(),
  visits: z.array(z.object({ placeId: z.string(), day: z.number().int().min(1).max(7), durationMinutes: z.number().int().min(30).max(180) }).strict()).max(14),
}).strict();
export interface LiveModel {
  extract(input: LiveRequest): Promise<z.infer<typeof extractionSchema>>;
  select(brief: z.infer<typeof liveBriefSchema>, hotels: LivePlace[], activities: LivePlace[]): Promise<z.infer<typeof selectionSchema>>;
}
export async function runLivePlan(input: LiveRequest, deps: { model: LiveModel; provider: LiveProvider; stayProvider?: StayProvider; flightProvider?: FlightProvider; signal: AbortSignal; progress?: (message: string) => void; today?: string; guestNationality?: string }): Promise<LiveResponse> {
  const emit = deps.progress ?? (() => {});
  emit('Understanding your destination, dates and travellers…');
  const { brief, question } = extractionSchema.parse(await deps.model.extract(input));
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  // A schema-valid date is not evidence that the user supplied that year.
  const userText = [...input.history.filter(m => m.role === 'user').map(m => m.text), input.message].join(' ');
  const statedYears: string[] = userText.match(/\b(?:19|20|21)\d{2}\b/g) ?? [];
  if (input.brief.startDate) statedYears.push(input.brief.startDate.slice(0, 4));
  if (brief.startDate && !statedYears.includes(brief.startDate.slice(0, 4))) {
    brief.startDate = null;
    brief.nightsConfirmed = false;
  }
  let missing = question;
  if (!brief.destination) missing = 'Which destination would you like to explore?';
  else if (!brief.origin) missing = 'Which city are you travelling from?';
  else if (!brief.travellers) missing = 'How many travellers are going?';
  else if (!brief.days) missing = 'How many calendar days will you travel? This first live flow supports 2–7 days.';
  else if (!brief.startDate) missing = `Please confirm your start date including the year. Should I treat ${brief.days} days as ${brief.days - 1} nights?`;
  else if (brief.startDate < today) missing = 'That start date is in the past. What future date should I use?';
  else if (!brief.nightsConfirmed) missing = `Should I treat ${brief.days} days as ${brief.days - 1} nights, checking out on ${addCalendarDays(brief.startDate, brief.days - 1)}? Please confirm the year too.`;
  else if (!brief.travelMode) missing = 'How would you prefer to travel for this trip: fly, drive your own vehicle, or use public transport such as buses and trains?';
  else if ((brief.travelMode === 'self_drive' || brief.travelMode === 'flight') && !brief.pickupLocation) missing = `What starting area or pickup address should I use for your ${brief.travelMode === 'flight' ? 'airport transfer' : 'driving estimate'}? You can use a public meeting point instead of a private address. Your answer is sent to the AI planner and Google Maps for this local session, is not shared with other travellers, and is cleared on refresh.`;
  else if (!brief.dietaryPreference) missing = 'What dining preference should I plan around: vegetarian, pure-vegetarian restaurants only, non-vegetarian, or both? Also mention allergies or foods you especially want to try, such as seafood.';
  else if (brief.travelMode === 'flight' && !deps.flightProvider) missing = 'Flights sandbox access is not configured on the server yet. Add the Nuitée sandbox key and retry.';
  if (missing) return { kind: 'live', brief, message: missing };
  deps.signal.throwIfAborted();
  emit(deps.stayProvider ? 'Searching Nuitée for dated stays and Google Places for attractions…' : 'Searching Google Places for hotels and attractions…');
  let supplierStaySearch: SupplierStaySearchResult | undefined;
  const searches = await Promise.allSettled([
    deps.stayProvider
      ? deps.stayProvider.search({
          destination: brief.destination!,
          checkIn: brief.startDate!,
          checkOut: addCalendarDays(brief.startDate!, brief.days! - 1),
          travellers: brief.travellers!,
          currency: 'INR',
          guestNationality: deps.guestNationality ?? 'IN',
          limit: 8,
        }).then(result => {
          supplierStaySearch = result;
          return result.offers.map(stayOfferToLivePlace);
        })
      : deps.provider.search(`hotels in ${brief.destination}`, 4, true),
    // Keep a bounded, visual candidate set for the Change drawer. Selected
    // candidates still receive a fresh details check before entering the plan.
    deps.provider.search(`tourist attractions in ${brief.destination} ${brief.preferences.slice(0, 150)}`, 10, true),
    deps.provider.search(restaurantQuery(brief), Math.min(14, brief.days! * 2)),
    brief.dayRhythm === 'early_nights' ? Promise.resolve([]) : deps.provider.search(eveningQuery(brief), 5),
  ]);
  const hotels = searches[0].status === 'fulfilled' ? searches[0].value : [];
  const activities = searches[1].status === 'fulfilled' ? searches[1].value : [];
  const restaurants = searches[2].status === 'fulfilled' ? searches[2].value : [];
  const eveningOptions = searches[3].status === 'fulfilled' ? searches[3].value : [];
  const warnings: string[] = [
    supplierStaySearch
      ? `${supplierStaySearch.environment === 'sandbox' ? 'Sandbox' : 'Live'} supplier stay prices and availability were checked for the stated dates. Entry fees, meal prices, dietary handling and transfer fares remain unresolved, so total cost and budget compliance are unknown.`
      : 'Provisional plan: hotel room prices, availability, entry fees, meal prices, dietary handling and transfer fares are not checked. Total cost and budget compliance are unknown.',
    brief.travelMode === 'flight'
      ? 'Nuitée Flights is checking separate one-way sandbox offers; Google Routes is checking the road transfers to and from each airport. No booking is made.'
      : `Google Routes is checking ${brief.travelMode === 'self_drive' ? 'self-driving' : 'public-transit'} directions based on your stated preference. It does not prove seats, tickets, bookable fares or private-cab quotes.`,
    'Local driving durations reflect traffic at the time of this search. Activity durations and the 15-minute connection buffers are planning assumptions.',
    'Regular opening hours are reference information, not confirmed opening on your travel dates. Review each visit before booking.',
    'Restaurant identity, location, ratings and regular hours come from Google Places. Menu, allergens, kitchen separation and pure-vegetarian status require confirmation with the restaurant.',
    ...brief.constraints.map(c => `Needs verification: ${c}`),
    ...(supplierStaySearch?.assumptions.map(assumption => `Stay search assumption: ${assumption}`) ?? []),
  ];
  if (searches.some(r => r.status === 'rejected')) warnings.push('One live provider search failed. Showing the results that were available; no snapshot fallback was used.');
  if (!hotels.length) warnings.push('No hotel candidates returned; stay and hotel transfers remain unresolved.');
  if (!activities.length) warnings.push('No attraction candidates returned; days remain unplanned.');
  if (!restaurants.length) warnings.push('No restaurant candidates returned; meal locations remain incomplete.');
  const plan: LivePlan = {
    brief, hotels, selectedHotelId: null, activityOptions: activities, mealOptions: restaurants,
    eveningOptions,
    eveningPrompt: eveningOptions.length ? eveningPrompt(brief, eveningOptions) : undefined,
    days: Array.from({ length: brief.days! }, (_, i) => ({ date: addCalendarDays(brief.startDate!, i), visits: [], meals: [], legs: [] })),
    warnings, checkedAt: new Date().toISOString(), status: 'provisional', totalCost: null,
    locks: { hotel: false, outboundFlight: false, returnFlight: false, outboundTravel: false, returnTravel: false, activityIds: [] },
  };
  if (!hotels.length || !activities.length) return { kind: 'live', brief, plan, message: 'I could only gather part of the live information. Review the available candidates and retry the search.' };
  emit('Choosing a provisional stay and grouping observed places by day…');
  let selection: z.infer<typeof selectionSchema>;
  try { selection = selectionSchema.parse(await deps.model.select(brief, hotels, activities)); }
  catch { plan.warnings.push('AI could not produce a valid selection. No itinerary was invented.'); return { kind: 'live', brief, plan, message: 'The live hotel candidates are available, but I could not assemble a valid day plan. Please retry.' }; }
  const hotel = hotels.find(h => h.id === selection.hotelId);
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  // Reject the whole selection if the model references unobserved IDs or repeats a place.
  const valid = hotel && selection.visits.length > 0 && selection.visits.every(v => {
    const count = (counts.get(v.day) ?? 0) + 1; counts.set(v.day, count);
    if (v.day > brief.days! || count > 2 || seen.has(v.placeId) || !activities.some(a => a.id === v.placeId)) return false;
    seen.add(v.placeId); return true;
  });
  if (!valid || !hotel) { plan.warnings.push('AI selection failed validation. No unverified selections were applied.'); return { kind: 'live', brief, plan, message: 'The live candidates are available, but the proposed itinerary did not pass validation. Please retry.' }; }
  plan.selectedHotelId = hotel.id;
  emit(brief.travelMode === 'flight' ? 'Finding direct sandbox flights and airport transfers…' : `Finding a suggested ${brief.travelMode === 'self_drive' ? 'driving' : 'public-transit'} route…`);
  let resolvedRouteOrigin: LivePlace | undefined;
  try {
    const routeOriginQuery = brief.travelMode === 'public_transit' ? brief.origin! : brief.pickupLocation!;
    const [origin] = await deps.provider.search(routeOriginQuery, 1);
    resolvedRouteOrigin = origin;
    if (!origin) {
      warnings.push(`Google could not resolve ${routeOriginQuery} to a route origin. Outbound and return travel remain unresolved.`);
    } else if (brief.travelMode === 'flight') {
      const [destinationCity] = await deps.provider.search(brief.destination!, 1);
      if (!destinationCity || origin.utcOffsetMinutes === undefined || destinationCity.utcOffsetMinutes === undefined) {
        warnings.push('The origin or destination time-zone offset could not be resolved. Flight times remain unavailable.');
      } else {
        const returnDate = plan.days.at(-1)!.date;
        const flightSearch = await deps.flightProvider!.search({ origin: { lat: origin.lat, lng: origin.lng, utcOffsetMinutes: origin.utcOffsetMinutes }, destination: { lat: destinationCity.lat, lng: destinationCity.lng, utcOffsetMinutes: destinationCity.utcOffsetMinutes }, departureDate: brief.startDate!, returnDate, travellers: brief.travellers!, currency: 'INR', country: deps.guestNationality ?? 'IN' });
        warnings.push(...flightSearch.warnings.map(value => `Flight search: ${value}`));
        const outboundFlight = selectFlight(flightSearch.outbound, 'outbound'); const returnFlight = selectFlight(flightSearch.returning, 'return');
        const originAirport = flightHubToLivePlace(flightSearch.originHub, origin.utcOffsetMinutes, flightSearch.checkedAt);
        const destinationAirport = flightHubToLivePlace(flightSearch.destinationHub, destinationCity.utcOffsetMinutes, flightSearch.checkedAt);
        const routeRequests = [
          outboundFlight ? deps.provider.travelRoutes(origin, originAirport, { direction: 'outbound', mode: 'drive', departureTime: minutesBefore(outboundFlight.departureAt, 180) }) : Promise.resolve([]),
          outboundFlight ? deps.provider.travelRoutes(destinationAirport, hotel, { direction: 'outbound', mode: 'drive', departureTime: outboundFlight.arrivalAt }) : Promise.resolve([]),
          returnFlight ? deps.provider.travelRoutes(hotel, destinationAirport, { direction: 'return', mode: 'drive', departureTime: minutesBefore(returnFlight.departureAt, 180) }) : Promise.resolve([]),
          returnFlight ? deps.provider.travelRoutes(originAirport, origin, { direction: 'return', mode: 'drive', departureTime: returnFlight.arrivalAt }) : Promise.resolve([]),
        ];
        const transferResults = await Promise.allSettled(routeRequests);
        const transfer = (index: number) => transferResults[index].status === 'fulfilled' ? transferResults[index].value.sort((a, b) => a.minutes - b.minutes)[0] : undefined;
        plan.flight = { origin, destination: hotel, originAirport, destinationAirport, outbound: flightSearch.outbound, return: flightSearch.returning, suggestedOutboundId: outboundFlight?.id ?? null, suggestedReturnId: returnFlight?.id ?? null, outboundFirstMile: transfer(0), outboundLastMile: transfer(1), returnFirstMile: transfer(2), returnLastMile: transfer(3), assumptions: [`${originAirport.name} and ${destinationAirport.name} are the nearest IATA airports found for the resolved locations.`, 'The schedule-aware suggestion prefers arrival by 13:00 outbound and departure after 17:00 on return, then price and duration.', 'Airport arrival buffers are planning assumptions: 120 minutes before each flight.', `${flightSearch.environment === 'sandbox' ? 'Sandbox' : 'Live'} fares expire and must be refreshed before selection or booking.`] };
        if (!outboundFlight) warnings.push('No direct outbound flight offer was returned. Day 1 arrival remains unresolved.');
        if (!returnFlight) warnings.push('No direct return flight offer was returned. Return timing remains unresolved.');
        if (transferResults.some(result => result.status === 'rejected')) warnings.push('One or more airport road transfers failed. The successful flight and transfer evidence remains available.');
        if (!outboundFlight || !returnFlight) plan.travel = await flightFallbackRoutes(deps.provider, origin, hotel, brief.startDate!, returnDate, warnings);
      }
    } else {
      const returnDate = plan.days.at(-1)!.date;
      const outboundDeparture = departureTime(brief.startDate!, 8, origin.utcOffsetMinutes);
      const returnDeparture = departureTime(returnDate, 17, hotel.utcOffsetMinutes);
      const routeMode = brief.travelMode === 'self_drive' ? 'drive' : 'transit';
      const results = await Promise.allSettled([
        deps.provider.travelRoutes(origin, hotel, { direction: 'outbound', mode: routeMode, departureTime: outboundDeparture }),
        deps.provider.travelRoutes(hotel, origin, { direction: 'return', mode: routeMode, departureTime: returnDeparture }),
      ]);
      const available = results.map(result => result.status === 'fulfilled' ? result.value : []);
      const outbound = [...available[0]].sort((a, b) => a.minutes - b.minutes);
      const returning = [...available[1]].sort((a, b) => a.minutes - b.minutes);
      plan.travel = {
        origin,
        destination: hotel,
        outbound,
        return: returning,
        suggestedOutboundId: outbound[0]?.id ?? null,
        suggestedReturnId: returning[0]?.id ?? null,
        selectionReason: `Shortest-duration route returned for your ${brief.travelMode === 'self_drive' ? 'self-driving' : 'public-transport'} preference.`,
        assumptions: [
          brief.travelMode === 'self_drive' ? `${origin.name} is Google's match for the starting location you provided.` : `${origin.name} is a city-level route origin, not a confirmed station or stop.`,
          `Outbound alternatives were requested for 08:00 on ${brief.startDate}; return alternatives for 17:00 on ${returnDate}.`,
          'Transit modes, lines and times are shown only when Google Routes returned them. A route is not evidence of ticket or seat availability.',
        ],
        context: 'preferred',
      };
      if (!plan.travel.outbound.length) warnings.push('No outbound route was returned for the preferred mode. Arrival travel remains unresolved.');
      if (!plan.travel.return.length) warnings.push('No return route was returned for the preferred mode. Departure travel remains unresolved.');
      if (results.some(result => result.status === 'rejected')) warnings.push('One or more route searches failed. Available route evidence is shown without filling the gaps.');
      if (origin.utcOffsetMinutes === undefined || hotel.utcOffsetMinutes === undefined) warnings.push('A route search time-zone offset was unavailable, so the affected 08:00 or 17:00 search time used UTC and needs review.');
    }
  } catch (error) {
    const detail = error instanceof Error && error.message.trim() ? `: ${error.message.trim()}` : '';
    warnings.push(brief.travelMode === 'flight'
      ? `Flight search failed${detail}. No flight offer was added; outbound and return timing remain unresolved.`
      : `Travel route comparison failed${detail}. Outbound and return travel remain unresolved.`);
    if (brief.travelMode === 'flight' && resolvedRouteOrigin) {
      plan.travel = await flightFallbackRoutes(deps.provider, resolvedRouteOrigin, hotel, brief.startDate!, plan.days.at(-1)!.date, warnings);
    }
  }
  emit('Checking opening hours and driving connections…');
  // Sequential batches keep provider concurrency bounded; failed facts stay unknown.
  const enrichedVisits: { place: LivePlace; durationMinutes: number; requestedDay: number }[] = [];
  for (const visit of selection.visits) {
    deps.signal.throwIfAborted();
    const place = activities.find(a => a.id === visit.placeId)!;
    plan.activityOptions = plan.activityOptions?.map(candidate => candidate.id === place.id ? place : candidate);
    enrichedVisits.push({ place, durationMinutes: visit.durationMinutes, requestedDay: visit.day - 1 });
  }
  for (const visit of enrichedVisits) {
    const requested = plan.days[visit.requestedDay];
    let target = visit.requestedDay;
    let status = regularHoursStatus(visit.place, requested.date);
    if (status === 'closed') {
      const alternatives = plan.days
        .map((candidate, index) => ({ index, distance: Math.abs(index - visit.requestedDay), status: regularHoursStatus(visit.place, candidate.date) }))
        .filter(candidate => candidate.status === 'open' && plan.days[candidate.index].visits.length < 2)
        .sort((a, b) => a.distance - b.distance || a.index - b.index);
      if (!alternatives.length) {
        warnings.push(`${visit.place.name} was omitted because it is usually closed on the proposed day and no open trip day had capacity.`);
        continue;
      }
      target = alternatives[0].index;
      status = 'open';
      warnings.push(`${visit.place.name} moved from ${requested.date} to ${plan.days[target].date} because its regular hours show it closed on the proposed day.`);
    }
    plan.days[target].visits.push({ place: visit.place, durationMinutes: visit.durationMinutes, hoursStatus: status === 'open' ? 'open' : 'unknown', hoursNote: hoursValidationNote(status, plan.days[target].date) });
  }
  await scheduleMeals(plan, hotel, restaurants, deps.provider, deps.signal, warnings);
  for (const day of plan.days) {
    deps.signal.throwIfAborted();
    if (!day.visits.length) warnings.push(`${day.date}: no activities planned; needs review.`);
    const stops = dayStops(day);
    if (!stops.length) continue;
    const chain = [hotel, ...stops.map(stop => stop.place), hotel];
    for (let i = 1; i < chain.length; i++) {
      deps.signal.throwIfAborted();
      if (chain[i - 1].id === chain[i].id) {
        day.legs.push({ fromId: chain[i - 1].id, toId: chain[i].id, meters: 0, minutes: 0, path: [], checkedAt: new Date().toISOString() });
        continue;
      }
      try { day.legs.push(await deps.provider.route(chain[i - 1], chain[i])); }
      catch { day.legs.push({ fromId: chain[i - 1].id, toId: chain[i].id, meters: null, minutes: null, path: [], checkedAt: new Date().toISOString(), error: 'Driving connection unavailable; timing needs review.' }); }
    }
    applyScheduleValidations(plan, day, plan.days.indexOf(day), warnings);
  }
  deps.signal.throwIfAborted();
  const hasSelectedFlight = Boolean(plan.flight?.suggestedOutboundId || plan.flight?.suggestedReturnId);
  const travelEvidence = brief.travelMode === 'flight'
    ? hasSelectedFlight
      ? 'Nuitée sandbox flights with Google airport transfers'
      : 'live Google places; flight offers were unavailable for one or both directions, with unselected Google route alternatives where available'
    : `suggested ${brief.travelMode === 'self_drive' ? 'driving' : 'public-transit'} routes`;
  return { kind: 'live', brief, plan, message: `I built a provisional ${brief.days}-day plan from ${supplierStaySearch ? `${supplierStaySearch.environment} Nuitée stay offers, ` : ''}live Google places and ${travelEvidence}. Review the timing assumptions and unresolved costs before making bookings.${plan.eveningPrompt ? ` ${plan.eveningPrompt}` : ''}` };
}

function restaurantQuery(brief: z.infer<typeof liveBriefSchema>) {
  const dining = brief.dietaryPreference === 'pure_vegetarian' ? 'pure vegetarian restaurants'
    : brief.dietaryPreference === 'vegetarian' ? 'vegetarian restaurants'
    : brief.dietaryPreference === 'non_vegetarian' ? 'non vegetarian restaurants'
    : 'restaurants with vegetarian and non vegetarian food';
  return `${dining} in ${brief.destination} ${brief.dietaryNotes.slice(0, 120)}`.trim();
}

function eveningQuery(brief: z.infer<typeof liveBriefSchema>) {
  if (brief.dayRhythm === 'nightlife') return `night clubs bars pubs live music venues in ${brief.destination}`;
  if (brief.dayRhythm === 'overnight_adventure') return `night camping night trekking overnight experiences near ${brief.destination}`;
  return `evening cultural experiences night markets live music venues in ${brief.destination} ${brief.preferences.slice(0, 100)}`.trim();
}

function eveningPrompt(brief: z.infer<typeof liveBriefSchema>, options: LivePlace[]) {
  const examples = options.slice(0, 3).map(option => option.name).join(', ');
  if (brief.dayRhythm === 'nightlife') return `I found optional nightlife ideas such as ${examples}; none were inserted automatically. Tell me if you want to make room for one.`;
  if (brief.dayRhythm === 'overnight_adventure') return `I found possible overnight experiences such as ${examples}, but they need dated provider validation and were not inserted automatically.`;
  return `I also found optional evening ideas such as ${examples}. Tell me if you prefer an early night, a cultural evening, live entertainment, nightlife, or an overnight experience.`;
}

async function scheduleMeals(plan: LivePlan, hotel: LivePlace, candidates: LivePlace[], provider: LiveProvider, signal: AbortSignal, warnings: string[]) {
  const used = new Set<string>();
  let corridorSearches = 0;
  const corridorLimit = Math.min(plan.days.length, 4);
  const dietaryNote = plan.brief.dietaryPreference === 'pure_vegetarian'
    ? 'Matched by a Google search for pure-vegetarian restaurants; confirm that the kitchen serves only vegetarian food.'
    : `${plan.brief.dietaryPreference === 'both' ? 'Vegetarian and non-vegetarian' : plan.brief.dietaryPreference?.replace('_', '-')} preference used for this Google restaurant search${plan.brief.dietaryNotes ? ` · ${plan.brief.dietaryNotes}` : ''}.`;
  for (let dayIndex = 0; dayIndex < plan.days.length; dayIndex++) {
    const day = plan.days[dayIndex];
    if (dayIndex > 0) day.meals!.push({ type: 'breakfast', place: hotel, durationMinutes: 60, targetStartMinutes: 480, location: 'stay', dietaryNote: hotel.stayOffer?.roomFacts.mealPlan === 'breakfast' ? 'Breakfast is included in the selected sandbox room offer; menu and dietary fit require confirmation.' : 'Breakfast is planned at or near the stay; inclusion, menu and price are unverified.' });
    for (const slot of [{ type: 'lunch' as const, target: 780, duration: 60 }, { type: 'dinner' as const, target: 1170, duration: 90 }]) {
      let selected: LivePlace | undefined;
      const selectedLunch = day.meals?.find(meal => meal.type === 'lunch')?.place;
      const from = slot.type === 'lunch'
        ? day.visits[0]?.place ?? hotel
        : day.visits.length > 1 ? day.visits.at(-1)!.place : selectedLunch ?? day.visits.at(-1)?.place ?? hotel;
      const to = slot.type === 'lunch' ? day.visits[1]?.place ?? hotel : hotel;
      let directMinutes: number | null = null;
      let basis: 'route_corridor' | 'destination_fallback' = 'destination_fallback';
      let ranked = nearestUnused(candidates, used, from);
      if (provider.searchAlongRoute && from.id !== to.id && corridorSearches < corridorLimit) {
        try {
          corridorSearches++;
          const corridor = await provider.searchAlongRoute(restaurantQuery(plan.brief), from, to, 5);
          directMinutes = corridor.directLeg.minutes;
          if (corridor.places.length) {
            basis = 'route_corridor';
            ranked = corridor.places.filter(candidate => !used.has(candidate.id));
            plan.mealOptions = mergePlaces(plan.mealOptions ?? [], corridor.places);
          }
        } catch {
          warnings.push(`${day.date}: route-corridor search for ${slot.type} failed; destination-wide restaurant candidates were used.`);
        }
      }
      let validation;
      for (const candidate of ranked) {
        signal.throwIfAborted();
        const detailed = candidate;
        const interval = validateRegularHoursInterval(detailed, day.date, slot.target, slot.target + slot.duration);
        if (interval.status === 'invalid') continue;
        selected = detailed;
        validation = interval;
        plan.mealOptions = plan.mealOptions?.map(option => option.id === detailed.id ? detailed : option);
        break;
      }
      if (!selected) {
        warnings.push(`${day.date}: no ${slot.type} restaurant could be validated from the returned candidates.`);
        continue;
      }
      used.add(selected.id);
      day.meals!.push({
        type: slot.type, place: selected, durationMinutes: slot.duration, targetStartMinutes: slot.target, location: 'restaurant', dietaryNote,
        hoursStatus: validation?.status === 'valid' ? 'open' : 'unknown',
        hoursNote: validation?.note ?? `Opening hours for the planned ${slot.type} interval are unavailable`,
        scheduleValidation: validation,
        routeFit: { basis, fromId: from.id, toId: to.id, directMinutes },
      });
    }
  }
  if (provider.searchAlongRoute && plan.days.length * 2 > corridorLimit) warnings.push(`Route-corridor restaurant searches were limited to ${corridorLimit} meal windows to preserve the live Google call budget; remaining meals use destination-wide candidates and are labelled for route review.`);
}

function mergePlaces(current: LivePlace[], additions: LivePlace[]) {
  const merged = new Map(current.map(place => [place.id, place]));
  for (const place of additions) merged.set(place.id, place);
  return [...merged.values()];
}

export function applyScheduleValidations(plan: LivePlan, day: LivePlan['days'][number], dayIndex: number, warnings: string[]) {
  const projection = projectLiveDay(day, plannerDayStart(plan, dayIndex));
  for (let index = 0; index < projection.rows.length; index++) {
    const row = projection.rows[index];
    if (row.visit.kind === 'meal' && row.visit.routeFit) {
      const incoming = day.legs[index];
      const outgoing = day.legs[index + 1];
      const direct = row.visit.routeFit.directMinutes;
      if (direct !== null && incoming?.minutes !== null && outgoing?.minutes !== null && incoming && outgoing
        && incoming.fromId === row.visit.routeFit.fromId && outgoing.toId === row.visit.routeFit.toId) {
        row.visit.routeFit.addedMinutes = Math.max(0, incoming.minutes + outgoing.minutes - direct);
      }
    }
    if (row.start === null || row.end === null) continue;
    const validation = validateRegularHoursInterval(row.visit.place, day.date, row.start, row.end);
    row.visit.scheduleValidation = validation;
    row.visit.hoursStatus = validation.status === 'valid' ? 'open' : 'unknown';
    row.visit.hoursNote = validation.note;
    const warning = `${day.date}: ${row.visit.place.name} does not have regular hours covering its complete planned interval.`;
    if (validation.status === 'invalid' && !warnings.includes(warning)) warnings.push(warning);
  }
}

export function plannerDayStart(plan: LivePlan, dayIndex: number) {
  if (dayIndex > 0) return plan.days[dayIndex].meals?.some(meal => meal.type === 'breakfast') ? 480 : 600;
  const outboundFlight = plan.flight?.outbound.find(offer => offer.id === plan.flight?.suggestedOutboundId);
  if (outboundFlight && plan.flight?.destinationAirport.utcOffsetMinutes !== undefined && plan.flight.outboundLastMile) {
    const arrival = localClockMinutes(outboundFlight.arrivalAt, plan.flight.destinationAirport.utcOffsetMinutes, plan.days[0].date);
    return arrival === null ? null : arrival + plan.flight.outboundLastMile.minutes + 30;
  }
  const outbound = plan.travel?.outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
  if (outbound) {
    const arrival = localClockMinutes(outbound.arrivalAt, plan.travel?.destination.utcOffsetMinutes, plan.days[0].date);
    return arrival === null ? null : arrival + 30;
  }
  return null;
}

function nearestUnused(candidates: LivePlace[], used: Set<string>, anchor: LivePlace) {
  return candidates.filter(candidate => !used.has(candidate.id)).sort((a, b) => squaredDistance(a, anchor) - squaredDistance(b, anchor));
}
function squaredDistance(a: LivePlace, b: LivePlace) { return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2; }

function flightHubToLivePlace(hub: FlightHub, utcOffsetMinutes: number, checkedAt: string): LivePlace & { airportCode: string } {
  const query = `${hub.latitude},${hub.longitude}`;
  return { id: `iata:${hub.code}`, airportCode: hub.code, name: hub.name, address: `${hub.code} · ${hub.countryCode}`, lat: hub.latitude, lng: hub.longitude, source: 'Nuitée Connect', checkedAt, mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, utcOffsetMinutes, attributions: [{ name: 'Nuitée Connect', url: 'https://www.nuitee.com/' }] };
}

function minutesBefore(value: string, minutes: number) { return new Date(Date.parse(value) - minutes * 60_000).toISOString(); }

function selectFlight(offers: import('@/inventory/contracts').TransportOffer[], direction: 'outbound' | 'return') {
  const usable = offers.filter(offer => {
    const value = direction === 'outbound' ? offer.arrivalAt : offer.departureAt;
    const minutes = Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
    return direction === 'outbound' ? minutes <= 13 * 60 : minutes >= 17 * 60;
  });
  return [...(usable.length ? usable : offers)].sort((a, b) => a.price.amount - b.price.amount || a.durationMinutes - b.durationMinutes)[0];
}

function stayOfferToLivePlace(offer: StayOffer): LivePlace {
  const facts = offer.propertyFacts;
  const latitude = facts.latitude;
  const longitude = facts.longitude;
  if (latitude === undefined || longitude === undefined) throw new Error(`Nuitée offer ${offer.id} has no coordinates.`);
  const query = `${latitude},${longitude}`;
  return {
    id: offer.propertyId,
    name: facts.name,
    address: facts.address ?? '',
    lat: latitude,
    lng: longitude,
    source: 'Nuitée Connect',
    checkedAt: offer.source.checkedAt ?? new Date().toISOString(),
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    rating: facts.rating > 0 ? facts.rating : undefined,
    reviewCount: facts.reviewCount,
    photo: facts.imageUrl ? { url: facts.imageUrl, authors: [{ name: facts.imageCredit ?? 'Nuitée Connect' }] } : undefined,
    editorialSummary: facts.description,
    amenities: facts.amenities,
    attributions: [{ name: 'Nuitée Connect', url: 'https://www.nuitee.com/' }],
    stayOffer: offer,
  };
}

function departureTime(date: string, hour: number, offsetMinutes?: number) {
  const offset = offsetMinutes ?? 0;
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  const zone = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  return `${date}T${String(hour).padStart(2, '0')}:00:00${zone}`;
}

async function flightFallbackRoutes(provider: LiveProvider, origin: LivePlace, hotel: LivePlace, outboundDate: string, returnDate: string, warnings: string[]) {
  const outboundDeparture = departureTime(outboundDate, 8, origin.utcOffsetMinutes);
  const returnDeparture = departureTime(returnDate, 17, hotel.utcOffsetMinutes);
  const requests = await Promise.allSettled([
    provider.travelRoutes(origin, hotel, { direction: 'outbound', mode: 'drive', departureTime: outboundDeparture }),
    provider.travelRoutes(origin, hotel, { direction: 'outbound', mode: 'transit', departureTime: outboundDeparture }),
    provider.travelRoutes(hotel, origin, { direction: 'return', mode: 'drive', departureTime: returnDeparture }),
    provider.travelRoutes(hotel, origin, { direction: 'return', mode: 'transit', departureTime: returnDeparture }),
  ]);
  const value = (index: number) => requests[index].status === 'fulfilled' ? requests[index].value : [];
  const roadAlternatives = (options: LiveTravelOption[]) => options.slice(0, 1).flatMap(option => [
    { ...option, id: `${option.id}:self-drive`, roadUse: 'self_drive' as const, label: 'Self-drive' },
    { ...option, id: `${option.id}:cab`, roadUse: 'cab' as const, label: 'Cab route estimate' },
  ]);
  const outbound = [...value(1), ...roadAlternatives(value(0))];
  const returning = [...value(3), ...roadAlternatives(value(2))];
  if (!value(1).length || !value(3).length) warnings.push('Train and bus schedules were not available for one or both directions. Google transit schedules are shown only when returned for the requested dates.');
  if (!value(0).length || !value(2).length) warnings.push('A road fallback could not be validated for one or both directions.');
  if (outbound.some(option => option.roadUse === 'cab') || returning.some(option => option.roadUse === 'cab')) warnings.push('Cab alternatives use Google road distance and duration only. Cab availability, pickup time and fare are not verified.');
  return {
    origin,
    destination: hotel,
    outbound,
    return: returning,
    suggestedOutboundId: null,
    suggestedReturnId: null,
    selectionReason: 'Flight offers were unavailable. These are Google-validated route alternatives; no fallback is selected automatically.',
    assumptions: [
      'Train and bus labels reflect the transit modes actually returned by Google Routes; they do not confirm seats or ticket prices.',
      'Self-drive and cab use the same traffic-aware road route. Fuel, tolls, parking, cab availability and cab fare remain unresolved.',
    ],
    context: 'flight_fallback' as const,
  };
}
