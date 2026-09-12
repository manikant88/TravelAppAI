import { addCalendarDays } from '@/domain/dates';
import type { LivePlace, LiveRoadJourneyPlan, LiveTravelOption } from './contracts';
import type { LiveProvider } from './google.server';
import type { StayProvider } from '@/inventory/providers/stay-provider';
import type { StayOffer } from '@/inventory/contracts';

const DAY_START_MINUTES = 8 * 60;
const OVERNIGHT_REST_MINUTES = 12 * 60;

export function buildRoadJourneyPlan(input: {
  option: LiveTravelOption;
  date: string;
  tripDays: number;
}): LiveRoadJourneyPlan | undefined {
  const { option, date, tripDays } = input;
  if (option.mode !== 'drive' || !option.roadUse) return undefined;
  const dailyDriveLimit = option.roadUse === 'self_drive' ? 8 * 60 : 10 * 60;
  const travelDays = Math.max(1, Math.ceil(option.minutes / dailyDriveLimit));
  let remaining = option.minutes;
  const segments = Array.from({ length: travelDays }, (_, dayOffset) => {
    const driveMinutes = Math.min(dailyDriveLimit, remaining);
    remaining -= driveMinutes;
    const breakStops = roadBreakStops(driveMinutes);
    const mealBreaks = breakStops.filter(stop => stop.type !== 'rest').map(stop => stop.type as 'lunch' | 'dinner');
    const breakMinutes = breakStops.reduce((total, stop) => total + stop.durationMinutes, 0);
    const overnightRestMinutes = dayOffset < travelDays - 1 ? OVERNIGHT_REST_MINUTES : 0;
    return {
      dayOffset,
      date: addCalendarDays(date, dayOffset),
      driveMinutes,
      breakMinutes,
      mealBreaks,
      departureMinutes: DAY_START_MINUTES,
      arrivalMinutes: DAY_START_MINUTES + driveMinutes + breakMinutes,
      overnightRestMinutes,
      breakStops,
    };
  });
  const destinationDaysRemaining = tripDays - travelDays;
  const status = destinationDaysRemaining <= 0 ? 'not_feasible' : travelDays >= destinationDaysRemaining ? 'road_trip' : 'feasible';
  const plannedMinutes = segments.reduce((total, segment) => total + segment.driveMinutes + segment.breakMinutes + segment.overnightRestMinutes, 0);
  return {
    direction: option.direction,
    roadUse: option.roadUse,
    status,
    rawDriveMinutes: option.minutes,
    plannedMinutes,
    travelDays,
    destinationDaysRemaining,
    segments,
    message: roadPlanMessage(option.roadUse, status, travelDays, destinationDaysRemaining),
  };
}

function roadBreakStops(driveMinutes: number): LiveRoadJourneyPlan['segments'][number]['breakStops'] {
  const stops: LiveRoadJourneyPlan['segments'][number]['breakStops'] = [];
  let drivingRemaining = driveMinutes;
  let clock = DAY_START_MINUTES;
  let drivingSinceBreak = 0;
  let lunchPending = driveMinutes > 300;
  while (drivingRemaining > 0) {
    if (lunchPending && clock >= 13 * 60) {
      stops.push({ type: 'lunch', startMinutes: clock, durationMinutes: 45 });
      lunchPending = false;
      drivingSinceBreak = 0;
      clock += 45;
      continue;
    }
    const untilRest = 150 - drivingSinceBreak;
    const untilLunch = lunchPending ? Math.max(0, 13 * 60 - clock) : Number.POSITIVE_INFINITY;
    const drivingBlock = Math.min(drivingRemaining, untilRest, untilLunch);
    drivingRemaining -= drivingBlock;
    drivingSinceBreak += drivingBlock;
    clock += drivingBlock;
    if (!drivingRemaining) break;
    if (lunchPending && clock >= 13 * 60) {
      stops.push({ type: 'lunch', startMinutes: clock, durationMinutes: 45 });
      lunchPending = false;
      drivingSinceBreak = 0;
      clock += 45;
    } else if (drivingSinceBreak >= 150) {
      stops.push({ type: 'rest', startMinutes: clock, durationMinutes: 20 });
      drivingSinceBreak = 0;
      clock += 20;
    }
  }
  return stops;
}

export function assessRoadJourneyPair(outbound: LiveRoadJourneyPlan | undefined, end: LiveRoadJourneyPlan | undefined, tripDays: number) {
  const roadDays = (outbound?.travelDays ?? 0) + (end?.travelDays ?? 0);
  const destinationDaysRemaining = tripDays - roadDays;
  const status: LiveRoadJourneyPlan['status'] = destinationDaysRemaining <= 0 ? 'not_feasible' : roadDays >= destinationDaysRemaining ? 'road_trip' : 'feasible';
  const update = (plan: LiveRoadJourneyPlan | undefined): LiveRoadJourneyPlan | undefined => plan ? {
    ...plan,
    status,
    destinationDaysRemaining,
    message: roadPlanMessage(plan.roadUse, status, roadDays, destinationDaysRemaining),
  } : undefined;
  return { outbound: update(outbound), end: update(end), roadDays, destinationDaysRemaining, status };
}

export async function attachTransitStays(
  plan: LiveRoadJourneyPlan | undefined,
  option: LiveTravelOption | undefined,
  provider: LiveProvider,
  supplier?: { provider: StayProvider; travellers: number; guestNationality: string },
) {
  if (!plan || !option?.path.length || plan.travelDays < 2) return plan;
  let completedDrive = 0;
  const segments = [];
  for (const segment of plan.segments) {
    let segmentDrive = 0;
    let cursor = segment.departureMinutes;
    const breakStops = [];
    for (const stop of segment.breakStops) {
      segmentDrive += Math.max(0, stop.startMinutes - cursor);
      const point = routePoint(option.path, (completedDrive + segmentDrive) / plan.rawDriveMinutes);
      let place: LivePlace | undefined;
      if (stop.type !== 'rest') {
        try { [place] = await provider.search(`restaurants near ${point.lat},${point.lng}`, 1); }
        catch { /* Keep the planned route point when a meal venue cannot be verified. */ }
      }
      breakStops.push({ ...stop, routePoint: point, ...(place ? { place } : {}) });
      cursor = stop.startMinutes + stop.durationMinutes;
    }
    completedDrive += segment.driveMinutes;
    if (!segment.overnightRestMinutes) { segments.push({ ...segment, breakStops }); continue; }
    const point = routePoint(option.path, completedDrive / plan.rawDriveMinutes);
    try {
      const [placeCandidate] = await provider.search(`hotels near ${point.lat},${point.lng}`, 1, true);
      let transitStay = placeCandidate;
      if (placeCandidate && supplier) {
        try {
          const result = await supplier.provider.search({
            destination: placeCandidate.address || placeCandidate.name,
            checkIn: segment.date,
            checkOut: addCalendarDays(segment.date, 1),
            travellers: supplier.travellers,
            currency: 'INR',
            guestNationality: supplier.guestNationality,
            limit: 1,
          });
          const offer = result.offers[0];
          if (offer) transitStay = stayOfferToLivePlace(offer, placeCandidate.utcOffsetMinutes) ?? placeCandidate;
        } catch {
          // Retain the observed place as an overnight candidate with unverified availability.
        }
      }
      segments.push({ ...segment, breakStops, ...(transitStay ? { transitStay } : {}) });
    } catch {
      segments.push({ ...segment, breakStops });
    }
  }
  return { ...plan, segments };
}

function routePoint(path: { lat: number; lng: number }[], fraction: number) {
  return path[Math.min(path.length - 1, Math.max(0, Math.round((path.length - 1) * Math.min(1, Math.max(0, fraction)))))]!;
}

function stayOfferToLivePlace(offer: StayOffer, utcOffsetMinutes?: number): LivePlace | undefined {
  const facts = offer.propertyFacts;
  if (facts.latitude === undefined || facts.longitude === undefined) return undefined;
  const query = `${facts.latitude},${facts.longitude}`;
  return {
    id: offer.propertyId,
    name: facts.name,
    address: facts.address ?? '',
    lat: facts.latitude,
    lng: facts.longitude,
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
    utcOffsetMinutes,
  };
}

function roadPlanMessage(roadUse: 'self_drive' | 'cab', status: LiveRoadJourneyPlan['status'], travelDays: number, destinationDays: number) {
  const label = roadUse === 'self_drive' ? 'Self-driving' : 'Travelling by cab';
  if (status === 'not_feasible') return `${label} safely needs about ${travelDays} travel day${travelDays === 1 ? '' : 's'}, leaving no usable day at the destination within these dates.`;
  if (status === 'road_trip') return `${label} needs about ${travelDays} travel day${travelDays === 1 ? '' : 's'} with breaks and overnight rest, leaving about ${destinationDays} day${destinationDays === 1 ? '' : 's'} at the destination. This would be mainly a road trip.`;
  return `${label} is split across ${travelDays} day${travelDays === 1 ? '' : 's'} with meal and rest breaks; about ${destinationDays} destination day${destinationDays === 1 ? '' : 's'} remain.`;
}
