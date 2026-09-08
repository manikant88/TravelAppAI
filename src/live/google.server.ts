import { setDefaultResultOrder } from 'node:dns';
import { z } from 'zod';
import type { LiveLeg, LivePlace, LiveTravelOption } from './contracts';

const placeSchema = z.object({
  id: z.string(), displayName: z.object({ text: z.string() }),
  formattedAddress: z.string().optional(), location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  rating: z.number().min(0).max(5).optional(), userRatingCount: z.number().nonnegative().optional(),
  priceLevel: z.string().optional(),
  priceRange: z.object({ startPrice: z.object({ currencyCode: z.string(), units: z.string().optional(), nanos: z.number().optional() }).optional(), endPrice: z.object({ currencyCode: z.string(), units: z.string().optional(), nanos: z.number().optional() }).optional() }).optional(),
  photos: z.array(z.object({ name: z.string(), authorAttributions: z.array(z.object({ displayName: z.string(), uri: z.string().optional() })).optional() })).optional(),
  regularOpeningHours: z.object({
    weekdayDescriptions: z.array(z.string()).optional(),
    periods: z.array(z.object({
      open: z.object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23).default(0), minute: z.number().int().min(0).max(59).default(0) }),
      close: z.object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23).default(0), minute: z.number().int().min(0).max(59).default(0) }).optional(),
    })).optional(),
  }).optional(),
  editorialSummary: z.object({ text: z.string(), languageCode: z.string().optional() }).optional(),
  websiteUri: z.string().url().optional(),
  utcOffsetMinutes: z.number().int().min(-1080).max(1080).optional(),
  goodForChildren: z.boolean().optional(), allowsDogs: z.boolean().optional(), restroom: z.boolean().optional(),
  parkingOptions: z.object({
    freeParkingLot: z.boolean().optional(), paidParkingLot: z.boolean().optional(),
    freeStreetParking: z.boolean().optional(), paidStreetParking: z.boolean().optional(),
    valetParking: z.boolean().optional(), freeGarageParking: z.boolean().optional(), paidGarageParking: z.boolean().optional(),
  }).optional(),
  accessibilityOptions: z.object({
    wheelchairAccessibleEntrance: z.boolean().optional(), wheelchairAccessibleParking: z.boolean().optional(),
    wheelchairAccessibleRestroom: z.boolean().optional(), wheelchairAccessibleSeating: z.boolean().optional(),
  }).optional(),
  attributions: z.array(z.object({ provider: z.string().optional(), providerUri: z.string().optional() })).optional(),
});
export interface LiveProvider {
  search(query: string, limit: number, includePhotos?: boolean): Promise<LivePlace[]>;
  searchAlongRoute?(query: string, from: LivePlace, to: LivePlace, limit: number): Promise<{ places: LivePlace[]; directLeg: LiveLeg }>;
  details(id: string): Promise<LivePlace>;
  route(from: LivePlace, to: LivePlace): Promise<LiveLeg>;
  travelRoutes(from: LivePlace, to: LivePlace, input: { direction: 'outbound' | 'return'; mode: 'drive' | 'transit'; departureTime: string }): Promise<LiveTravelOption[]>;
}
export class LiveProviderError extends Error {}
export function createGoogleProvider(signal: AbortSignal): LiveProvider {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
  if (!key) throw new LiveProviderError('Google server key is missing. Configure GOOGLE_MAPS_SERVER_API_KEY.');
  // Local IPv4 allowlist; opt-in so production DNS behavior is unchanged.
  if (process.env.GOOGLE_MAPS_PREFER_IPV4 === 'true') setDefaultResultOrder('ipv4first');
  let calls = 0;
  async function call(url: string, fields: string, body?: unknown) {
    if (++calls > 60) throw new LiveProviderError('Live search limit reached.');
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key!, ...(fields ? { 'X-Goog-FieldMask': fields } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const reasons = (data.error?.details ?? []).map((x: { reason?: string }) => x.reason);
      if (reasons.includes('API_KEY_IP_ADDRESS_BLOCKED')) throw new LiveProviderError('Google blocked the server IP. Check its IP restriction and GOOGLE_MAPS_PREFER_IPV4.');
      throw new LiveProviderError(`Google request failed (${response.status}). Check enabled APIs, key restrictions and quotas.`);
    }
    return response.json();
  }
  async function normalize(raw: unknown, includePhoto = false): Promise<LivePlace> {
    const p = placeSchema.parse(raw);
    let photo: LivePlace['photo'];
    const first = p.photos?.[0];
    if (includePhoto && first && /^places\/[^/]+\/photos\/[^/]+$/.test(first.name)) {
      try {
        const media = await call(`https://places.googleapis.com/v1/${first.name.split('/').map(encodeURIComponent).join('/')}/media?maxWidthPx=640&skipHttpRedirect=true`, '');
        const url = new URL(z.object({ photoUri: z.string().url() }).parse(media).photoUri);
        if (url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com')) {
          photo = { url: url.href, authors: (first.authorAttributions ?? []).map(a => ({ name: a.displayName, url: safeLink(a.uri) })) };
        }
      } catch { /* Keep the observed place usable when its photo is unavailable. */ }
    }
    const low = p.priceRange?.startPrice; const high = p.priceRange?.endPrice;
    const currency = low?.currencyCode ?? high?.currencyCode;
    const amount = (money: typeof low) => {
      if (!money || money.currencyCode !== currency) return undefined;
      const value = Number(money.units ?? 0) + (money.nanos ?? 0) / 1e9;
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    };
    const amenities = [
      p.goodForChildren ? 'Good for children' : undefined, p.allowsDogs ? 'Dogs allowed' : undefined,
      p.restroom ? 'Restroom' : undefined,
      p.parkingOptions?.freeParkingLot ? 'Free parking lot' : undefined,
      p.parkingOptions?.paidParkingLot ? 'Paid parking lot' : undefined,
      p.parkingOptions?.freeStreetParking ? 'Free street parking' : undefined,
      p.parkingOptions?.paidStreetParking ? 'Paid street parking' : undefined,
      p.parkingOptions?.valetParking ? 'Valet parking' : undefined,
      p.parkingOptions?.freeGarageParking ? 'Free garage parking' : undefined,
      p.parkingOptions?.paidGarageParking ? 'Paid garage parking' : undefined,
      p.accessibilityOptions?.wheelchairAccessibleEntrance ? 'Wheelchair-accessible entrance' : undefined,
      p.accessibilityOptions?.wheelchairAccessibleParking ? 'Wheelchair-accessible parking' : undefined,
      p.accessibilityOptions?.wheelchairAccessibleRestroom ? 'Wheelchair-accessible restroom' : undefined,
      p.accessibilityOptions?.wheelchairAccessibleSeating ? 'Wheelchair-accessible seating' : undefined,
    ].filter((value): value is string => Boolean(value));
    return { id: p.id, name: p.displayName.text, address: p.formattedAddress ?? '', lat: p.location.latitude, lng: p.location.longitude,
      source: 'Google Maps', checkedAt: new Date().toISOString(), mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName.text)}&query_place_id=${encodeURIComponent(p.id)}`,
      rating: p.rating, reviewCount: p.userRatingCount, photo, priceLevel: p.priceLevel,
      priceGuidance: currency ? { currency, min: amount(low), max: amount(high) } : undefined,
      editorialSummary: p.editorialSummary?.text, amenities, websiteUrl: safeLink(p.websiteUri), utcOffsetMinutes: p.utcOffsetMinutes,
      regularHours: p.regularOpeningHours?.periods,
      openingHours: p.regularOpeningHours?.weekdayDescriptions,
      attributions: (p.attributions ?? []).map(a => ({ name: a.provider ?? 'Data provider', url: a.providerUri?.startsWith('https://') ? a.providerUri : undefined })),
    };
  }
  const fields = 'id,displayName,formattedAddress,location,attributions,photos,rating,userRatingCount,priceLevel,priceRange,utcOffsetMinutes,regularOpeningHours,editorialSummary,websiteUri,goodForChildren,allowsDogs,restroom,parkingOptions,accessibilityOptions';
  async function driveRoute(from: LivePlace, to: LivePlace): Promise<LiveLeg> {
    const checkedAt = new Date().toISOString();
    const raw = await call('https://routes.googleapis.com/directions/v2:computeRoutes', 'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring', {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', polylineEncoding: 'GEO_JSON_LINESTRING',
    });
    const parsed = z.object({ routes: z.array(z.object({ distanceMeters: z.number().nonnegative(), duration: z.string().regex(/^\d+(\.\d+)?s$/), polyline: z.object({ geoJsonLinestring: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }) }).optional() })).default([]) }).parse(raw);
    const route = parsed.routes[0];
    if (!route) throw new LiveProviderError('No driving route returned.');
    return { fromId: from.id, toId: to.id, meters: route.distanceMeters, minutes: Math.ceil(parseFloat(route.duration) / 60), path: route.polyline?.geoJsonLinestring.coordinates.map(([lng, lat]) => ({ lat, lng })) ?? [], checkedAt };
  }
  return {
    async search(query, limit, includePhotos = false) {
      const data = await call('https://places.googleapis.com/v1/places:searchText', fields.split(',').map(f => `places.${f}`).join(','), { textQuery: query, pageSize: limit, languageCode: 'en' });
      const places = z.object({ places: z.array(placeSchema).default([]) }).parse(data).places;
      const results: LivePlace[] = [];
      for (let index = 0; index < places.length; index++) results.push(await normalize(places[index], includePhotos && index < 8));
      return results;
    },
    async searchAlongRoute(query, from, to, limit) {
      const directLeg = await driveRoute(from, to);
      if ('error' in directLeg || directLeg.path.length < 2) throw new LiveProviderError('A route polyline is required for corridor search.');
      const data = await call('https://places.googleapis.com/v1/places:searchText', fields.split(',').map(field => `places.${field}`).join(','), {
        textQuery: query,
        pageSize: Math.min(limit, 5),
        languageCode: 'en',
        searchAlongRouteParameters: { polyline: { encodedPolyline: encodePolyline(directLeg.path) } },
      });
      const places = z.object({ places: z.array(placeSchema).default([]) }).parse(data).places;
      return { places: await Promise.all(places.map(place => normalize(place))), directLeg };
    },
    async details(id) { return normalize(await call(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, fields), true); },
    route: driveRoute,
    async travelRoutes(from, to, input) {
      const checkedAt = new Date().toISOString();
      const transitStep = z.object({
        transitDetails: z.object({
          stopDetails: z.object({ departureTime: z.string().datetime({ offset: true }).optional(), arrivalTime: z.string().datetime({ offset: true }).optional() }).optional(),
          transitLine: z.object({ name: z.string().optional(), nameShort: z.string().optional(), vehicle: z.object({ type: z.string().optional() }).optional() }).optional(),
        }).optional(),
      });
      const routeSchema = z.object({
        distanceMeters: z.number().nonnegative().optional(),
        duration: z.string().regex(/^\d+(\.\d+)?s$/),
        polyline: z.object({ geoJsonLinestring: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }) }).optional(),
        legs: z.array(z.object({ steps: z.array(transitStep).default([]) })).default([]),
        travelAdvisory: z.object({ transitFare: z.object({ currencyCode: z.string().optional(), units: z.string().optional(), nanos: z.number().optional() }).optional() }).optional(),
      });
      const raw = await call(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring,routes.legs.steps.transitDetails.stopDetails.departureTime,routes.legs.steps.transitDetails.stopDetails.arrivalTime,routes.legs.steps.transitDetails.transitLine.name,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.vehicle.type,routes.travelAdvisory.transitFare',
        {
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: input.mode === 'drive' ? 'DRIVE' : 'TRANSIT',
          ...(input.mode === 'drive' ? { routingPreference: 'TRAFFIC_AWARE' } : { transitPreferences: { allowedTravelModes: ['BUS', 'TRAIN', 'LIGHT_RAIL', 'RAIL', 'SUBWAY'] } }),
          departureTime: input.departureTime,
          computeAlternativeRoutes: true,
          polylineEncoding: 'GEO_JSON_LINESTRING',
        },
      );
      const routes = z.object({ routes: z.array(routeSchema).default([]) }).parse(raw).routes;
      const seen = new Set<string>();
      return routes.flatMap((route, index): LiveTravelOption[] => {
        const details = route.legs.flatMap(leg => leg.steps.map(step => step.transitDetails).filter((value): value is NonNullable<typeof value> => Boolean(value)));
        const transitModes = [...new Set(details.map(detail => detail.transitLine?.vehicle?.type).filter((value): value is string => Boolean(value)))];
        const transitLines = [...new Set(details.map(detail => detail.transitLine?.nameShort ?? detail.transitLine?.name).filter((value): value is string => Boolean(value)))];
        const departureAt = details.find(detail => detail.stopDetails?.departureTime)?.stopDetails?.departureTime;
        const arrivalAt = details.findLast(detail => detail.stopDetails?.arrivalTime)?.stopDetails?.arrivalTime;
        const durationSeconds = parseFloat(route.duration);
        const minutes = Math.ceil(durationSeconds / 60);
        const signature = `${minutes}:${route.distanceMeters ?? ''}:${transitModes.join(',')}:${transitLines.join(',')}`;
        if (seen.has(signature)) return [];
        seen.add(signature);
        const money = route.travelAdvisory?.transitFare;
        const fareAmount = money?.currencyCode ? Number(money.units ?? 0) + (money.nanos ?? 0) / 1e9 : undefined;
        const readableModes = transitModes.map(readableTransitMode);
        return [{
          schemaVersion: 1,
          kind: 'route_evidence',
          id: `${input.direction}-${input.mode}-${index}`,
          providerRouteId: null,
          direction: input.direction,
          mode: input.mode,
          label: input.mode === 'drive' ? 'Drive' : readableModes.length ? readableModes.join(' + ') : 'Public transit',
          minutes,
          meters: route.distanceMeters ?? null,
          path: route.polyline?.geoJsonLinestring.coordinates.map(([lng, lat]) => ({ lat, lng })) ?? [],
          departureAt: departureAt ?? (input.mode === 'drive' ? input.departureTime : undefined),
          arrivalAt: arrivalAt ?? (input.mode === 'drive' ? new Date(new Date(input.departureTime).getTime() + durationSeconds * 1000).toISOString() : undefined),
          transitModes,
          transitLines,
          ...(money?.currencyCode && fareAmount !== undefined && Number.isFinite(fareAmount) && fareAmount >= 0 ? { fare: { currency: money.currencyCode, amount: fareAmount } } : {}),
          checkedAt,
          source: 'Google Routes',
          timingKind: input.mode === 'drive' ? 'estimated' : 'scheduled',
        }];
      }).slice(0, 3);
    },
  };
}

function encodePolyline(path: { lat: number; lng: number }[]) {
  let previousLat = 0;
  let previousLng = 0;
  let encoded = '';
  const encodeValue = (value: number) => {
    let transformed = value < 0 ? ~(value << 1) : value << 1;
    let output = '';
    while (transformed >= 0x20) {
      output += String.fromCharCode((0x20 | (transformed & 0x1f)) + 63);
      transformed >>= 5;
    }
    return output + String.fromCharCode(transformed + 63);
  };
  for (const point of path) {
    const latitude = Math.round(point.lat * 1e5);
    const longitude = Math.round(point.lng * 1e5);
    encoded += encodeValue(latitude - previousLat) + encodeValue(longitude - previousLng);
    previousLat = latitude;
    previousLng = longitude;
  }
  return encoded;
}

function readableTransitMode(value: string) {
  return value.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function safeLink(value?: string) {
  if (!value) return undefined;
  try { const url = new URL(value.startsWith('//') ? `https:${value}` : value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}
