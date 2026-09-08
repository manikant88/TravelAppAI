import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ISODate } from '@/domain/model';
import type { TransportOffer } from '@/inventory/contracts';
import { searchTransportOffers, type TransportProviderAdapter } from '@/transport/provider';

const airportSchema = z.object({
  code: z.string().length(3),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  countryCode: z.string().length(2),
}).passthrough();

const segmentSchema = z.object({
  arrivalTime: z.string(), departureTime: z.string(), originCode: z.string().length(3), destinationCode: z.string().length(3),
  direction: z.enum(['OUTBOUND', 'INBOUND']), duration: z.object({ minutes: z.number().int().positive() }).passthrough(),
  carrier: z.object({ marketingName: z.string().min(1), marketingCode: z.string().min(1) }).passthrough(),
  flight: z.object({ marketingNumber: z.string().min(1) }).passthrough(),
}).passthrough();
const offerSchema = z.object({
  offerId: z.string().min(1), expiration: z.string().datetime({ offset: true }),
  pricing: z.object({ display: z.object({ total: z.number().nonnegative(), currency: z.string().length(3), perPassenger: z.object({ adult: z.object({ total: z.number().nonnegative() }).passthrough() }).passthrough() }).passthrough() }).passthrough(),
  fare: z.object({ seatsRemaining: z.number().int().nonnegative().optional() }).passthrough(),
  terms: z.object({ refundable: z.boolean().optional(), changeable: z.boolean().optional() }).passthrough(),
}).passthrough();
const journeySchema = z.object({
  journeyKey: z.string().min(1), segments: z.array(segmentSchema).min(1), totalDuration: z.object({ minutes: z.number().int().positive() }).passthrough(),
  cheapestOffer: offerSchema,
}).passthrough();
const rateResponseSchema = z.object({ data: z.array(z.object({ journeys: z.array(journeySchema).default([]) }).passthrough()).default([]) }).passthrough();
const airportResponseSchema = z.object({ data: z.array(z.unknown()) }).passthrough();

export type FlightHub = z.infer<typeof airportSchema>;
export interface SupplierFlightSearchRequest {
  origin: { lat: number; lng: number; utcOffsetMinutes: number };
  destination: { lat: number; lng: number; utcOffsetMinutes: number };
  departureDate: ISODate;
  returnDate: ISODate;
  travellers: number;
  currency: 'INR';
  country: string;
}
export interface SupplierFlightSearchResult {
  originHub: FlightHub;
  destinationHub: FlightHub;
  outbound: TransportOffer[];
  returning: TransportOffer[];
  checkedAt: string;
  environment: 'sandbox' | 'live';
  warnings: string[];
}
export interface FlightProvider { search(request: SupplierFlightSearchRequest): Promise<SupplierFlightSearchResult> }
export class FlightProviderError extends Error {}

function radians(value: number) { return value * Math.PI / 180; }
function distanceKm(a: { lat: number; lng: number }, b: FlightHub) {
  const dLat = radians(b.latitude - a.lat); const dLng = radians(b.longitude - a.lng);
  const lat1 = radians(a.lat); const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function nearestAirport(location: { lat: number; lng: number }, airports: FlightHub[]) {
  return airports.reduce<{ airport?: FlightHub; distance: number }>((best, airport) => {
    const distance = distanceKm(location, airport);
    return distance < best.distance ? { airport, distance } : best;
  }, { distance: Number.POSITIVE_INFINITY });
}
function offset(value: number) {
  const sign = value >= 0 ? '+' : '-'; const absolute = Math.abs(value);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
function zoned(local: string, utcOffsetMinutes: number) {
  return z.string().datetime({ offset: true }).parse(`${local}${offset(utcOffsetMinutes)}`);
}
function stableId(prefix: string, value: string) {
  return `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

export function normalizeNuiteeFlightResponse(raw: unknown, input: {
  from: string; to: string; departureDate: ISODate; travellers: number; fromUtcOffsetMinutes: number; toUtcOffsetMinutes: number;
}, checkedAt: string, evidenceKind: 'sandbox' | 'live') {
  const response = rateResponseSchema.parse(raw);
  const warnings: string[] = [];
  let excludedConnections = 0;
  const offers = response.data.flatMap(group => group.journeys).flatMap((journey): TransportOffer[] => {
    if (journey.segments.length !== 1) { excludedConnections++; return []; }
    const segment = journey.segments[0]; const supplier = journey.cheapestOffer;
    if (segment.originCode !== input.from || segment.destinationCode !== input.to || !segment.departureTime.startsWith(input.departureDate)) return [];
    const departureAt = zoned(segment.departureTime, input.fromUtcOffsetMinutes);
    const arrivalAt = zoned(segment.arrivalTime, input.toUtcOffsetMinutes);
    const elapsed = Math.round((Date.parse(arrivalAt) - Date.parse(departureAt)) / 60_000);
    if (elapsed <= 0 || elapsed !== journey.totalDuration.minutes) return [];
    const providerOfferId = supplier.offerId;
    const remaining = supplier.fare.seatsRemaining;
    return [{
      schemaVersion: 1, kind: 'supplier_offer', id: stableId('offer:flight:nuitee', providerOfferId),
      serviceId: stableId('service:flight:nuitee', journey.journeyKey), mode: 'flight', from: input.from, to: input.to,
      departureAt, arrivalAt, durationMinutes: elapsed, stops: 0, operator: segment.carrier.marketingName,
      segments: [{ mode: 'flight', from: input.from, to: input.to, departureAt, arrivalAt, operator: segment.carrier.marketingName, number: `${segment.carrier.marketingCode}${segment.flight.marketingNumber}` }],
      price: { amount: supplier.pricing.display.perPassenger.adult.total, currency: 'INR', unit: 'per_traveller' },
      availability: remaining === undefined ? 'unknown' : remaining >= input.travellers ? 'available' : 'unavailable',
      source: { provider: 'Nuitée Connect Flights', providerOfferId, evidenceKind, checkedAt, expiresAt: supplier.expiration },
      booking: null,
      cancellationTerms: { refundable: supplier.terms.refundable, summary: `${supplier.terms.refundable ? 'Refundable' : 'Non-refundable'}; changes ${supplier.terms.changeable ? 'allowed under supplier terms' : 'not allowed'}.` },
      ...(remaining === undefined ? {} : { capacity: { remaining } }),
    }];
  });
  if (excludedConnections) warnings.push(`${excludedConnections} connecting flight result${excludedConnections === 1 ? ' was' : 's were'} excluded because intermediate airport time zones are not yet resolved.`);
  return { offers: offers.sort((a, b) => a.price.amount - b.price.amount || a.durationMinutes - b.durationMinutes).slice(0, 8), checkedAt, warnings };
}

export function createNuiteeFlightProvider(signal: AbortSignal): FlightProvider {
  const apiKey = process.env.NUITEE_API_KEY?.trim();
  if (!apiKey) throw new FlightProviderError('Nuitée API key is missing. Configure NUITEE_API_KEY.');
  const baseUrl = (process.env.NUITEE_API_BASE_URL?.trim() || 'https://api.liteapi.travel').replace(/\/$/, '');
  const evidenceKind = apiKey.startsWith('sand_') ? 'sandbox' : 'live';
  let airportCatalogue: Promise<FlightHub[]> | undefined;
  async function call(path: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey! }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    const data = await response.json().catch(() => undefined);
    if (!response.ok) throw new FlightProviderError(`Nuitée Flights request failed (${response.status}).`);
    return data;
  }
  async function airports() {
    airportCatalogue ??= call('/v3.0/data/iataCodes').then(raw => airportResponseSchema.parse(raw).data.flatMap(value => {
      const parsed = airportSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    }));
    return airportCatalogue;
  }
  return { async search(request) {
    if (request.origin.utcOffsetMinutes !== request.destination.utcOffsetMinutes) {
      throw new FlightProviderError('Cross-time-zone flight normalization is deferred until travel-date time zones can be resolved.');
    }
    const catalogue = await airports();
    const origin = nearestAirport(request.origin, catalogue); const destination = nearestAirport(request.destination, catalogue);
    if (!origin.airport || origin.distance > 150) throw new FlightProviderError('No IATA airport was found near the origin.');
    if (!destination.airport || destination.distance > 150) throw new FlightProviderError('No IATA airport was found near the destination.');
    const checkedAt = new Date().toISOString();
    const adapter = (fromOffset: number, toOffset: number): TransportProviderAdapter => ({
      id: 'Nuitée Connect Flights',
      capabilities: { modes: ['flight'], livePrices: evidenceKind === 'live', liveAvailability: true, booking: 'none', cancellationTerms: true, capacity: true, refresh: 'manual' },
      async fetchOffers(input) {
        const raw = await call('/v3.0/flights/rates', { legs: [{ origin: input.from, destination: input.to, date: input.departureDate, direction: 'OUTBOUND' }], adults: input.travellerIds.length, children: 0, infants: 0, cabinClass: 'ECONOMY', currency: request.currency, country: request.country.toUpperCase() });
        return normalizeNuiteeFlightResponse(raw, { from: input.from, to: input.to, departureDate: input.departureDate, travellers: input.travellerIds.length, fromUtcOffsetMinutes: fromOffset, toUtcOffsetMinutes: toOffset }, checkedAt, evidenceKind);
      },
    });
    const travellerIds = Array.from({ length: request.travellers }, (_, index) => `traveller:${index + 1}`);
    const common = { travellerIds, modes: ['flight' as const] };
    const [outbound, returning] = await Promise.all([
      searchTransportOffers(adapter(request.origin.utcOffsetMinutes, request.destination.utcOffsetMinutes), { ...common, from: origin.airport.code, to: destination.airport.code, departureDate: request.departureDate }, signal),
      searchTransportOffers(adapter(request.destination.utcOffsetMinutes, request.origin.utcOffsetMinutes), { ...common, from: destination.airport.code, to: origin.airport.code, departureDate: request.returnDate }, signal),
    ]);
    return { originHub: origin.airport, destinationHub: destination.airport, outbound: outbound.offers, returning: returning.offers, checkedAt, environment: evidenceKind, warnings: [...outbound.warnings, ...returning.warnings, `All ${request.travellers} travellers were searched as adults in economy class.`, 'Each direction is priced as a separate one-way offer; a round-trip bundle was not allocated across the itinerary.'] };
  } };
}
