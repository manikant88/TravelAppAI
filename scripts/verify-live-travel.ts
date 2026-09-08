// Bounded intercity route smoke test. It logs route facts only, never credentials.
// Run from the repository root: npx tsx scripts/verify-live-travel.ts
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
process.env.GOOGLE_MAPS_PREFER_IPV4 ??= 'true';

const { createGoogleProvider } = await import('../src/live/google.server');
const controller = new AbortController();
const provider = createGoogleProvider(controller.signal);

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

try {
  const [[origin], [destination]] = await Promise.all([
    provider.search('Delhi, India', 1),
    provider.search('Jaipur, India', 1),
  ]);
  if (!origin || !destination) throw new Error('Google Places did not resolve Delhi and Jaipur.');
  const date = futureDate(3);
  const departureTime = `${date}T08:00:00+05:30`;
  const [drive, transit] = await Promise.all([
    provider.travelRoutes(origin, destination, { direction: 'outbound', mode: 'drive', departureTime }),
    provider.travelRoutes(origin, destination, { direction: 'outbound', mode: 'transit', departureTime }),
  ]);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    query: `${origin.name} to ${destination.name}`,
    date,
    drive: drive.map(option => ({ label: option.label, minutes: option.minutes, kilometers: option.meters === null ? null : Math.round(option.meters / 1000) })),
    transit: transit.map(option => ({ label: option.label, minutes: option.minutes, kilometers: option.meters === null ? null : Math.round(option.meters / 1000), transitLines: option.transitLines, departureAt: option.departureAt, arrivalAt: option.arrivalAt, fare: option.fare ?? null })),
  }, null, 2));
  console.log('PASS: Google returned intercity road/public-transit route evidence. These are not bookable offers and do not prove ticket or seat availability.');
} catch (error) {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '';
  const message = error instanceof Error ? error.message : 'Unknown failure';
  console.error(key ? message.replaceAll(key, '[REDACTED]') : message);
  process.exitCode = 1;
}
