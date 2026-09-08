// Bounded live smoke test: two Places searches and one Routes request.
// Run from the repository root: node scripts/verify-google-maps.mjs
// No retries, database writes, response files, or credential logging.
import { config } from 'dotenv';
import { setDefaultResultOrder } from 'node:dns';
// Local development key is allowlisted by public IPv4. Prefer that address
// family on dual-stack networks; this does not change the application runtime.
setDefaultResultOrder('ipv4first');
config({ path: '.env.local', quiet: true });

const key = process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim();
if (!key) {
  console.error('Missing GOOGLE_MAPS_SERVER_API_KEY in .env.local');
  process.exit(1);
}

async function request(label, url, body, fields) {
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fields,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  console.log(`${label}: HTTP ${response.status} (${Date.now() - started} ms)`);
  const data = await response.json();
  if (!response.ok) {
    // Log only Google's structured status/reason, never raw error payloads.
    const reasons = (data.error?.details ?? []).map(d => d.reason).filter(Boolean);
    throw new Error(`${label}: ${data.error?.status ?? 'REQUEST_FAILED'} ${reasons.join(', ')}`);
  }
  return data;
}

try {
  const places = [];
  for (const query of ['Hawa Mahal Jaipur India', 'Amber Fort Jaipur India']) {
    const result = await request('Places', 'https://places.googleapis.com/v1/places:searchText',
      { textQuery: query, pageSize: 1, languageCode: 'en', regionCode: 'IN' },
      'places.id,places.displayName,places.location');
    const place = result.places?.[0];
    if (!place?.id || !Number.isFinite(place.location?.latitude) || !Number.isFinite(place.location?.longitude)) {
      throw new Error('Places returned no usable match; route test stopped.');
    }
    places.push(place);
    console.log(JSON.stringify({ query, matchedName: place.displayName?.text, location: place.location }));
  }
  const result = await request('Routes', 'https://routes.googleapis.com/directions/v2:computeRoutes', {
    origin: { placeId: places[0].id },
    destination: { placeId: places[1].id },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
    languageCode: 'en-US',
    units: 'METRIC',
  }, 'routes.distanceMeters,routes.duration,routes.staticDuration');
  const route = result.routes?.[0];
  if (!Number.isFinite(route?.distanceMeters) || !/^\d+(\.\d+)?s$/.test(route?.duration ?? '')) {
    throw new Error('Routes returned no usable driving route.');
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...route }));
  console.log('PASS: live Places search and traffic-aware Routes work. Durations are estimates; no fare or hotel price was requested. Browser map key is not tested by this script.');
} catch (error) {
  // Fetch failures can carry request details; only print sanitized messages.
  const message = error instanceof Error ? error.message : 'Unknown failure';
  console.error(message.replaceAll(key, '[REDACTED]'));
  process.exitCode = 1;
}
