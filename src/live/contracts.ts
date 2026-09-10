import { z } from 'zod';
import { stayOfferSchema, transportOfferSchema, type StayOffer, type TransportOffer } from '@/inventory/contracts';

export const liveBriefSchema = z.object({
  origin: z.string().max(120).nullable(), destination: z.string().max(120).nullable(),
  startDate: z.string().date().nullable(), days: z.number().int().min(2).max(7).nullable(),
  travellers: z.number().int().min(1).max(12).nullable(),
  travelMode: z.enum(['self_drive', 'public_transit', 'flight', 'train', 'bus', 'cab', 'recommend']).nullable(),
  pickupLocation: z.string().max(240).nullable(),
  dietaryPreference: z.enum(['vegetarian', 'pure_vegetarian', 'non_vegetarian', 'both']).nullable(),
  dietaryNotes: z.string().max(500),
  dayRhythm: z.enum(['early_nights', 'evening_experiences', 'nightlife', 'overnight_adventure', 'flexible']).nullable(),
  pace: z.enum(['relaxed', 'balanced', 'packed']).nullable(),
  nightsConfirmed: z.boolean(), preferences: z.string().max(1000),
  constraints: z.array(z.string().max(200)).max(12),
}).strict();
export type LiveBrief = z.infer<typeof liveBriefSchema>;
export const emptyLiveBrief: LiveBrief = { origin: null, destination: null, startDate: null, days: null, travellers: null, travelMode: null, pickupLocation: null, dietaryPreference: null, dietaryNotes: '', dayRhythm: null, pace: null, nightsConfirmed: false, preferences: '', constraints: [] };
export const liveRequestSchema = z.object({
  phase: z.literal('live'), message: z.string().trim().min(1).max(1200),
  brief: liveBriefSchema,
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) }).strict()).max(12),
}).strict();
export type LiveRequest = z.infer<typeof liveRequestSchema>;
const attributionSchema = z.object({ name: z.string().min(1), url: z.string().url().optional() }).strict();
const livePlaceSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), address: z.string(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  source: z.enum(['Google Maps', 'Nuitée Connect']), checkedAt: z.string(), mapsUrl: z.string().url(),
  rating: z.number().optional(), reviewCount: z.number().int().nonnegative().optional(),
  photo: z.object({ url: z.string().url(), authors: z.array(attributionSchema) }).strict().optional(),
  priceLevel: z.string().optional(), priceGuidance: z.object({ currency: z.string().min(3), min: z.number().optional(), max: z.number().optional() }).strict().optional(),
  editorialSummary: z.string().optional(), amenities: z.array(z.string()).optional(), websiteUrl: z.string().url().optional(),
  mealInclusion: z.object({ type: z.enum(['lunch', 'dinner']), evidence: z.enum(['provider', 'manual']), sourceLabel: z.string().min(1), note: z.string().min(1) }).strict().optional(),
  airportCode: z.string().length(3).optional(), utcOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  regularHours: z.array(z.object({ open: z.object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict(), close: z.object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict().optional() }).strict()).optional(),
  openingHours: z.array(z.string()).optional(), attributions: z.array(attributionSchema), stayOffer: stayOfferSchema.optional(),
}).strict();
export type LivePlace = {
  id: string; name: string; address: string; lat: number; lng: number;
  source: 'Google Maps' | 'Nuitée Connect'; checkedAt: string; mapsUrl: string;
  rating?: number; reviewCount?: number;
  photo?: { url: string; authors: { name: string; url?: string }[] };
  priceLevel?: string;
  priceGuidance?: { currency: string; min?: number; max?: number };
  editorialSummary?: string;
  amenities?: string[];
  websiteUrl?: string;
  mealInclusion?: { type: 'lunch' | 'dinner'; evidence: 'provider' | 'manual'; sourceLabel: string; note: string };
  airportCode?: string;
  utcOffsetMinutes?: number;
  regularHours?: { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }[];
  openingHours?: string[]; attributions: { name: string; url?: string }[];
  stayOffer?: StayOffer;
};
type LiveLegBase = { fromId: string; toId: string; checkedAt: string };
export type LiveLeg =
  | (LiveLegBase & { minutes: number; meters: number | null; path: { lat: number; lng: number }[]; error?: never })
  | (LiveLegBase & { minutes: null; meters: null; path: []; error: string });
export type LiveTravelOption = {
  schemaVersion: 1;
  kind: 'route_evidence';
  id: string;
  providerRouteId: string | null;
  direction: 'outbound' | 'return';
  mode: 'drive' | 'transit';
  roadUse?: 'self_drive' | 'cab';
  label: string;
  minutes: number;
  meters: number | null;
  path: { lat: number; lng: number }[];
  departureAt?: string;
  arrivalAt?: string;
  transitModes: string[];
  transitLines: string[];
  fare?: { currency: string; amount: number };
  timingKind: 'scheduled' | 'estimated';
  checkedAt: string;
  source: 'Google Routes';
};
export type LiveTravel = {
  origin: LivePlace;
  destination: LivePlace;
  outbound: LiveTravelOption[];
  return: LiveTravelOption[];
  suggestedOutboundId: string | null;
  suggestedReturnId: string | null;
  selectionReason: string;
  assumptions: string[];
  context?: 'preferred' | 'flight_fallback';
};
export type LiveFlightJourney = {
  origin: LivePlace;
  destination: LivePlace;
  originAirport: LivePlace & { airportCode: string };
  destinationAirport: LivePlace & { airportCode: string };
  outbound: TransportOffer[];
  return: TransportOffer[];
  suggestedOutboundId: string | null;
  suggestedReturnId: string | null;
  outboundFirstMile?: LiveTravelOption;
  outboundLastMile?: LiveTravelOption;
  returnFirstMile?: LiveTravelOption;
  returnLastMile?: LiveTravelOption;
  assumptions: string[];
};
export type ScheduleValidation = {
  status: 'valid' | 'invalid' | 'unresolved';
  evidence: 'regular_hours';
  startsAtMinutes: number;
  endsAtMinutes: number;
  note: string;
};
export type MealRouteFit = {
  basis: 'route_corridor' | 'destination_fallback';
  fromId: string;
  toId: string;
  directMinutes: number | null;
  addedMinutes?: number;
};
export type DurationProfile = {
  kind: 'fixed' | 'provider_slot' | 'elastic' | 'pace_sensitive' | 'open_ended';
  minimumMinutes: number;
  preferredMinutes: number;
  maximumMinutes: number;
  groupSensitivity: 'none' | 'low' | 'medium' | 'high';
  evidence: 'provider' | 'manual' | 'planning_assumption';
  difficulty?: 'easy' | 'moderate' | 'hard' | 'unknown';
  daylightWindow?: { startMinutes: number; endMinutes: number; evidence: 'planning_assumption' };
};
export type ActivityTimingEvidence = {
  kind: 'fixed' | 'provider_slot';
  durationMinutes: number;
  startMinutes?: number;
  source: 'provider' | 'manual';
  label: string;
};
export type MealWindow = {
  preferredStartMinutes: number;
  preferredEndMinutes: number;
  earliestStartMinutes: number;
  latestStartMinutes: number;
};
export type ConstraintFinding = {
  id: string;
  severity: 'warning' | 'blocking' | 'unresolved';
  dayIndex: number;
  itemId?: string;
  message: string;
  overridable: boolean;
};
export type LiveVisit = {
  place: LivePlace;
  durationMinutes: number;
  durationProfile?: DurationProfile;
  timingKind?: 'fixed' | 'estimated';
  fixedStartMinutes?: number;
  timingEvidence?: ActivityTimingEvidence;
  sequenceOrder?: number;
  period?: 'morning' | 'afternoon' | 'evening';
  mealCoverage?: { type: 'lunch' | 'dinner'; evidence: 'provider' | 'manual' | 'place_description'; sourceLabel: string; note: string };
  hoursStatus?: 'open' | 'unknown';
  hoursNote?: string;
  scheduleValidation?: ScheduleValidation;
};
export type LiveMeal = { type: 'breakfast' | 'lunch' | 'dinner'; place: LivePlace; durationMinutes: number; targetStartMinutes: number; window?: MealWindow; shiftedByMinutes?: number; sequenceOrder?: number; location: 'stay' | 'restaurant'; dietaryNote: string; hoursStatus?: 'open' | 'unknown'; hoursNote?: string; scheduleValidation?: ScheduleValidation; routeFit?: MealRouteFit };
export type LiveDay = { date: string; visits: LiveVisit[]; meals?: LiveMeal[]; legs: LiveLeg[]; availableStartMinutes?: number | null; availableEndMinutes?: number | null; findings?: ConstraintFinding[]; capacityNote?: string };
export type LivePlan = {
  brief: LiveBrief; hotels: LivePlace[]; selectedHotelId: string | null;
  activityOptions?: LivePlace[]; mealOptions?: LivePlace[]; eveningOptions?: LivePlace[]; eveningPrompt?: string;
  days: LiveDay[]; travel?: LiveTravel; flight?: LiveFlightJourney; warnings: string[]; checkedAt: string;
  status: 'provisional'; totalCost: null;
  scheduling?: { pace: 'relaxed' | 'balanced' | 'packed'; paceDefaulted: boolean; findings: ConstraintFinding[] };
  locks?: { hotel: boolean; outboundFlight: boolean; returnFlight: boolean; outboundTravel?: boolean; returnTravel?: boolean; activityIds?: string[]; mealKeys?: string[] };
};
export type LiveResponse = { kind: 'live'; brief: LiveBrief; message: string; plan?: LivePlan };

const liveLegSchema = z.union([
  z.object({ fromId: z.string(), toId: z.string(), checkedAt: z.string(), minutes: z.number().int().nonnegative(), meters: z.number().nonnegative().nullable(), path: z.array(z.object({ lat: z.number(), lng: z.number() }).strict()) }).strict(),
  z.object({ fromId: z.string(), toId: z.string(), checkedAt: z.string(), minutes: z.null(), meters: z.null(), path: z.tuple([]), error: z.string().min(1) }).strict(),
]);
const liveTravelOptionSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('route_evidence'), id: z.string().min(1), providerRouteId: z.string().nullable(), direction: z.enum(['outbound', 'return']), mode: z.enum(['drive', 'transit']), roadUse: z.enum(['self_drive', 'cab']).optional(), label: z.string(), minutes: z.number().int().positive(), meters: z.number().nonnegative().nullable(), path: z.array(z.object({ lat: z.number(), lng: z.number() }).strict()), departureAt: z.string().optional(), arrivalAt: z.string().optional(), transitModes: z.array(z.string()), transitLines: z.array(z.string()), fare: z.object({ currency: z.string(), amount: z.number().nonnegative() }).strict().optional(), timingKind: z.enum(['scheduled', 'estimated']), checkedAt: z.string(), source: z.literal('Google Routes'),
}).strict();
const liveTravelSchema = z.object({ origin: livePlaceSchema, destination: livePlaceSchema, outbound: z.array(liveTravelOptionSchema), return: z.array(liveTravelOptionSchema), suggestedOutboundId: z.string().nullable(), suggestedReturnId: z.string().nullable(), selectionReason: z.string(), assumptions: z.array(z.string()), context: z.enum(['preferred', 'flight_fallback']).optional() }).strict();
const airportPlaceSchema = livePlaceSchema.extend({ airportCode: z.string().length(3) });
const liveFlightJourneySchema = z.object({ origin: livePlaceSchema, destination: livePlaceSchema, originAirport: airportPlaceSchema, destinationAirport: airportPlaceSchema, outbound: z.array(transportOfferSchema), return: z.array(transportOfferSchema), suggestedOutboundId: z.string().nullable(), suggestedReturnId: z.string().nullable(), outboundFirstMile: liveTravelOptionSchema.optional(), outboundLastMile: liveTravelOptionSchema.optional(), returnFirstMile: liveTravelOptionSchema.optional(), returnLastMile: liveTravelOptionSchema.optional(), assumptions: z.array(z.string()) }).strict();
const scheduleValidationSchema = z.object({ status: z.enum(['valid', 'invalid', 'unresolved']), evidence: z.literal('regular_hours'), startsAtMinutes: z.number().int(), endsAtMinutes: z.number().int(), note: z.string() }).strict();
const mealRouteFitSchema = z.object({ basis: z.enum(['route_corridor', 'destination_fallback']), fromId: z.string(), toId: z.string(), directMinutes: z.number().int().nonnegative().nullable(), addedMinutes: z.number().int().nonnegative().optional() }).strict();
const daylightWindowSchema = z.object({ startMinutes: z.number().int(), endMinutes: z.number().int(), evidence: z.literal('planning_assumption') }).strict();
const durationProfileSchema = z.object({ kind: z.enum(['fixed', 'provider_slot', 'elastic', 'pace_sensitive', 'open_ended']), minimumMinutes: z.number().int().positive(), preferredMinutes: z.number().int().positive(), maximumMinutes: z.number().int().positive(), groupSensitivity: z.enum(['none', 'low', 'medium', 'high']), evidence: z.enum(['provider', 'manual', 'planning_assumption']), difficulty: z.enum(['easy', 'moderate', 'hard', 'unknown']).optional(), daylightWindow: daylightWindowSchema.optional() }).strict();
const activityTimingEvidenceSchema = z.object({ kind: z.enum(['fixed', 'provider_slot']), durationMinutes: z.number().int().positive(), startMinutes: z.number().int().optional(), source: z.enum(['provider', 'manual']), label: z.string().min(1) }).strict();
const mealWindowSchema = z.object({ preferredStartMinutes: z.number().int(), preferredEndMinutes: z.number().int(), earliestStartMinutes: z.number().int(), latestStartMinutes: z.number().int() }).strict();
const constraintFindingSchema = z.object({ id: z.string(), severity: z.enum(['warning', 'blocking', 'unresolved']), dayIndex: z.number().int().nonnegative(), itemId: z.string().optional(), message: z.string(), overridable: z.boolean() }).strict();
const liveVisitSchema = z.object({ place: livePlaceSchema, durationMinutes: z.number().int().positive(), durationProfile: durationProfileSchema.optional(), timingKind: z.enum(['fixed', 'estimated']).optional(), fixedStartMinutes: z.number().int().optional(), timingEvidence: activityTimingEvidenceSchema.optional(), sequenceOrder: z.number().int().optional(), period: z.enum(['morning', 'afternoon', 'evening']).optional(), mealCoverage: z.object({ type: z.enum(['lunch', 'dinner']), evidence: z.enum(['provider', 'manual', 'place_description']), sourceLabel: z.string().min(1), note: z.string() }).strict().optional(), hoursStatus: z.enum(['open', 'unknown']).optional(), hoursNote: z.string().optional(), scheduleValidation: scheduleValidationSchema.optional() }).strict();
const liveMealSchema = z.object({ type: z.enum(['breakfast', 'lunch', 'dinner']), place: livePlaceSchema, durationMinutes: z.number().int().positive(), targetStartMinutes: z.number().int(), window: mealWindowSchema.optional(), shiftedByMinutes: z.number().int().optional(), sequenceOrder: z.number().int().optional(), location: z.enum(['stay', 'restaurant']), dietaryNote: z.string(), hoursStatus: z.enum(['open', 'unknown']).optional(), hoursNote: z.string().optional(), scheduleValidation: scheduleValidationSchema.optional(), routeFit: mealRouteFitSchema.optional() }).strict();
const liveDaySchema = z.object({ date: z.string().date(), visits: z.array(liveVisitSchema), meals: z.array(liveMealSchema).optional(), legs: z.array(liveLegSchema), availableStartMinutes: z.number().int().nullable().optional(), availableEndMinutes: z.number().int().nullable().optional(), findings: z.array(constraintFindingSchema).optional(), capacityNote: z.string().optional() }).strict();
export const livePlanSchema = z.object({ brief: liveBriefSchema, hotels: z.array(livePlaceSchema), selectedHotelId: z.string().nullable(), activityOptions: z.array(livePlaceSchema).optional(), mealOptions: z.array(livePlaceSchema).optional(), eveningOptions: z.array(livePlaceSchema).optional(), eveningPrompt: z.string().optional(), days: z.array(liveDaySchema).min(2).max(7), travel: liveTravelSchema.optional(), flight: liveFlightJourneySchema.optional(), warnings: z.array(z.string()), checkedAt: z.string(), status: z.literal('provisional'), totalCost: z.null(), scheduling: z.object({ pace: z.enum(['relaxed', 'balanced', 'packed']), paceDefaulted: z.boolean(), findings: z.array(constraintFindingSchema) }).strict().optional(), locks: z.object({ hotel: z.boolean(), outboundFlight: z.boolean(), returnFlight: z.boolean(), outboundTravel: z.boolean().optional(), returnTravel: z.boolean().optional(), activityIds: z.array(z.string()).optional(), mealKeys: z.array(z.string()).optional() }).strict().optional() }).strict();

export const liveSelectionRequestSchema = z.object({
  phase: z.literal('live-selection'),
  plan: livePlanSchema,
  command: z.discriminatedUnion('type', [
    z.object({ type: z.literal('set_lock'), target: z.enum(['hotel', 'outboundFlight', 'returnFlight', 'outboundTravel', 'returnTravel']), locked: z.boolean() }).strict(),
    z.object({ type: z.literal('set_activity_lock'), placeId: z.string().min(1), locked: z.boolean() }).strict(),
    z.object({ type: z.literal('set_meal_lock'), dayIndex: z.number().int().nonnegative().max(6), mealType: z.enum(['breakfast', 'lunch', 'dinner']), locked: z.boolean() }).strict(),
    z.object({ type: z.literal('select_hotel'), hotelId: z.string().min(1), confirmConstraints: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('select_flight'), direction: z.enum(['outbound', 'return']), offerId: z.string().min(1), confirmConstraints: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('select_travel'), direction: z.enum(['outbound', 'return']), optionId: z.string().min(1), confirmConstraints: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('retry_flights') }).strict(),
    z.object({ type: z.literal('select_activity'), dayIndex: z.number().int().nonnegative().max(6), visitIndex: z.number().int().nonnegative().max(3), placeId: z.string().min(1), confirmConstraints: z.boolean().optional() }).strict(),
    z.object({ type: z.literal('select_meal'), dayIndex: z.number().int().nonnegative().max(6), mealType: z.enum(['breakfast', 'lunch', 'dinner']), placeId: z.string().min(1), confirmConstraints: z.boolean().optional() }).strict(),
  ]),
}).strict();
export type LiveSelectionRequest = {
  phase: 'live-selection';
  plan: LivePlan;
  command:
    | { type: 'set_lock'; target: 'hotel' | 'outboundFlight' | 'returnFlight' | 'outboundTravel' | 'returnTravel'; locked: boolean }
    | { type: 'set_activity_lock'; placeId: string; locked: boolean }
    | { type: 'set_meal_lock'; dayIndex: number; mealType: 'breakfast' | 'lunch' | 'dinner'; locked: boolean }
    | { type: 'select_hotel'; hotelId: string; confirmConstraints?: boolean }
    | { type: 'select_flight'; direction: 'outbound' | 'return'; offerId: string; confirmConstraints?: boolean }
    | { type: 'select_travel'; direction: 'outbound' | 'return'; optionId: string; confirmConstraints?: boolean }
    | { type: 'retry_flights' }
    | { type: 'select_activity'; dayIndex: number; visitIndex: number; placeId: string; confirmConstraints?: boolean }
    | { type: 'select_meal'; dayIndex: number; mealType: 'breakfast' | 'lunch' | 'dinner'; placeId: string; confirmConstraints?: boolean };
};
export type LiveSelectionImpact = {
  status: 'safe' | 'warning' | 'blocking' | 'unresolved';
  requiresConfirmation: boolean;
  affectedDays: number[];
  movedItems: { dayIndex: number; itemId: string; label: string; kind: 'activity' | 'meal'; previousStartMinutes: number | null; nextStartMinutes: number | null; deltaMinutes: number | null }[];
  transferChanges: { dayIndex: number; previousFromId: string | null; previousToId: string | null; nextFromId: string | null; nextToId: string | null; previousMinutes: number | null; nextMinutes: number | null }[];
  mealChanges: { dayIndex: number; type: 'breakfast' | 'lunch' | 'dinner'; previousStartMinutes: number | null; nextStartMinutes: number | null; deltaMinutes: number | null }[];
  usableTimeDeltaMinutes: number;
  findings: ConstraintFinding[];
  alternatives: { id: string; label: string }[];
};
export type LiveSelectionResponse = { kind: 'live-selection'; plan: LivePlan; message: string; impact?: LiveSelectionImpact; confirmation?: { command: LiveSelectionRequest['command']; findings: ConstraintFinding[]; impact: LiveSelectionImpact } };
