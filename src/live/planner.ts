import { z } from 'zod';
import { addCalendarDays } from '@/domain/dates';
import { liveBriefSchema, type LiveRequest, type LiveResponse, type LivePlan, type LivePlace, type LiveTravelOption } from './contracts';
import type { LiveProvider } from './google.server';
import type { StayProvider, SupplierStaySearchResult } from '@/inventory/providers/stay-provider';
import type { StayOffer } from '@/inventory/contracts';
import { hoursValidationNote, regularHoursStatus, validateRegularHoursInterval } from './opening-hours';
import { dayStops, localClockMinutes, projectLiveDay } from './timeline';
import type { FlightHub, FlightProvider } from '@/transport/providers/nuitee-flight.server';
import { allocateActivities, mealDuration, mealWindow, prepareDaySchedule, reflowAndAssessDay, resolvedPace, targetActivityCount, type DayBounds } from './scheduler';
import { missingLiveEssential } from './essentials';

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
  emit('Understanding where you want to go and what matters to you…');
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
  const missing = missingLiveEssential(brief, { today, modelQuestion: question, flightConfigured: Boolean(deps.flightProvider) });
  if (missing) return { kind: 'live', brief, message: missing };
  deps.signal.throwIfAborted();
  emit('Looking for stays, activities, restaurants and evening options…');
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
    searchActivityCandidates(deps.provider, brief),
    deps.provider.search(restaurantQuery(brief), Math.min(14, brief.days! * 2)),
    brief.dayRhythm === 'early_nights' ? Promise.resolve([]) : deps.provider.search(eveningQuery(brief), 5),
  ]);
  const hotels = searches[0].status === 'fulfilled' ? searches[0].value : [];
  const activities = searches[1].status === 'fulfilled' ? searches[1].value : [];
  const restaurants = searches[2].status === 'fulfilled' ? searches[2].value : [];
  const eveningOptions = searches[3].status === 'fulfilled' ? searches[3].value : [];
  const explicitlyRequestedEvening = brief.dayRhythm === 'evening_experiences' || brief.dayRhythm === 'nightlife';
  const planningActivities = explicitlyRequestedEvening ? mergePlaces(activities, eveningOptions) : activities;
  const warnings: string[] = [
    supplierStaySearch
      ? `${supplierStaySearch.environment === 'sandbox' ? 'Sandbox' : 'Live'} supplier stay prices and availability were checked for the stated dates. Entry fees, meal prices, dietary handling and transfer fares remain unresolved, so total cost and budget compliance are unknown.`
      : 'Provisional plan: hotel room prices, availability, entry fees, meal prices, dietary handling and transfer fares are not checked. Total cost and budget compliance are unknown.',
    brief.travelMode === 'flight'
      ? 'Nuitée Flights is checking separate one-way sandbox offers; Google Routes is checking the road transfers to and from each airport. No booking is made.'
      : `Google Routes is checking ${travelModeDescription(brief.travelMode!)} directions based on your stated preference. It does not prove seats, tickets, bookable fares or private-cab quotes.`,
    'Local driving durations reflect traffic at the time of this search. Activity durations and the 15-minute connection buffers are planning assumptions.',
    'Regular opening hours are reference information, not confirmed opening on your travel dates. Review each visit before booking.',
    'Restaurant identity, location, ratings and regular hours come from Google Places. Menu, allergens, kitchen separation and pure-vegetarian status require confirmation with the restaurant.',
    ...brief.constraints.map(c => `Needs verification: ${c}`),
    ...(supplierStaySearch?.assumptions.map(assumption => `Stay search assumption: ${assumption}`) ?? []),
  ];
  if (searches.some(r => r.status === 'rejected')) warnings.push('One live provider search failed. Showing the results that were available; no snapshot fallback was used.');
  if (!hotels.length) warnings.push('No hotel candidates returned; stay and hotel transfers remain unresolved.');
  if (!planningActivities.length) warnings.push('No attraction candidates returned; days remain unplanned.');
  if (!restaurants.length) warnings.push('No restaurant candidates returned; meal locations remain incomplete.');
  const plan: LivePlan = {
    brief, hotels, selectedHotelId: null, activityOptions: planningActivities, mealOptions: restaurants,
    eveningOptions,
    eveningPrompt: eveningOptions.length && !explicitlyRequestedEvening ? eveningPrompt(brief, eveningOptions) : undefined,
    days: Array.from({ length: brief.days! }, (_, i) => ({ date: addCalendarDays(brief.startDate!, i), visits: [], meals: [], legs: [] })),
    warnings, checkedAt: new Date().toISOString(), status: 'provisional', totalCost: null,
    scheduling: { pace: resolvedPace(brief), paceDefaulted: brief.pace === null, findings: [] },
    locks: { hotel: false, outboundFlight: false, returnFlight: false, outboundTravel: false, returnTravel: false, activityIds: [] },
  };
  if (!hotels.length || !planningActivities.length) return { kind: 'live', brief, plan, message: partialPlanMessage(plan) };
  emit('Choosing a stay and shaping each day around your pace and travel time…');
  let selection: z.infer<typeof selectionSchema>;
  try { selection = selectionSchema.parse(await deps.model.select(brief, hotels, planningActivities)); }
  catch { plan.warnings.push('AI could not produce a valid selection. No itinerary was invented.'); return { kind: 'live', brief, plan, message: 'I found places that could work, but I couldn’t arrange them into a reliable day-by-day plan. Please try again and I’ll rebuild the schedule.' }; }
  const hotel = hotels.find(h => h.id === selection.hotelId);
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  // Reject the whole selection if the model references unobserved IDs or repeats a place.
  const valid = hotel && selection.visits.length > 0 && selection.visits.every(v => {
    const count = (counts.get(v.day) ?? 0) + 1; counts.set(v.day, count);
    if (v.day > brief.days! || count > 4 || seen.has(v.placeId) || !planningActivities.some(a => a.id === v.placeId)) return false;
    seen.add(v.placeId); return true;
  });
  if (!valid || !hotel) { plan.warnings.push('AI selection failed validation. No unverified selections were applied.'); return { kind: 'live', brief, plan, message: 'I found suitable options, but their first arrangement didn’t pass the timing and availability checks. I left the itinerary unchanged so you can retry safely.' }; }
  plan.selectedHotelId = hotel.id;
  emit(brief.travelMode === 'flight' ? 'Comparing flights and the transfers to and from each airport…' : `Comparing ${travelModeDescription(brief.travelMode!)} options for the outward and return journeys…`);
  let resolvedRouteOrigin: LivePlace | undefined;
  try {
    const cityOriginModes = ['public_transit', 'train', 'bus', 'recommend'];
    const routeOriginQuery = cityOriginModes.includes(brief.travelMode!) ? brief.origin! : brief.pickupLocation!;
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
      const profile = routeSearchProfile(brief.travelMode!);
      const requests = profile.flatMap(request => [
        deps.provider.travelRoutes(origin, hotel, { direction: 'outbound', departureTime: outboundDeparture, ...request }),
        deps.provider.travelRoutes(hotel, origin, { direction: 'return', departureTime: returnDeparture, ...request }),
      ]);
      const results = await Promise.allSettled(requests);
      const available = results.map(result => result.status === 'fulfilled' ? result.value : []);
      const outbound = available.filter((_, index) => index % 2 === 0).flat().sort(recommendedRouteComparator(brief));
      const returning = available.filter((_, index) => index % 2 === 1).flat().sort(recommendedRouteComparator(brief));
      plan.travel = {
        origin,
        destination: hotel,
        outbound,
        return: returning,
        suggestedOutboundId: outbound[0]?.id ?? null,
        suggestedReturnId: returning[0]?.id ?? null,
        selectionReason: routeSelectionReason(brief, [...outbound, ...returning]),
        assumptions: [
          brief.travelMode === 'self_drive' || brief.travelMode === 'cab' ? `${origin.name} is Google's match for the starting location you provided.` : `${origin.name} is a city-level route origin, not a confirmed station or stop.`,
          `Outbound alternatives were requested for 08:00 on ${brief.startDate}; return alternatives for 17:00 on ${returnDate}.`,
          'Transit modes, lines and times are shown only when Google Routes returned them. A route is not evidence of ticket or seat availability.',
          ...(brief.travelMode === 'recommend' ? ['The recommendation compares observed route duration and group-size practicality. Returned transit fares are displayed when available; private-cab price, vehicle capacity and total budget fit remain unresolved.'] : []),
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
  emit('Checking opening hours, transfers and meal timing…');
  const bounds = plan.days.map((_, index): DayBounds => ({ startMinutes: plannerDayStart(plan, index), endMinutes: plannerDayEnd(plan, index) }));
  const allocated = allocateActivities({
    brief,
    candidates: planningActivities,
    hints: [
      ...(explicitlyRequestedEvening && eveningOptions[0] ? [{ placeId: eveningOptions[0].id, dayIndex: Math.min(1, plan.days.length - 1), durationMinutes: 120 }] : []),
      ...selection.visits.map(visit => ({ placeId: visit.placeId, dayIndex: visit.day - 1, durationMinutes: visit.durationMinutes })),
    ],
    bounds,
  });
  const detailed = new Map<string, LivePlace>();
  let detailCalls = 0;
  for (const visit of allocated.flat()) {
    deps.signal.throwIfAborted();
    if (detailed.has(visit.place.id)) continue;
    try {
      if (detailCalls >= 6) { detailed.set(visit.place.id, visit.place); continue; }
      detailCalls++;
      const result = await deps.provider.details(visit.place.id);
      detailed.set(visit.place.id, { ...visit.place, ...result, regularHours: result.regularHours ?? visit.place.regularHours, openingHours: result.openingHours ?? visit.place.openingHours, editorialSummary: result.editorialSummary ?? visit.place.editorialSummary });
    } catch {
      detailed.set(visit.place.id, visit.place);
      warnings.push(`${visit.place.name}: detailed place information was unavailable; the observed search result is retained.`);
    }
  }
  plan.activityOptions = plan.activityOptions?.map(candidate => detailed.get(candidate.id) ?? candidate);
  for (let sourceDayIndex = 0; sourceDayIndex < allocated.length; sourceDayIndex++) for (const visit of allocated[sourceDayIndex]) {
    const place = detailed.get(visit.place.id) ?? visit.place;
    const requested = plan.days[sourceDayIndex];
    let target = sourceDayIndex;
    let status = regularHoursStatus(place, requested.date);
    if (status === 'closed') {
      const alternatives = plan.days
        .map((candidate, index) => ({ index, distance: Math.abs(index - sourceDayIndex), status: regularHoursStatus(place, candidate.date) }))
        .filter(candidate => candidate.status === 'open' && plan.days[candidate.index].visits.length < targetActivityCount(brief, candidate.index, bounds[candidate.index]))
        .sort((a, b) => a.distance - b.distance || a.index - b.index);
      if (!alternatives.length) {
        warnings.push(`${place.name} was omitted because it is usually closed on the proposed day and no open trip day had capacity.`);
        continue;
      }
      target = alternatives[0].index;
      status = 'open';
      warnings.push(`${place.name} moved from ${requested.date} to ${plan.days[target].date} because its regular hours show it closed on the proposed day.`);
    }
    plan.days[target].visits.push({ ...visit, place, hoursStatus: status === 'open' ? 'open' : 'unknown', hoursNote: hoursValidationNote(status, plan.days[target].date) });
  }
  plan.days.forEach((day, index) => prepareDaySchedule(day, brief.travellers!, bounds[index], brief));
  await scheduleMeals(plan, hotel, restaurants, deps.provider, deps.signal, warnings);
  plan.days.forEach((day, index) => prepareDaySchedule(day, brief.travellers!, bounds[index], brief));
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
    const dayIndex = plan.days.indexOf(day);
    reflowAndAssessDay(day, dayIndex, bounds[dayIndex].startMinutes, bounds[dayIndex].endMinutes, brief);
    applyScheduleValidations(plan, day, dayIndex, warnings);
    const findings = reflowAndAssessDay(day, dayIndex, bounds[dayIndex].startMinutes, bounds[dayIndex].endMinutes, brief);
    plan.scheduling!.findings.push(...findings);
  }
  const blocking = plan.scheduling!.findings.filter(finding => finding.severity === 'blocking');
  const unresolved = plan.scheduling!.findings.filter(finding => finding.severity === 'unresolved');
  if (blocking.length) warnings.push(`${blocking.length} schedule constraint${blocking.length === 1 ? '' : 's'} need changes before this itinerary can be relied on.`);
  if (unresolved.length) warnings.push(`${unresolved.length} schedule connection${unresolved.length === 1 ? '' : 's'} remain unresolved.`);
  deps.signal.throwIfAborted();
  return { kind: 'live', brief, plan, message: planCompletionMessage(plan, hotel) };
}

function partialPlanMessage(plan: LivePlan) {
  if (!plan.hotels.length && !plan.activityOptions?.length) return `I couldn’t find enough stay or activity information for ${plan.brief.destination} to build a useful itinerary. Try the search again, or adjust the destination or dates.`;
  if (!plan.hotels.length) return `I found activities in ${plan.brief.destination}, but no stay that I could use as a reliable base for these dates. I’ve kept the activity ideas visible so you can review them before trying again.`;
  return `I found places to stay in ${plan.brief.destination}, but not enough activity information to build dependable days around them. I’ve kept the stays visible and left the schedule open rather than filling it with guesses.`;
}

function planCompletionMessage(plan: LivePlan, hotel: LivePlace) {
  const activityCount = plan.days.reduce((total, day) => total + day.visits.length, 0);
  const restaurantMeals = plan.days.flatMap(day => day.meals ?? []).filter(meal => meal.location === 'restaurant');
  const corridorMeals = restaurantMeals.filter(meal => meal.routeFit?.basis === 'route_corridor').length;
  const pace = plan.scheduling?.pace ?? 'balanced';
  const unresolved = plan.scheduling?.findings.filter(finding => finding.severity === 'unresolved').length ?? 0;
  const blocking = plan.scheduling?.findings.filter(finding => finding.severity === 'blocking').length ?? 0;
  const issueCount = blocking + unresolved;
  const paragraphs = [
    `I’ve put together a ${plan.brief.days}-day trip to ${plan.brief.destination} for ${plan.brief.travellers} traveller${plan.brief.travellers === 1 ? '' : 's'}.`,
    `I’m using ${hotel.name} as your base and planned each day from and back to the stay, so the activities, transfers and meal stops stay connected. I scheduled ${activityCount} activit${activityCount === 1 ? 'y' : 'ies'} at a ${pace} pace, keeping arrival and departure days within the time your travel leaves available.`,
    mealDecisionMessage(restaurantMeals.length, corridorMeals, plan.brief.dietaryPreference),
    travelDecisionMessage(plan),
    issueCount
      ? `There ${issueCount === 1 ? 'is' : 'are'} still ${issueCount} timing or connection ${issueCount === 1 ? 'detail' : 'details'} to review. I’ve marked them beside the affected items instead of guessing.`
      : 'The scheduled items fit the current timing checks. Prices and bookable availability can still change, so refresh them before you reserve anything.',
    plan.eveningPrompt,
  ].filter((value): value is string => Boolean(value));
  return paragraphs.join('\n\n');
}

function mealDecisionMessage(mealCount: number, corridorMeals: number, preference: z.infer<typeof liveBriefSchema>['dietaryPreference']) {
  if (!mealCount) return 'I left meal locations open because there wasn’t enough reliable restaurant information to place them without guessing.';
  const dietary = preference === 'pure_vegetarian' ? 'your pure-vegetarian preference' : preference === 'vegetarian' ? 'your vegetarian preference' : preference === 'non_vegetarian' ? 'your non-vegetarian preference' : preference === 'both' ? 'your preference for both vegetarian and non-vegetarian food' : 'flexible dining options';
  return `I added ${mealCount} restaurant stop${mealCount === 1 ? '' : 's'} for ${dietary}.${corridorMeals ? ` ${corridorMeals} ${corridorMeals === 1 ? 'was' : 'were'} placed along the surrounding route to reduce unnecessary detours.` : ' Their exact route fit still needs a quick review.'}`;
}

function travelDecisionMessage(plan: LivePlan) {
  const outboundFlight = plan.flight?.outbound.find(option => option.id === plan.flight?.suggestedOutboundId);
  const returnFlight = plan.flight?.return.find(option => option.id === plan.flight?.suggestedReturnId);
  if (outboundFlight || returnFlight) {
    const choices = [outboundFlight ? `${flightName(outboundFlight)} outward` : '', returnFlight ? `${flightName(returnFlight)} for the return` : ''].filter(Boolean);
    return `For travel, I chose ${choices.join(' and ')}. The shortlist first protects useful arrival and departure times, then compares price and journey length; airport transfers and check-in buffers are included in the timeline.`;
  }
  if (plan.brief.travelMode === 'flight' && plan.travel?.context === 'flight_fallback') return 'I couldn’t find a usable flight for one or both journeys, so I left train, bus, cab and self-drive routes available for comparison without choosing one for you.';
  if (plan.travel) return `For travel, ${plan.travel.selectionReason} The selected route sets the usable time on your first and last days.`;
  return 'Travel timing is still unresolved, so I kept the first and last days light rather than planning around an assumed arrival or departure.';
}

function flightName(offer: import('@/inventory/contracts').TransportOffer) {
  const number = offer.segments[0]?.number;
  return `${offer.operator}${number ? ` ${number}` : ''}`;
}

type RouteSearchInput = Pick<Parameters<LiveProvider['travelRoutes']>[2], 'mode' | 'transitModes' | 'roadUse'>;

function routeSearchProfile(mode: NonNullable<z.infer<typeof liveBriefSchema>['travelMode']>): RouteSearchInput[] {
  if (mode === 'self_drive') return [{ mode: 'drive', roadUse: 'self_drive' }];
  if (mode === 'cab') return [{ mode: 'drive', roadUse: 'cab' }];
  if (mode === 'train') return [{ mode: 'transit', transitModes: ['TRAIN', 'LIGHT_RAIL', 'RAIL', 'SUBWAY'] }];
  if (mode === 'bus') return [{ mode: 'transit', transitModes: ['BUS'] }];
  if (mode === 'recommend') return [{ mode: 'transit' }, { mode: 'drive', roadUse: 'cab' }];
  return [{ mode: 'transit' }];
}

function recommendedRouteComparator(brief: z.infer<typeof liveBriefSchema>) {
  return (left: LiveTravelOption, right: LiveTravelOption) => routeRecommendationScore(left, brief) - routeRecommendationScore(right, brief);
}

function routeRecommendationScore(option: LiveTravelOption, brief: z.infer<typeof liveBriefSchema>) {
  if (brief.travelMode !== 'recommend') return option.minutes;
  const preferenceText = `${brief.preferences} ${brief.constraints.join(' ')}`.toLowerCase();
  const budgetConscious = /budget|afford|econom|low[ -]?cost|save money/.test(preferenceText);
  const comfortFocused = /comfort|convenien|accessib|senior|young child|toddler/.test(preferenceText);
  const coordinationPenalty = option.mode === 'transit' && brief.travellers! >= 5 ? 45 : option.mode === 'drive' && brief.travellers! <= 2 ? 30 : 0;
  const budgetAdjustment = budgetConscious ? option.mode === 'transit' ? -25 : 25 : 0;
  const comfortAdjustment = comfortFocused ? option.mode === 'drive' ? -20 : 20 : 0;
  return option.minutes + coordinationPenalty + budgetAdjustment + comfortAdjustment;
}

function routeSelectionReason(brief: z.infer<typeof liveBriefSchema>, options: LiveTravelOption[]) {
  if (brief.travelMode !== 'recommend') return `I picked the quickest route returned for your ${travelModeDescription(brief.travelMode!)} preference.`;
  const hasFare = options.some(option => option.fare);
  const preferenceText = `${brief.preferences} ${brief.constraints.join(' ')}`.toLowerCase();
  const signals = [
    /budget|afford|econom|low[ -]?cost|save money/.test(preferenceText) ? 'budget preference' : '',
    /comfort|convenien|accessib|senior|young child|toddler/.test(preferenceText) ? 'comfort or accessibility preference' : '',
  ].filter(Boolean);
  return `I compared journey time and what is practical for ${brief.travellers} traveller${brief.travellers === 1 ? '' : 's'}${signals.length ? `, including your ${signals.join(' and ')}` : ''}.${hasFare ? ' Any returned transit fare stays visible for comparison.' : ' There wasn’t a comparable fare, so price was not treated as known.'}`;
}

function travelModeDescription(mode: NonNullable<z.infer<typeof liveBriefSchema>['travelMode']>) {
  if (mode === 'self_drive') return 'self-drive';
  if (mode === 'cab') return 'private-cab';
  if (mode === 'train') return 'train';
  if (mode === 'bus') return 'bus';
  if (mode === 'recommend') return 'transit and cab comparison';
  return 'public-transit';
}

async function searchActivityCandidates(provider: LiveProvider, brief: z.infer<typeof liveBriefSchema>) {
  const preference = brief.preferences.slice(0, 120);
  const queries = [
    `tourist heritage landmarks attractions in ${brief.destination} ${preference}`,
    `tourist museums arts culture experiences in ${brief.destination} ${preference}`,
    `tourist local markets neighbourhoods walking areas in ${brief.destination} ${preference}`,
    `tourist parks gardens viewpoints scenic places in ${brief.destination} ${preference}`,
    `tourist outdoor adventure trekking sports experiences in ${brief.destination} ${preference}`,
    `tourist family activities family attractions in ${brief.destination} ${preference}`,
  ];
  const results = await Promise.allSettled(queries.map(query => provider.search(query.trim(), 4)));
  const places = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!places.length && results.some(result => result.status === 'rejected')) throw new Error('Activity discovery failed.');
  return mergePlaces([], places);
}

function restaurantQuery(brief: z.infer<typeof liveBriefSchema>) {
  const dining = brief.dietaryPreference === 'pure_vegetarian' ? 'pure vegetarian restaurants'
    : brief.dietaryPreference === 'vegetarian' ? 'vegetarian restaurants'
    : brief.dietaryPreference === 'non_vegetarian' ? 'non vegetarian restaurants'
    : brief.dietaryPreference === 'both' ? 'restaurants with vegetarian and non vegetarian food'
    : 'restaurants';
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
    : plan.brief.dietaryPreference
      ? `${plan.brief.dietaryPreference === 'both' ? 'Vegetarian and non-vegetarian' : plan.brief.dietaryPreference.replace('_', '-')} preference used for this Google restaurant search${plan.brief.dietaryNotes ? ` · ${plan.brief.dietaryNotes}` : ''}.`
      : `No dining preference was stated; confirm menu and dietary fit${plan.brief.dietaryNotes ? ` · ${plan.brief.dietaryNotes}` : ''}.`;
  for (let dayIndex = 0; dayIndex < plan.days.length; dayIndex++) {
    const day = plan.days[dayIndex];
    if (dayIndex > 0) {
      const window = mealWindow('breakfast', plan.brief);
      day.meals!.push({ type: 'breakfast', place: hotel, durationMinutes: mealDuration('breakfast', plan.brief.travellers ?? 1), targetStartMinutes: window.preferredStartMinutes, window, location: 'stay', dietaryNote: hotel.stayOffer?.roomFacts.mealPlan === 'breakfast' ? 'Breakfast is included in the selected sandbox room offer; menu and dietary fit require confirmation.' : 'Breakfast is planned at or near the stay; inclusion, menu and price are unverified.' });
    }
    for (const type of ['lunch', 'dinner'] as const) {
      const window = mealWindow(type, plan.brief);
      const slot = { type, target: window.preferredStartMinutes, duration: mealDuration(type, plan.brief.travellers ?? 1), window };
      let selected: LivePlace | undefined;
      const selectedLunch = day.meals?.find(meal => meal.type === 'lunch')?.place;
      const morning = day.visits.filter(visit => (visit.sequenceOrder ?? 40) < 30);
      const later = day.visits.filter(visit => (visit.sequenceOrder ?? 40) > 30 && (visit.sequenceOrder ?? 40) < 70);
      const from = slot.type === 'lunch'
        ? morning.at(-1)?.place ?? hotel
        : later.at(-1)?.place ?? selectedLunch ?? morning.at(-1)?.place ?? hotel;
      const to = slot.type === 'lunch' ? later[0]?.place ?? hotel : hotel;
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
        type: slot.type, place: selected, durationMinutes: slot.duration, targetStartMinutes: slot.target, window: slot.window, location: 'restaurant', dietaryNote,
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
  if (dayIndex > 0) return 480;
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

export function plannerDayEnd(plan: LivePlan, dayIndex: number) {
  if (dayIndex < plan.days.length - 1) return 22 * 60;
  const returnFlight = plan.flight?.return.find(offer => offer.id === plan.flight?.suggestedReturnId);
  if (returnFlight && plan.flight?.destinationAirport.utcOffsetMinutes !== undefined && plan.flight.returnFirstMile) {
    const departure = localClockMinutes(returnFlight.departureAt, plan.flight.destinationAirport.utcOffsetMinutes, plan.days[dayIndex].date);
    return departure === null ? null : departure - plan.flight.returnFirstMile.minutes - 120;
  }
  const returning = plan.travel?.return.find(option => option.id === plan.travel?.suggestedReturnId);
  if (returning) {
    const departure = localClockMinutes(returning.departureAt, plan.travel?.destination.utcOffsetMinutes, plan.days[dayIndex].date);
    return departure ?? 17 * 60;
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
