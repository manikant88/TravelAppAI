import { z } from 'zod';
import { addCalendarDays } from '@/domain/dates';
import { LIVE_TRIP_MAX_DAYS, LIVE_TRIP_MIN_DAYS, liveBriefSchema, provisionalDateGuidanceSchema, type LiveBrief, type LiveGenerationIssue, type LiveRequest, type LiveResponse, type LivePlan, type LivePlace, type LiveRoadJourneyPlan, type LiveTravelOption } from './contracts';
import type { LiveProvider } from './google.server';
import type { StayProvider, SupplierStaySearchResult } from '@/inventory/providers/stay-provider';
import type { StayOffer } from '@/inventory/contracts';
import { hoursValidationNote, regularHoursStatus, validateRegularHoursInterval } from './opening-hours';
import { dayStops, localClockMinutes, projectLiveDay, travelOptionInstant } from './timeline';
import type { FlightHub, FlightProvider } from '@/transport/providers/nuitee-flight.server';
import { allocateActivities, mealDuration, mealWindow, prepareDaySchedule, reflowAndAssessDay, resolvedPace, targetActivityCount, type DayBounds } from './scheduler';
import { applyLivePlanningDefaults, missingLiveEssential } from './essentials';
import { assessRoadJourneyPair, attachTransitStays, buildRoadJourneyPlan } from './road-journey';
import { explicitLiveDateRange } from './explicit-dates';
import { routeSearchProfiles, scheduleFriendlyFlights, selectRecommendedFlight } from './travel-policy';
import { deterministicBriefFallback, repairMissingExplicitCoreFacts } from './intake-fallback';
import { flightCandidate, routeCandidate, selectBudgetAwareHotel, selectJourneyRecommendation, type JourneyRecommendation } from './recommendation-policy';
import { isLiveSearchRetryRequest } from './recovery-intent';
import { provisionalDateGuidanceMessage, validateProvisionalDateGuidance, type ModelDateGuidance } from './date-guidance';

export { deterministicBriefFallback } from './intake-fallback';

export const extractionSchema = z.object({
  brief: liveBriefSchema,
  question: z.string().max(500).nullable(),
  dateGuidance: provisionalDateGuidanceSchema.nullable(),
}).strict();
export const selectionSchema = z.object({
  hotelId: z.string(),
  visits: z.array(z.object({ placeId: z.string(), day: z.number().int().min(1).max(LIVE_TRIP_MAX_DAYS), durationMinutes: z.number().int().min(30).max(180) }).strict()).max(LIVE_TRIP_MAX_DAYS * 4),
}).strict();
export interface LiveModel {
  extract(input: LiveRequest): Promise<{ brief: LiveBrief; question: string | null; dateGuidance?: ModelDateGuidance | null }>;
  select(brief: z.infer<typeof liveBriefSchema>, hotels: LivePlace[], activities: LivePlace[]): Promise<z.infer<typeof selectionSchema>>;
}
export async function runLivePlan(input: LiveRequest, deps: { model: LiveModel; provider: LiveProvider; stayProvider?: StayProvider; flightProvider?: FlightProvider; signal: AbortSignal; progress?: (message: string) => void; today?: string; guestNationality?: string }): Promise<LiveResponse> {
  const emit = deps.progress ?? (() => {});
  emit('Understanding where you want to go and what matters to you…');
  let extracted: z.infer<typeof extractionSchema>;
  if (isLiveSearchRetryRequest(input.message)) {
    extracted = { brief: { ...input.brief }, question: null, dateGuidance: null };
  } else {
    try {
      const modelExtraction = await deps.model.extract(input);
      extracted = extractionSchema.parse({ ...modelExtraction, dateGuidance: modelExtraction.dateGuidance ?? null });
      extracted.brief = repairMissingExplicitCoreFacts(input, extracted.brief);
    }
    catch (error) {
      const fallback = deterministicBriefFallback(input);
      if (!fallback) throw error;
      extracted = { brief: fallback, question: null, dateGuidance: null };
    }
  }
  let { brief } = extracted;
  const { question } = extracted;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  // A schema-valid date is not evidence that the user supplied that year.
  const userText = [...input.history.filter(m => m.role === 'user').map(m => m.text), input.message].join(' ');
  const statedYears: string[] = userText.match(/\b(?:19|20|21)\d{2}\b/g) ?? [];
  if (input.brief.startDate) statedYears.push(input.brief.startDate.slice(0, 4));
  const explicitDates = explicitLiveDateRange(input.message);
  if (explicitDates) {
    brief.startDate = explicitDates.startDate;
    brief.days = explicitDates.days;
    brief.nightsConfirmed = true;
  } else if (brief.startDate && !statedYears.includes(brief.startDate.slice(0, 4))) {
    brief.startDate = null;
    brief.nightsConfirmed = false;
  }
  brief = applyLivePlanningDefaults(brief);
  const missing = missingLiveEssential(brief, { today, modelQuestion: question, flightConfigured: Boolean(deps.flightProvider) });
  if (missing) {
    const dateGuidance = validateProvisionalDateGuidance(extracted.dateGuidance, brief, today);
    return {
      kind: 'live',
      brief,
      message: dateGuidance && !brief.startDate ? provisionalDateGuidanceMessage(dateGuidance) : missing,
      dateGuidance,
    };
  }
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
  if (searches.some(r => r.status === 'rejected')) warnings.push('One live provider search failed. Showing the results that were available.');
  if (!hotels.length) warnings.push('No hotel candidates returned; stay and hotel transfers remain unresolved.');
  if (!planningActivities.length) warnings.push('No attraction candidates returned; days remain unplanned.');
  if (!restaurants.length) warnings.push('No restaurant candidates returned; meal locations remain incomplete.');
  const plan: LivePlan = {
    brief, hotels, selectedHotelId: null, activityOptions: planningActivities, mealOptions: restaurants,
    eveningOptions,
    eveningPrompt: eveningOptions.length && !explicitlyRequestedEvening ? eveningPrompt(brief, eveningOptions) : undefined,
    days: Array.from({ length: brief.days! }, (_, i) => ({ date: addCalendarDays(brief.startDate!, i), visits: [], meals: [], legs: [] })),
    warnings, checkedAt: new Date().toISOString(), status: 'provisional', totalCost: null,
    generationStatus: 'incomplete',
    scheduling: { pace: resolvedPace(brief), paceDefaulted: brief.pace === null, findings: [] },
    locks: { hotel: false, outboundFlight: false, returnFlight: false, outboundTravel: false, returnTravel: false, activityIds: [], mealKeys: [] },
  };
  if (!hotels.length || !planningActivities.length) {
    const missingSearchIndex = !hotels.length ? 0 : 1;
    const failedSearch = searches[missingSearchIndex].status === 'rejected' ? searches[missingSearchIndex].reason : undefined;
    const retryable = failedSearch !== undefined;
    const message = partialPlanMessage(plan, retryable, failedSearch);
    plan.generationIssue = {
      code: !hotels.length ? 'no_stays' : 'no_activities',
      message,
      retryable,
      cause: retryable
        ? searchFailureCause(failedSearch, !hotels.length ? 'The stay search did not finish.' : 'The activity search did not finish after two attempts.')
        : `${!hotels.length ? 'The stay' : 'The activity'} search completed without enough usable results for these dates.`,
    };
    return { kind: 'live', brief, plan, message };
  }
  emit('Choosing a stay and shaping each day around your pace and travel time…');
  let selection: z.infer<typeof selectionSchema>;
  let fallbackReason: string | undefined;
  try { selection = selectionSchema.parse(await deps.model.select(brief, hotels, planningActivities)); }
  catch {
    fallbackReason = 'The first day-by-day arrangement did not finish, so the schedule was rebuilt deterministically from the verified options.';
    selection = deterministicPlaceSelection(brief, hotels, planningActivities);
  }
  let hotel = validatePlaceSelection(selection, brief, hotels, planningActivities);
  if (!hotel) {
    fallbackReason = 'The first day-by-day arrangement contained repeated or unverified options, so those references were discarded and the schedule was rebuilt from the verified options.';
    selection = deterministicPlaceSelection(brief, hotels, planningActivities);
    hotel = validatePlaceSelection(selection, brief, hotels, planningActivities);
  }
  if (!hotel) {
    const message = 'I found stays and activities, but could not form a validated starting arrangement from those results. Change the activity mix or destination before trying again.';
    plan.warnings.push('No validated selection could be formed from the observed options.');
    plan.generationIssue = { code: 'selection_invalid', message, retryable: false, cause: 'The verified search results could not form a valid starting arrangement.' };
    return { kind: 'live', brief, plan, message };
  }
  if (fallbackReason) plan.warnings.push(fallbackReason);
  const budgetHotel = selectBudgetAwareHotel(hotel, hotels, brief.budget);
  if (budgetHotel.id !== hotel.id) {
    const selectedTotal = budgetHotel.stayOffer?.totalPrice;
    const budget = brief.budget!;
    const fitsAllocation = Boolean(selectedTotal && selectedTotal.currency === budget.currency && selectedTotal.amount <= budget.amount * 0.6);
    plan.warnings.push(fitsAllocation
      ? `${budgetHotel.name} was preferred over the initial stay choice because its verified stay total fits the planning allocation for your ₹${budget.amount.toLocaleString('en-IN')} budget.`
      : `${budgetHotel.name} was preferred because it has the lowest comparable verified stay total returned, although it still exceeds the stay allocation within your ₹${budget.amount.toLocaleString('en-IN')} budget.`);
    hotel = budgetHotel;
  }
  plan.selectedHotelId = hotel.id;
  emit(brief.travelMode === 'flight' ? 'Comparing flights and the transfers around each requested airport…' : `Comparing ${travelModeDescription(brief.travelMode!)} options for each requested journey…`);
  let resolvedRouteOrigin: LivePlace | undefined;
  try {
    const cityOriginModes = ['public_transit', 'train', 'bus', 'recommend'];
    const routeOriginQuery = cityOriginModes.includes(brief.travelMode!) ? brief.origin! : brief.pickupLocation!;
    const [origin] = await deps.provider.search(routeOriginQuery, 1);
    resolvedRouteOrigin = origin;
    if (!origin) {
      warnings.push(`Google could not resolve ${routeOriginQuery} to a route origin. The affected intercity journeys remain unresolved.`);
    } else {
      const [destinationCity] = await deps.provider.search(brief.destination!, 1);
      if (destinationCity?.utcOffsetMinutes !== undefined && hotel.utcOffsetMinutes === undefined) hotel.utcOffsetMinutes = destinationCity.utcOffsetMinutes;
      let endDestination = origin;
      if (brief.endIntent === 'continue_elsewhere') {
        const [resolvedEnd] = await deps.provider.search(brief.onwardDestination!, 1);
        if (resolvedEnd) endDestination = resolvedEnd;
        else warnings.push(`The onward destination ${brief.onwardDestination} could not be resolved, so that journey remains unavailable.`);
      }
      if (brief.travelMode === 'flight') {
      if (!destinationCity || origin.utcOffsetMinutes === undefined || destinationCity.utcOffsetMinutes === undefined) {
        warnings.push('The origin or destination time-zone offset could not be resolved. Flight times remain unavailable.');
      } else {
        const returnDate = plan.days.at(-1)!.date;
        const flightSearch = await deps.flightProvider!.search({ origin: { lat: origin.lat, lng: origin.lng, utcOffsetMinutes: origin.utcOffsetMinutes }, destination: { lat: destinationCity.lat, lng: destinationCity.lng, utcOffsetMinutes: destinationCity.utcOffsetMinutes }, departureDate: brief.startDate!, returnDate, travellers: brief.travellers!, currency: 'INR', country: deps.guestNationality ?? 'IN' });
        warnings.push(...flightSearch.warnings.map(value => `Flight search: ${value}`));
        const outboundFlight = selectRecommendedFlight(flightSearch.outbound, 'outbound');
        let endOffers = brief.endIntent === 'return_to_origin' && brief.endTravelMode === 'flight' ? flightSearch.returning : [];
        let returnFlight = endOffers.length ? selectRecommendedFlight(endOffers, 'return') : undefined;
        const originAirport = flightHubToLivePlace(flightSearch.originHub, origin.utcOffsetMinutes, flightSearch.checkedAt);
        const destinationAirport = flightHubToLivePlace(flightSearch.destinationHub, destinationCity.utcOffsetMinutes, flightSearch.checkedAt);
        let endDestinationAirport = brief.endIntent === 'return_to_origin' ? originAirport : undefined;
        if (brief.endIntent === 'continue_elsewhere' && brief.endTravelMode === 'flight' && endDestination.utcOffsetMinutes !== undefined) {
          const onwardSearch = await deps.flightProvider!.search({ origin: { lat: destinationCity.lat, lng: destinationCity.lng, utcOffsetMinutes: destinationCity.utcOffsetMinutes }, destination: { lat: endDestination.lat, lng: endDestination.lng, utcOffsetMinutes: endDestination.utcOffsetMinutes }, departureDate: returnDate, returnDate: addCalendarDays(returnDate, 1), travellers: brief.travellers!, currency: 'INR', country: deps.guestNationality ?? 'IN' });
          warnings.push(...onwardSearch.warnings.map(value => `Onward flight search: ${value}`));
          endOffers = onwardSearch.outbound;
          returnFlight = selectRecommendedFlight(endOffers, 'outbound');
          endDestinationAirport = flightHubToLivePlace(onwardSearch.destinationHub, endDestination.utcOffsetMinutes, onwardSearch.checkedAt);
        }
        const routeRequests = [
          outboundFlight ? deps.provider.travelRoutes(origin, originAirport, { direction: 'outbound', mode: 'drive', departureTime: minutesBefore(outboundFlight.departureAt, 180) }) : Promise.resolve([]),
          outboundFlight ? deps.provider.travelRoutes(destinationAirport, hotel, { direction: 'outbound', mode: 'drive', departureTime: outboundFlight.arrivalAt }) : Promise.resolve([]),
          returnFlight ? deps.provider.travelRoutes(hotel, destinationAirport, { direction: 'return', mode: 'drive', departureTime: minutesBefore(returnFlight.departureAt, 180) }) : Promise.resolve([]),
          returnFlight && endDestinationAirport ? deps.provider.travelRoutes(endDestinationAirport, endDestination, { direction: 'return', mode: 'drive', departureTime: returnFlight.arrivalAt }) : Promise.resolve([]),
        ];
        const transferResults = await Promise.allSettled(routeRequests);
        const transfer = (index: number) => transferResults[index].status === 'fulfilled' ? transferResults[index].value.sort((a, b) => a.minutes - b.minutes)[0] : undefined;
        plan.flight = { origin, destination: hotel, originAirport, destinationAirport, outbound: flightSearch.outbound, return: endOffers, suggestedOutboundId: outboundFlight?.id ?? null, suggestedReturnId: returnFlight?.id ?? null, outboundFirstMile: transfer(0), outboundLastMile: transfer(1), returnFirstMile: transfer(2), returnLastMile: transfer(3), endIntent: brief.endIntent ?? undefined, endDestination: brief.endIntent === 'end_at_destination' ? hotel : endDestination, endDestinationAirport, assumptions: [`${originAirport.name} and ${destinationAirport.name} are the nearest IATA airports found for the resolved locations.`, 'The schedule-aware suggestion preserves usable destination time, then compares price and duration.', 'Airport arrival buffers are planning assumptions: 120 minutes before each flight.', `${flightSearch.environment === 'sandbox' ? 'Sandbox' : 'Live'} fares expire and must be refreshed before selection or booking.`] };
        if (!outboundFlight) warnings.push('No direct outbound flight offer was returned. Day 1 arrival remains unresolved.');
        if (brief.endIntent === 'return_to_origin' && brief.endTravelMode === 'flight' && !returnFlight) warnings.push('No direct return flight offer was returned. Return timing remains unresolved.');
        if (transferResults.some(result => result.status === 'rejected')) warnings.push('One or more airport road transfers failed. The successful flight and transfer evidence remains available.');
        if (!outboundFlight || (brief.endIntent === 'return_to_origin' && brief.endTravelMode === 'flight' && !returnFlight)) plan.travel = await flightFallbackRoutes(deps.provider, origin, hotel, brief.startDate!, returnDate, warnings);
        if (brief.endIntent !== 'end_at_destination' && brief.endTravelMode !== 'flight') {
          const outboundFallback = !outboundFlight ? plan.travel : undefined;
          const endResults = await Promise.allSettled(routeSearchProfiles(brief.endTravelMode!).map(request => deps.provider.travelRoutes(hotel, endDestination, { direction: 'return', departureTime: departureTime(returnDate, 17, hotel.utcOffsetMinutes), ...request })));
          const returning = endResults.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort(recommendedRouteComparator(brief, brief.endTravelMode!));
          plan.travel = {
            origin,
            destination: hotel,
            outbound: outboundFallback?.outbound ?? [],
            return: returning,
            suggestedOutboundId: outboundFallback?.suggestedOutboundId ?? null,
            suggestedReturnId: returning[0]?.id ?? null,
            selectionReason: outboundFallback?.selectionReason ?? routeSelectionReason(brief, returning),
            assumptions: [...(outboundFallback?.assumptions ?? []), 'The journey after the destination is planned independently from the outward flight.'],
            context: outboundFallback?.context ?? 'preferred',
            endIntent: brief.endIntent ?? undefined,
            endDestination,
          };
          const endRoad = returning[0] ? buildRoadJourneyPlan({ option: returning[0], date: addCalendarDays(returnDate, 1 - Math.ceil(returning[0].minutes / (returning[0].roadUse === 'self_drive' ? 480 : 600))), tripDays: brief.days! }) : undefined;
          plan.travel.endRoadPlan = await attachTransitStays(endRoad, returning[0], deps.provider, transitStaySupplier(deps, brief.travellers!));
        }
      }
      } else {
      const returnDate = plan.days.at(-1)!.date;
      const outboundDeparture = departureTime(brief.startDate!, 8, origin.utcOffsetMinutes);
      const endDeparture = departureTime(returnDate, 17, hotel.utcOffsetMinutes);
      const outboundResults = await Promise.allSettled(routeSearchProfiles(brief.travelMode!).map(request => deps.provider.travelRoutes(origin, hotel, { direction: 'outbound', departureTime: outboundDeparture, ...request })));
      const endMode = brief.endIntent === 'end_at_destination' ? null : brief.endTravelMode;
      const endResults = endMode && endMode !== 'flight'
        ? await Promise.allSettled(routeSearchProfiles(endMode).map(request => deps.provider.travelRoutes(hotel, endDestination, { direction: 'return', departureTime: endDeparture, ...request })))
        : [];
      const outbound = dedupeTravelOptions(outboundResults.flatMap(result => result.status === 'fulfilled' ? result.value : [])).sort(recommendedRouteComparator(brief, brief.travelMode!));
      const returning = dedupeTravelOptions(endResults.flatMap(result => result.status === 'fulfilled' ? result.value : [])).sort(recommendedRouteComparator(brief, endMode ?? brief.travelMode!));
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
        endIntent: brief.endIntent ?? undefined,
        endDestination: brief.endIntent === 'end_at_destination' ? hotel : endDestination,
      };

      if (brief.travelMode === 'recommend') {
        const stayTotal = hotel.stayOffer?.totalPrice;
        const stayCost = stayTotal && brief.budget && stayTotal.currency === brief.budget.currency ? stayTotal.amount : 0;
        const journeyCount = brief.endIntent === 'end_at_destination' ? 1 : 2;
        const perJourneyBudget = brief.budget ? { amount: Math.max(0, brief.budget.amount - stayCost) / journeyCount, currency: brief.budget.currency } : null;
        const outboundRecommendation = selectJourneyRecommendation(outbound.map(option => routeCandidate(option, brief.travellers!)), perJourneyBudget);
        const returnRecommendation = brief.endIntent === 'end_at_destination' ? undefined : selectJourneyRecommendation(returning.map(option => routeCandidate(option, brief.travellers!)), perJourneyBudget);
        plan.travel.suggestedOutboundId = outboundRecommendation?.id ?? null;
        plan.travel.suggestedReturnId = returnRecommendation?.id ?? null;
        plan.travel.selectionReason = automaticTravelSelectionReason(brief, outboundRecommendation, returnRecommendation, Boolean(hotel.stayOffer?.totalPrice));
      }

      if (brief.travelMode === 'recommend' && deps.flightProvider && destinationCity && origin.utcOffsetMinutes !== undefined && destinationCity.utcOffsetMinutes !== undefined) {
        try {
          const flightSearch = await deps.flightProvider.search({
            origin: { lat: origin.lat, lng: origin.lng, utcOffsetMinutes: origin.utcOffsetMinutes },
            destination: { lat: destinationCity.lat, lng: destinationCity.lng, utcOffsetMinutes: destinationCity.utcOffsetMinutes },
            departureDate: brief.startDate!, returnDate, travellers: brief.travellers!, currency: 'INR', country: deps.guestNationality ?? 'IN',
          });
          warnings.push(...flightSearch.warnings.map(value => `Flight comparison: ${value}`));
          const originAirport = flightHubToLivePlace(flightSearch.originHub, origin.utcOffsetMinutes, flightSearch.checkedAt);
          const destinationAirport = flightHubToLivePlace(flightSearch.destinationHub, destinationCity.utcOffsetMinutes, flightSearch.checkedAt);
          const outboundFlights = scheduleFriendlyFlights(flightSearch.outbound, 'outbound');
          let endOffers = brief.endIntent === 'return_to_origin' && endMode === 'recommend' ? flightSearch.returning : [];
          let returnFlights = brief.endIntent === 'return_to_origin' && endMode === 'recommend' ? scheduleFriendlyFlights(endOffers, 'return') : [];
          let endDestinationAirport = brief.endIntent === 'return_to_origin' ? originAirport : undefined;
          if (brief.endIntent === 'continue_elsewhere' && endMode === 'recommend' && endDestination.utcOffsetMinutes !== undefined) {
            try {
              const onwardSearch = await deps.flightProvider.search({
                origin: { lat: destinationCity.lat, lng: destinationCity.lng, utcOffsetMinutes: destinationCity.utcOffsetMinutes },
                destination: { lat: endDestination.lat, lng: endDestination.lng, utcOffsetMinutes: endDestination.utcOffsetMinutes },
                departureDate: returnDate, returnDate: addCalendarDays(returnDate, 1), travellers: brief.travellers!, currency: 'INR', country: deps.guestNationality ?? 'IN',
              });
              warnings.push(...onwardSearch.warnings.map(value => `Onward flight comparison: ${value}`));
              endOffers = onwardSearch.outbound;
              returnFlights = scheduleFriendlyFlights(endOffers, 'return');
              endDestinationAirport = flightHubToLivePlace(onwardSearch.destinationHub, endDestination.utcOffsetMinutes, onwardSearch.checkedAt);
            } catch (error) {
              const detail = error instanceof Error && error.message.trim() ? `: ${error.message.trim()}` : '';
              warnings.push(`The onward flight comparison was unavailable${detail}. That journey uses the train, bus and cab evidence that was returned.`);
            }
          }
          const representativeOutbound = outboundFlights[0];
          const representativeReturn = returnFlights[0];
          const transfers = await Promise.allSettled([
            representativeOutbound ? deps.provider.travelRoutes(origin, originAirport, { direction: 'outbound', mode: 'drive', departureTime: minutesBefore(representativeOutbound.departureAt, 180) }) : Promise.resolve([]),
            representativeOutbound ? deps.provider.travelRoutes(destinationAirport, hotel, { direction: 'outbound', mode: 'drive', departureTime: representativeOutbound.arrivalAt }) : Promise.resolve([]),
            representativeReturn ? deps.provider.travelRoutes(hotel, destinationAirport, { direction: 'return', mode: 'drive', departureTime: minutesBefore(representativeReturn.departureAt, 180) }) : Promise.resolve([]),
            representativeReturn && endDestinationAirport ? deps.provider.travelRoutes(endDestinationAirport, endDestination, { direction: 'return', mode: 'drive', departureTime: representativeReturn.arrivalAt }) : Promise.resolve([]),
          ]);
          const transfer = (index: number) => transfers[index].status === 'fulfilled' ? transfers[index].value.sort((a, b) => a.minutes - b.minutes)[0] : undefined;
          plan.flight = {
            origin, destination: hotel, originAirport, destinationAirport,
            outbound: flightSearch.outbound,
            return: endOffers,
            suggestedOutboundId: null, suggestedReturnId: null,
            outboundFirstMile: transfer(0), outboundLastMile: transfer(1), returnFirstMile: transfer(2), returnLastMile: transfer(3),
            endIntent: brief.endIntent ?? undefined,
            endDestination: brief.endIntent === 'end_at_destination' ? hotel : endDestination,
            endDestinationAirport,
            assumptions: [
              'Flights were compared with train, bus and cab evidence using door-to-door journey time.',
              'Airport arrival buffers are planning assumptions: 120 minutes before each flight.',
              `${flightSearch.environment === 'sandbox' ? 'Sandbox' : 'Live'} fares expire and must be refreshed before selection or booking.`,
            ],
          };

          const stayTotal = hotel.stayOffer?.totalPrice;
          const stayCost = stayTotal && brief.budget && stayTotal.currency === brief.budget.currency ? stayTotal.amount : 0;
          const journeyCount = brief.endIntent === 'end_at_destination' ? 1 : 2;
          const perJourneyBudget = brief.budget ? { amount: Math.max(0, brief.budget.amount - stayCost) / journeyCount, currency: brief.budget.currency } : null;
          const outboundTransferMinutes = (transfer(0)?.minutes ?? 0) + (transfer(1)?.minutes ?? 0);
          const outboundRecommendation = selectJourneyRecommendation([
            ...outbound.map(option => routeCandidate(option, brief.travellers!)),
            ...outboundFlights.map(offer => flightCandidate(offer, brief.travellers!, outboundTransferMinutes)),
          ], perJourneyBudget);
          const returnTransferMinutes = (transfer(2)?.minutes ?? 0) + (transfer(3)?.minutes ?? 0);
          const returnRecommendation = brief.endIntent !== 'end_at_destination' ? selectJourneyRecommendation([
            ...returning.map(option => routeCandidate(option, brief.travellers!)),
            ...returnFlights.map(offer => flightCandidate(offer, brief.travellers!, returnTransferMinutes)),
          ], perJourneyBudget) : undefined;
          plan.travel.suggestedOutboundId = outboundRecommendation?.kind === 'route' ? outboundRecommendation.id : null;
          plan.travel.suggestedReturnId = returnRecommendation?.kind === 'route' ? returnRecommendation.id : null;
          plan.flight.suggestedOutboundId = outboundRecommendation?.kind === 'flight' ? outboundRecommendation.id : null;
          plan.flight.suggestedReturnId = returnRecommendation?.kind === 'flight' ? returnRecommendation.id : null;
          plan.travel.selectionReason = automaticTravelSelectionReason(brief, outboundRecommendation, returnRecommendation, Boolean(hotel.stayOffer?.totalPrice));
          if (transfers.some(result => result.status === 'rejected')) warnings.push('One or more airport transfer estimates failed; the affected flight comparison excludes that missing transfer time.');
        } catch (error) {
          const detail = error instanceof Error && error.message.trim() ? `: ${error.message.trim()}` : '';
          warnings.push(`Flight comparison was unavailable${detail}. The recommendation uses the train, bus and cab evidence that was returned.`);
        }
      }

      const selectedOutboundRoute = outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
      const selectedReturnRoute = returning.find(option => option.id === plan.travel?.suggestedReturnId);
      const outboundRoad = selectedOutboundRoute ? buildRoadJourneyPlan({ option: selectedOutboundRoute, date: brief.startDate!, tripDays: brief.days! }) : undefined;
      const provisionalEndRoad = selectedReturnRoute?.mode === 'drive' && selectedReturnRoute.roadUse
        ? buildRoadJourneyPlan({ option: selectedReturnRoute, date: addCalendarDays(returnDate, 1 - Math.ceil(selectedReturnRoute.minutes / (selectedReturnRoute.roadUse === 'self_drive' ? 480 : 600))), tripDays: brief.days! })
        : undefined;
      const assessed = assessRoadJourneyPair(outboundRoad, provisionalEndRoad, brief.days!);
      plan.travel.outboundRoadPlan = await attachTransitStays(assessed.outbound, selectedOutboundRoute, deps.provider, transitStaySupplier(deps, brief.travellers!));
      plan.travel.endRoadPlan = await attachTransitStays(assessed.end, selectedReturnRoute, deps.provider, transitStaySupplier(deps, brief.travellers!));
      const unresolvedTransitNights = [plan.travel.outboundRoadPlan, plan.travel.endRoadPlan].flatMap(road => road?.segments.filter(segment => segment.overnightRestMinutes && !segment.transitStay) ?? []).length;
      if (unresolvedTransitNights) warnings.push(`${unresolvedTransitNights} road-journey overnight rest stop${unresolvedTransitNights === 1 ? '' : 's'} still need a dated stay and availability check.`);
      if (assessed.status === 'not_feasible' && (assessed.outbound || assessed.end)) {
        plan.travel.suggestedOutboundId = assessed.outbound ? null : plan.travel.suggestedOutboundId;
        plan.travel.suggestedReturnId = assessed.end ? null : plan.travel.suggestedReturnId;
        warnings.push(`${assessed.outbound?.message ?? assessed.end?.message} Extend the dates, choose a faster mode, or plan this explicitly as a road trip.`);
      } else if (assessed.status === 'road_trip') {
        warnings.push(`${assessed.outbound?.message ?? assessed.end?.message} Confirm that you want the journey itself to be the main part of the trip.`);
      }
      if (!plan.travel.outbound.length) warnings.push('No outbound route was returned for the preferred mode. Arrival travel remains unresolved.');
      if (brief.endIntent !== 'end_at_destination' && endMode !== 'flight' && !plan.travel.return.length) warnings.push('No route was returned for the journey after the destination. Its timing remains unresolved.');
      if (endMode === 'flight' && destinationCity && destinationCity.utcOffsetMinutes !== undefined && endDestination.utcOffsetMinutes !== undefined) {
        const endFlightSearch = await deps.flightProvider!.search({ origin: { lat: destinationCity.lat, lng: destinationCity.lng, utcOffsetMinutes: destinationCity.utcOffsetMinutes }, destination: { lat: endDestination.lat, lng: endDestination.lng, utcOffsetMinutes: endDestination.utcOffsetMinutes }, departureDate: returnDate, returnDate: addCalendarDays(returnDate, 1), travellers: brief.travellers!, currency: 'INR', country: deps.guestNationality ?? 'IN' });
        const endFlight = selectRecommendedFlight(endFlightSearch.outbound, 'outbound');
        const destinationAirport = flightHubToLivePlace(endFlightSearch.originHub, destinationCity.utcOffsetMinutes, endFlightSearch.checkedAt);
        const endDestinationAirport = flightHubToLivePlace(endFlightSearch.destinationHub, endDestination.utcOffsetMinutes, endFlightSearch.checkedAt);
        const [firstMile, lastMile] = await Promise.all([
          endFlight ? deps.provider.travelRoutes(hotel, destinationAirport, { direction: 'return', mode: 'drive', departureTime: minutesBefore(endFlight.departureAt, 180) }).then(options => options.sort((a, b) => a.minutes - b.minutes)[0]) : undefined,
          endFlight ? deps.provider.travelRoutes(endDestinationAirport, endDestination, { direction: 'return', mode: 'drive', departureTime: endFlight.arrivalAt }).then(options => options.sort((a, b) => a.minutes - b.minutes)[0]) : undefined,
        ]);
        plan.flight = { origin, destination: hotel, originAirport: endDestinationAirport, destinationAirport, outbound: [], return: endFlightSearch.outbound, suggestedOutboundId: null, suggestedReturnId: endFlight?.id ?? null, returnFirstMile: firstMile, returnLastMile: lastMile, endIntent: brief.endIntent ?? undefined, endDestination, endDestinationAirport, assumptions: ['The flight after the destination is searched independently from the outward journey.', 'Airport arrival buffers are planning assumptions: 120 minutes before the flight.'] };
        warnings.push(...endFlightSearch.warnings.map(value => `Journey-after flight search: ${value}`));
        if (!endFlight) warnings.push('No direct flight was returned for the journey after the destination. Its timing remains unresolved.');
      }
      if ([...outboundResults, ...endResults].some(result => result.status === 'rejected')) warnings.push('One or more route searches failed. Available route evidence is shown without filling the gaps.');
      if (origin.utcOffsetMinutes === undefined || hotel.utcOffsetMinutes === undefined) warnings.push('A route search time-zone offset was unavailable, so the affected 08:00 or 17:00 search time used UTC and needs review.');
      }
    }
  } catch (error) {
    const detail = error instanceof Error && error.message.trim() ? `: ${error.message.trim()}` : '';
    warnings.push(brief.travelMode === 'flight'
      ? `Flight search failed${detail}. No flight offer was added; outbound and return timing remain unresolved.`
      : `Travel route comparison failed${detail}. The affected intercity journey timing remains unresolved.`);
    if (brief.travelMode === 'flight' && resolvedRouteOrigin) {
      plan.travel = await flightFallbackRoutes(deps.provider, resolvedRouteOrigin, hotel, brief.startDate!, plan.days.at(-1)!.date, warnings);
    }
  }
  const infeasibleRoad = plan.travel?.outboundRoadPlan?.status === 'not_feasible' ? plan.travel.outboundRoadPlan : plan.travel?.endRoadPlan?.status === 'not_feasible' ? plan.travel.endRoadPlan : undefined;
  if (infeasibleRoad) {
    plan.selectedHotelId = null;
    plan.days.forEach(day => { day.visits = []; day.meals = []; day.legs = []; day.availableStartMinutes = null; day.availableEndMinutes = null; });
    const combinedRoadDays = brief.days! - infeasibleRoad.destinationDaysRemaining;
    const message = brief.travelMode === 'recommend'
      ? `I couldn’t find a practical recommended journey within these dates. The available ${infeasibleRoad.roadUse === 'cab' ? 'cab route' : 'self-drive route'} safely needs about ${combinedRoadDays} travel days, leaving no usable day at ${brief.destination}, and no usable faster option was returned. Choose flight, train or bus to search that mode directly, or extend the trip if the road journey is intentional.`
      : `${infeasibleRoad.message} These dates do not leave enough time for a destination itinerary. Extend the trip, choose a faster mode, or tell me you want to plan it mainly as a road trip.`;
    plan.generationIssue = roadGenerationIssue(plan, 'road_infeasible', message, infeasibleRoad);
    return { kind: 'live', brief, plan, message };
  }
  const unconfirmedRoadTrip = plan.travel?.outboundRoadPlan?.status === 'road_trip' ? plan.travel.outboundRoadPlan : plan.travel?.endRoadPlan?.status === 'road_trip' ? plan.travel.endRoadPlan : undefined;
  if (unconfirmedRoadTrip && !brief.roadTripConfirmed) {
    plan.selectedHotelId = null;
    plan.days.forEach(day => { day.visits = []; day.meals = []; day.legs = []; day.availableStartMinutes = null; day.availableEndMinutes = null; });
    const message = `${unconfirmedRoadTrip.message} Confirm that you want the journey itself to be a main part of the trip, or choose a faster travel mode to preserve more time at ${brief.destination}.`;
    plan.generationIssue = roadGenerationIssue(plan, 'road_confirmation', message, unconfirmedRoadTrip);
    return { kind: 'live', brief, plan, message };
  }
  await refreshDestinationStayForRoadDates(plan, hotel, deps, warnings);
  emit('Checking opening hours, transfers and meal timing…');
  const bounds = plan.days.map((_, index): DayBounds => ({ startMinutes: plannerDayStart(plan, index), endMinutes: plannerDayEnd(plan, index), travelOnly: isRoadTravelOnlyDay(plan, index) }));
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
  const roadFinding = roadJourneyConstraint(plan);
  if (roadFinding) plan.scheduling!.findings.push(roadFinding);
  const blocking = plan.scheduling!.findings.filter(finding => finding.severity === 'blocking');
  const unresolved = plan.scheduling!.findings.filter(finding => finding.severity === 'unresolved');
  if (blocking.length) warnings.push(`${blocking.length} schedule constraint${blocking.length === 1 ? '' : 's'} need changes before this itinerary can be relied on.`);
  if (unresolved.length) warnings.push(`${unresolved.length} schedule connection${unresolved.length === 1 ? '' : 's'} remain unresolved.`);
  deps.signal.throwIfAborted();
  const activityCount = plan.days.reduce((total, day) => total + day.visits.length, 0);
  if (!activityCount) {
    const message = `I found options in ${brief.destination}, but none could be scheduled reliably within these dates. Try different dates, broaden your interests, or choose another destination.`;
    plan.generationIssue = { code: 'schedule_empty', message, retryable: false, cause: 'The available activities could not fit their opening hours and the time available on your destination days.' };
    return { kind: 'live', brief, plan, message };
  }
  if (blocking.length) {
    const cause = blocking.map(finding => finding.message).join(' ');
    const affectedRoad = [plan.travel?.outboundRoadPlan, plan.travel?.endRoadPlan]
      .find(road => road && road.travelDays > 1);
    const minimumTripDays = affectedRoad ? minimumPracticalTripDays(plan) : brief.days! < LIVE_TRIP_MAX_DAYS ? brief.days! + 1 : undefined;
    const adjustment = affectedRoad
      ? `${affectedRoad.direction === 'outbound' ? 'The outward' : 'The journey after the destination'} trip uses ${affectedRoad.travelDays} safe travel days. ${minimumTripDays ? `Use a faster mode or extend the trip to at least ${minimumTripDays} calendar days.` : `The trip is already at the ${LIVE_TRIP_MAX_DAYS}-day planning limit, so use a faster mode.`}`
      : `${minimumTripDays ? `Add at least one day or ` : ''}let me choose a different day-by-day arrangement.`;
    const message = `I couldn’t validate this itinerary because ${cause} ${adjustment}`;
    plan.generationIssue = affectedRoad
      ? roadGenerationIssue(plan, 'blocking_constraints', message, affectedRoad, cause)
      : { code: 'blocking_constraints', message, cause, retryable: false, minimumTripDays };
    return { kind: 'live', brief, plan, message };
  }
  plan.generationStatus = 'valid';
  delete plan.generationIssue;
  return { kind: 'live', brief, plan, message: planCompletionMessage(plan, hotel) };
}

function deterministicPlaceSelection(brief: LiveBrief, hotels: LivePlace[], activities: LivePlace[]): z.infer<typeof selectionSchema> {
  const days = brief.days ?? LIVE_TRIP_MIN_DAYS;
  const interiorDays = Math.max(1, days - 2);
  const capacity = (days <= 2 ? days : interiorDays) * 4;
  return {
    hotelId: hotels[0]!.id,
    visits: activities.slice(0, capacity).map((activity, index) => ({
      placeId: activity.id,
      day: days <= 2 ? index % days + 1 : index % interiorDays + 2,
      durationMinutes: 90,
    })),
  };
}

function validatePlaceSelection(selection: z.infer<typeof selectionSchema>, brief: LiveBrief, hotels: LivePlace[], activities: LivePlace[]) {
  const hotel = hotels.find(candidate => candidate.id === selection.hotelId);
  if (!hotel || !selection.visits.length) return undefined;
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  const valid = selection.visits.every(visit => {
    const count = (counts.get(visit.day) ?? 0) + 1;
    counts.set(visit.day, count);
    if (visit.day > brief.days! || count > 4 || seen.has(visit.placeId) || !activities.some(activity => activity.id === visit.placeId)) return false;
    seen.add(visit.placeId);
    return true;
  });
  return valid ? hotel : undefined;
}

function partialPlanMessage(plan: LivePlan, retryable: boolean, failedSearch?: unknown) {
  const activityRetried = failedSearch instanceof ActivityDiscoveryError;
  if (!plan.hotels.length && !plan.activityOptions?.length) return retryable
    ? `The live searches for ${plan.brief.destination} did not finish, so I don’t have enough verified stays and activities to build the trip. You can retry those searches without changing the Trip Brief.`
    : `The searches completed, but I couldn’t find enough usable stays and activities in ${plan.brief.destination} for these dates. Try dates with more availability or choose another destination.`;
  if (!plan.hotels.length) return retryable
    ? `I found activities in ${plan.brief.destination}, but the stay search did not finish. Retry the stay search before changing the trip.`
    : `I found activities in ${plan.brief.destination}, but no usable stay for these dates. Try dates with more availability or choose another destination.`;
  return retryable
    ? `I found places to stay in ${plan.brief.destination}, but the activity lookup did not finish${activityRetried ? ' after two attempts' : ''}.${failedSearch instanceof ActivityDiscoveryError ? ` ${failedSearch.userExplanation}` : ''} Retry the activity search before changing the trip.`
    : `I found places to stay in ${plan.brief.destination}, but not enough suitable activities for a useful day-by-day plan. Broaden the activity mix, add a day, or choose another destination.`;
}

function roadGenerationIssue(plan: LivePlan, code: 'road_infeasible' | 'road_confirmation' | 'blocking_constraints', message: string, road: LiveRoadJourneyPlan, cause = road.message): LiveGenerationIssue {
  return {
    code,
    message,
    cause,
    retryable: false,
    journey: road.direction,
    minimumTripDays: code === 'road_confirmation' ? undefined : minimumPracticalTripDays(plan),
    suggestedTravelModes: ['flight', 'train', 'bus', 'recommend'],
  };
}

function minimumPracticalTripDays(plan: LivePlan) {
  const roadDays = (plan.travel?.outboundRoadPlan?.travelDays ?? 0) + (plan.travel?.endRoadPlan?.travelDays ?? 0);
  if (!roadDays) return undefined;
  const minimum = roadDays + 3;
  return minimum <= LIVE_TRIP_MAX_DAYS ? minimum : undefined;
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
    destinationActivityMessage(plan),
    `I’m using ${hotel.name} as your base so the daily routes stay practical. I scheduled ${activityCount} activit${activityCount === 1 ? 'y' : 'ies'} at a ${pace} pace and kept the arrival and departure days lighter when travel reduces the time available.`,
    mealDecisionMessage(restaurantMeals.length, corridorMeals, plan.brief.dietaryPreference),
    travelDecisionMessage(plan),
    budgetDecisionMessage(plan, hotel),
    issueCount
      ? `There ${issueCount === 1 ? 'is' : 'are'} still ${issueCount} timing or connection ${issueCount === 1 ? 'detail' : 'details'} to review. I’ve marked them beside the affected items instead of guessing.`
      : 'The days fit together comfortably. Check the latest prices and availability before booking.',
    plan.eveningPrompt,
  ].filter((value): value is string => Boolean(value));
  return paragraphs.join('\n\n');
}

function destinationActivityMessage(plan: LivePlan) {
  const activities = [...new Map(plan.days.flatMap(day => day.visits).map(visit => [visit.place.id, visit.place])).values()];
  if (!activities.length) return `I kept the days open because there weren’t enough suitable activities in ${plan.brief.destination}.`;
  const themes = [...new Set(activities.flatMap(activityThemes))].slice(0, 3);
  const themeText = themes.length ? ` The mix leans into ${naturalList(themes)}.` : '';
  const featured = activities.slice(0, 4).map(place => place.name);
  const remaining = activities.length - featured.length;
  const described = activities.find(place => place.editorialSummary);
  const detail = described?.editorialSummary ? ` ${described.name}: ${sentenceExcerpt(described.editorialSummary)}` : '';
  return `The selected activities give you a feel for ${plan.brief.destination} rather than repeating the same kind of stop.${themeText} Highlights include ${naturalList(featured)}${remaining > 0 ? `, with ${remaining} more across the trip` : ''}.${detail}`;
}

function activityThemes(place: LivePlace) {
  const text = `${place.name} ${place.editorialSummary ?? ''}`.toLowerCase();
  return [
    /\b(fort|palace|heritage|historic|monument|temple|architecture)\b/.test(text) ? 'historic landmarks' : '',
    /\b(lake|beach|river|waterfront|boat|coast)\b/.test(text) ? 'waterside scenery' : '',
    /\b(museum|gallery|cultural|culture|art|theatre|theater)\b/.test(text) ? 'arts and culture' : '',
    /\b(market|bazaar|neighbou?rhood|old city|street)\b/.test(text) ? 'local markets' : '',
    /\b(park|garden|viewpoint|hill|wildlife|zoo|trek|trail)\b/.test(text) ? 'outdoor places' : '',
    /\b(bar|pub|club|nightlife|live music|concert|show)\b/.test(text) ? 'evening experiences' : '',
  ].filter(Boolean);
}

function naturalList(values: string[]) {
  if (values.length < 2) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function sentenceExcerpt(value: string) {
  const sentence = value.trim().split(/(?<=[.!?])\s/, 1)[0];
  const excerpt = sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
  return excerpt.endsWith('.') || excerpt.endsWith('!') || excerpt.endsWith('?') || excerpt.endsWith('…') ? excerpt : `${excerpt}.`;
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
    return `For travel, I chose ${choices.join(' and ')} to preserve useful time on your first and last days. The timeline includes airport transfers and check-in time.`;
  }
  if (plan.brief.travelMode === 'flight' && plan.travel?.context === 'flight_fallback') return 'I couldn’t find a usable flight for one or both journeys, so I left train, bus, cab and self-drive routes available for comparison without choosing one for you.';
  if (plan.travel) return `For travel, ${plan.travel.selectionReason} This leaves the time shown on your first and last days.`;
  return 'I kept the first and last days light until your arrival and departure times are known.';
}

function budgetDecisionMessage(plan: LivePlan, hotel: LivePlace) {
  if (!plan.brief.budget) return 'Because you didn’t set a budget, I prioritized the strongest available experience and usable time. You can still replace the stay, travel or activities with alternatives.';
  let known = hotel.stayOffer?.totalPrice?.currency === plan.brief.budget.currency ? hotel.stayOffer.totalPrice.amount : 0;
  const outboundFlight = plan.flight?.outbound.find(option => option.id === plan.flight?.suggestedOutboundId);
  const returnFlight = plan.flight?.return.find(option => option.id === plan.flight?.suggestedReturnId);
  for (const offer of [outboundFlight, returnFlight]) if (offer?.price.currency === plan.brief.budget.currency) known += offer.price.amount * (plan.brief.travellers ?? 1);
  const outboundRoute = plan.travel?.outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
  const returnRoute = plan.travel?.return.find(option => option.id === plan.travel?.suggestedReturnId);
  for (const option of [outboundRoute, returnRoute]) if (option?.fare?.currency === plan.brief.budget.currency) known += option.fare.amount * (plan.brief.travellers ?? 1);
  if (!known) return `I used your ₹${plan.brief.budget.amount.toLocaleString('en-IN')} total budget when comparing options, but the selected items do not have enough verified price evidence to calculate a reliable running total.`;
  const unknown = !hotel.stayOffer?.totalPrice || [outboundFlight, returnFlight, outboundRoute, returnRoute].some(option => option && !('price' in option ? option.price : option.fare));
  return `The selected items with comparable prices currently account for ₹${known.toLocaleString('en-IN')} of your ₹${plan.brief.budget.amount.toLocaleString('en-IN')} total budget.${unknown ? ' Meals, activities and any unpriced travel are not included, so this remains a provisional budget check.' : ' Meals and activities without verified prices are still outside this total.'}`;
}

function flightName(offer: import('@/inventory/contracts').TransportOffer) {
  const number = offer.segments[0]?.number;
  return `${offer.operator}${number ? ` ${number}` : ''}`;
}

function recommendedRouteComparator(brief: z.infer<typeof liveBriefSchema>, requestedMode: NonNullable<z.infer<typeof liveBriefSchema>['travelMode']> = brief.travelMode!) {
  return (left: LiveTravelOption, right: LiveTravelOption) => routeRecommendationScore(left, brief, requestedMode) - routeRecommendationScore(right, brief, requestedMode);
}

function routeRecommendationScore(option: LiveTravelOption, brief: z.infer<typeof liveBriefSchema>, requestedMode: NonNullable<z.infer<typeof liveBriefSchema>['travelMode']>) {
  if (requestedMode !== 'recommend') return option.minutes;
  if (option.mode === 'drive' && option.roadUse) {
    const dailyLimit = option.roadUse === 'self_drive' ? 480 : 600;
    if (Math.ceil(option.minutes / dailyLimit) >= (brief.days ?? 2)) return Number.MAX_SAFE_INTEGER;
  }
  const preferenceText = `${brief.preferences} ${brief.constraints.join(' ')}`.toLowerCase();
  const budgetConscious = Boolean(brief.budget) || /budget|afford|econom|low[ -]?cost|save money/.test(preferenceText);
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
    brief.budget ? `₹${brief.budget.amount.toLocaleString('en-IN')} total budget` : /budget|afford|econom|low[ -]?cost|save money/.test(preferenceText) ? 'budget preference' : '',
    /comfort|convenien|accessib|senior|young child|toddler/.test(preferenceText) ? 'comfort or accessibility preference' : '',
  ].filter(Boolean);
  return `I compared journey time and what is practical for ${brief.travellers} traveller${brief.travellers === 1 ? '' : 's'}${signals.length ? `, including your ${signals.join(' and ')}` : ''}.${hasFare ? ' Any returned transit fare stays visible for comparison.' : ' There wasn’t a comparable fare, so price was not treated as known.'}`;
}

function automaticTravelSelectionReason(brief: LiveBrief, outbound: JourneyRecommendation | undefined, returning: JourneyRecommendation | undefined, stayPriceKnown: boolean) {
  const selected = [outbound, returning].filter((value): value is JourneyRecommendation => Boolean(value));
  if (!brief.budget) return 'I compared the available flight, train, bus and cab evidence and chose the option that preserves the most usable trip time. Price was used only as a tie-breaker when it was available.';
  const withinBudget = selected.length > 0 && selected.every(option => option.budgetStatus === 'within_known_budget');
  const unknownCost = selected.some(option => option.budgetStatus === 'cost_unknown') || !stayPriceKnown;
  if (withinBudget && !unknownCost) return `I compared the priced travel choices with the selected stay against your ₹${brief.budget.amount.toLocaleString('en-IN')} total budget, then chose the fastest options within the available planning allowance.`;
  if (unknownCost) return `I used your ₹${brief.budget.amount.toLocaleString('en-IN')} total budget wherever comparable prices were available. Some selected or alternative costs are still unknown, so the budget fit remains provisional.`;
  return `The returned priced choices exceed the current planning allowance within your ₹${brief.budget.amount.toLocaleString('en-IN')} total budget, so I chose the lowest known-cost travel option and kept the shortfall visible.`;
}

function travelModeDescription(mode: NonNullable<z.infer<typeof liveBriefSchema>['travelMode']>) {
  if (mode === 'self_drive') return 'self-drive';
  if (mode === 'cab') return 'private-cab';
  if (mode === 'train') return 'train';
  if (mode === 'bus') return 'bus';
  if (mode === 'recommend') return 'flight, train, bus and cab comparison';
  return 'public-transit';
}

function dedupeTravelOptions(options: LiveTravelOption[]) {
  const unique = new Map<string, LiveTravelOption>();
  for (const option of options) {
    const key = `${option.direction}:${option.mode}:${option.roadUse ?? ''}:${option.id}:${option.transitModes.join(',')}`;
    if (!unique.has(key)) unique.set(key, option);
  }
  return [...unique.values()];
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
  if (places.length) return mergePlaces([], places);
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (!failures.length) return [];

  const fallbackQueries = [
    `tourist top attractions things to do in ${brief.destination}`,
    `tourist family friendly sights and experiences in ${brief.destination}`,
  ];
  const fallbackResults = await Promise.allSettled(fallbackQueries.map(query => provider.search(query, 4)));
  const fallbackPlaces = fallbackResults.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (fallbackPlaces.length) return mergePlaces([], fallbackPlaces);
  const fallbackFailures = fallbackResults.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (fallbackFailures.length) throw new ActivityDiscoveryError([...failures, ...fallbackFailures]);
  return [];
}

class ActivityDiscoveryError extends Error {
  readonly userExplanation: string;

  constructor(errors: unknown[]) {
    const reasons = [...new Set(errors.map(error => error instanceof Error && error.message.trim() ? error.message.trim() : 'Unknown lookup failure'))];
    super(`Activity discovery failed after two attempts: ${reasons.join('; ')}`);
    this.name = 'ActivityDiscoveryError';
    const combined = reasons.join(' ');
    this.userExplanation = /timeout|timed out|aborted due to timeout/i.test(combined)
      ? 'Both attempts exceeded the activity lookup time limit.'
      : /failed \((?:401|403)\)|blocked|API key|restriction/i.test(combined)
        ? 'The configured activity data service rejected both attempts.'
        : 'The activity data service failed both attempts.';
  }
}

function searchFailureCause(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
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
    if (isRoadTravelOnlyDay(plan, dayIndex)) {
      day.meals = [];
      continue;
    }
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
  const road = plan.travel?.outboundRoadPlan;
  if (road) {
    if (dayIndex < road.travelDays - 1) return null;
    if (dayIndex === road.travelDays - 1) return road.segments.at(-1)!.arrivalMinutes + 30;
  }
  if (dayIndex > 0) return 480;
  const outboundFlight = plan.flight?.outbound.find(offer => offer.id === plan.flight?.suggestedOutboundId);
  if (outboundFlight && plan.flight?.destinationAirport.utcOffsetMinutes !== undefined && plan.flight.outboundLastMile) {
    const arrival = localClockMinutes(outboundFlight.arrivalAt, plan.flight.destinationAirport.utcOffsetMinutes, plan.days[0].date);
    return arrival === null ? null : arrival + plan.flight.outboundLastMile.minutes + 30;
  }
  const outbound = plan.travel?.outbound.find(option => option.id === plan.travel?.suggestedOutboundId);
  if (outbound) {
    const arrival = localClockMinutes(travelOptionInstant(outbound, 'arrival'), plan.travel?.destination.utcOffsetMinutes, plan.days[0].date);
    return arrival === null ? null : arrival + 30;
  }
  return null;
}

export function plannerDayEnd(plan: LivePlan, dayIndex: number) {
  const endRoad = plan.travel?.endRoadPlan;
  if (endRoad) {
    const firstTravelDay = plan.days.length - endRoad.travelDays;
    if (dayIndex >= firstTravelDay) return dayIndex === firstTravelDay ? endRoad.segments[0].departureMinutes : null;
  }
  if (dayIndex < plan.days.length - 1) return 22 * 60;
  const returnFlight = plan.flight?.return.find(offer => offer.id === plan.flight?.suggestedReturnId);
  if (returnFlight && plan.flight?.destinationAirport.utcOffsetMinutes !== undefined && plan.flight.returnFirstMile) {
    const departure = localClockMinutes(returnFlight.departureAt, plan.flight.destinationAirport.utcOffsetMinutes, plan.days[dayIndex].date);
    return departure === null ? null : departure - plan.flight.returnFirstMile.minutes - 120;
  }
  const returning = plan.travel?.return.find(option => option.id === plan.travel?.suggestedReturnId);
  if (returning) {
    const departure = localClockMinutes(travelOptionInstant(returning, 'departure'), plan.travel?.destination.utcOffsetMinutes, plan.days[dayIndex].date);
    return departure ?? 17 * 60;
  }
  return plan.brief.endIntent === 'end_at_destination' ? 22 * 60 : null;
}

export function roadJourneyConstraint(plan: LivePlan) {
  const road = [plan.travel?.outboundRoadPlan, plan.travel?.endRoadPlan].find(candidate => candidate && candidate.status !== 'feasible');
  if (!road) return undefined;
  return {
    id: 'road-journey-feasibility',
    severity: road.status === 'not_feasible' ? 'blocking' as const : 'warning' as const,
    dayIndex: road.direction === 'outbound' ? 0 : Math.max(0, plan.days.length - road.travelDays),
    message: road.message,
    overridable: road.status === 'road_trip',
  };
}

function isRoadTravelOnlyDay(plan: LivePlan, dayIndex: number) {
  const outboundDays = plan.travel?.outboundRoadPlan?.travelDays ?? 0;
  const endDays = plan.travel?.endRoadPlan?.travelDays ?? 0;
  const outboundOnly = outboundDays > 1 && dayIndex < outboundDays - 1;
  const firstEndDay = plan.days.length - endDays;
  const endOnly = endDays > 0 && dayIndex >= firstEndDay;
  return outboundOnly || endOnly;
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

function transitStaySupplier(deps: { stayProvider?: StayProvider; guestNationality?: string }, travellers: number) {
  return deps.stayProvider ? { provider: deps.stayProvider, travellers, guestNationality: deps.guestNationality ?? 'IN' } : undefined;
}

export async function refreshDestinationStayForRoadDates(
  plan: LivePlan,
  hotel: LivePlace,
  deps: { stayProvider?: StayProvider; guestNationality?: string },
  warnings: string[],
) {
  if (!deps.stayProvider || !plan.brief.startDate || !plan.brief.travellers) return;
  const arrivalDate = plan.travel?.outboundRoadPlan?.segments.at(-1)?.date ?? plan.brief.startDate;
  const checkoutDate = plan.travel?.endRoadPlan?.segments[0]?.date ?? plan.days.at(-1)!.date;
  if (arrivalDate === plan.brief.startDate && checkoutDate === plan.days.at(-1)!.date) return;
  if (arrivalDate >= checkoutDate) return;
  try {
    const result = await deps.stayProvider.search({
      destination: hotel.address || hotel.name,
      checkIn: arrivalDate,
      checkOut: checkoutDate,
      travellers: plan.brief.travellers,
      currency: 'INR',
      guestNationality: deps.guestNationality ?? 'IN',
      limit: 8,
    });
    const sameProperty = result.offers.find(offer => offer.propertyId === hotel.id);
    if (!sameProperty) {
      delete hotel.stayOffer;
      warnings.push(`The destination stay was not returned when rechecked for the road-adjusted dates ${arrivalDate} to ${checkoutDate}. Keep the stay unresolved or choose another hotel before relying on it.`);
      return;
    }
    const refreshed = stayOfferToLivePlace(sameProperty);
    refreshed.utcOffsetMinutes = hotel.utcOffsetMinutes;
    Object.assign(hotel, refreshed);
    const hotelIndex = plan.hotels.findIndex(candidate => candidate.id === hotel.id);
    if (hotelIndex >= 0) plan.hotels[hotelIndex] = hotel;
    warnings.push(`The destination stay was rechecked for the actual road-adjusted occupancy dates ${arrivalDate} to ${checkoutDate}.`);
  } catch {
    delete hotel.stayOffer;
    warnings.push(`The destination stay could not be rechecked for the road-adjusted dates ${arrivalDate} to ${checkoutDate}; its price and availability remain unresolved.`);
  }
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
