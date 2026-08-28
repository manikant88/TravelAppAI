import type { InventorySeed } from "@/db/seed/data";
import { addMinutesInTimezone, localDateTimeWithOffset } from "@/domain/dates";

const supportedFrom = "2026-08-28";
const supportedUntil = "2027-03-31";
const everyDay = [0, 1, 2, 3, 4, 5, 6];
const delhiOffsetMinutes = 330;

type MarketRegion = InventorySeed["markets"][number]["region"];

interface AirportDefinition {
  id: string;
  name: string;
  code?: string;
  latitudeE6: number;
  longitudeE6: number;
}

interface StopDefinition {
  id: string;
  name: string;
  latitudeE6: number;
  longitudeE6: number;
  tags: string[];
  airport: AirportDefinition;
}

interface OffsetPeriod {
  from: string;
  until: string;
  offsetMinutes: number;
  outboundOffsetMinutes?: number;
  returnOffsetMinutes?: number;
}

export interface MarketDefinition {
  id: string;
  name: string;
  locationType: "city" | "region";
  countryId: string;
  countryName: string;
  countryCode: string;
  timezone: string;
  offsetPeriods: OffsetPeriod[];
  latitudeE6: number;
  longitudeE6: number;
  region: MarketRegion;
  displayOrder: number;
  tags: string[];
  aliases?: string[];
  airport?: AirportDefinition;
  stops?: StopDefinition[];
  flightDurationMinutes: number;
  transportPrice: number;
  stayPrice: number;
  activityPrice: number;
}

const wholeWindow = (offsetMinutes: number): OffsetPeriod[] => [
  { from: supportedFrom, until: supportedUntil, offsetMinutes },
];

export const marketManifest: MarketDefinition[] = [
  {
    id: "city:mumbai", name: "Mumbai", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 19_076_000, longitudeE6: 72_877_700, region: "india", displayOrder: 21, tags: ["urban", "food", "nightlife", "coast", "origin_hub"], aliases: ["Bombay"],
    airport: { id: "airport:bom", name: "Chhatrapati Shivaji Maharaj International Airport", code: "BOM", latitudeE6: 19_089_600, longitudeE6: 72_865_600 }, flightDurationMinutes: 135, transportPrice: 7_800, stayPrice: 7_200, activityPrice: 1_400,
  },
  {
    id: "city:chennai", name: "Chennai", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 13_082_700, longitudeE6: 80_270_700, region: "india", displayOrder: 22, tags: ["coast", "food", "heritage", "family", "origin_hub"], aliases: ["Madras"],
    airport: { id: "airport:maa", name: "Chennai International Airport", code: "MAA", latitudeE6: 12_994_100, longitudeE6: 80_170_900 }, flightDurationMinutes: 170, transportPrice: 8_400, stayPrice: 6_200, activityPrice: 1_100,
  },
  {
    id: "city:bengaluru", name: "Bengaluru", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 12_971_600, longitudeE6: 77_594_600, region: "india", displayOrder: 23, tags: ["urban", "food", "technology", "nightlife", "origin_hub"], aliases: ["Bangalore"],
    airport: { id: "airport:blr", name: "Kempegowda International Airport", code: "BLR", latitudeE6: 13_198_600, longitudeE6: 77_706_600 }, flightDurationMinutes: 170, transportPrice: 8_300, stayPrice: 6_800, activityPrice: 1_300,
  },
  {
    id: "city:hyderabad", name: "Hyderabad", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 17_385_000, longitudeE6: 78_486_700, region: "india", displayOrder: 24, tags: ["food", "heritage", "urban", "family", "origin_hub"],
    airport: { id: "airport:hyd", name: "Rajiv Gandhi International Airport", code: "HYD", latitudeE6: 17_240_300, longitudeE6: 78_429_400 }, flightDurationMinutes: 135, transportPrice: 7_600, stayPrice: 6_100, activityPrice: 1_150,
  },
  {
    id: "city:kolkata", name: "Kolkata", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 22_572_600, longitudeE6: 88_363_900, region: "india", displayOrder: 25, tags: ["food", "arts", "heritage", "culture", "origin_hub"],
    airport: { id: "airport:ccu", name: "Netaji Subhas Chandra Bose International Airport", code: "CCU", latitudeE6: 22_654_700, longitudeE6: 88_446_700 }, flightDurationMinutes: 130, transportPrice: 7_500, stayPrice: 5_900, activityPrice: 1_100,
  },
  {
    id: "city:goa", name: "Goa", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 15_299_300, longitudeE6: 74_124_000, region: "india", displayOrder: 1, tags: ["beaches", "food", "nightlife", "relaxed"],
    airport: { id: "airport:gox", name: "Manohar International Airport", code: "GOX", latitudeE6: 15_744_300, longitudeE6: 73_860_600 }, flightDurationMinutes: 155, transportPrice: 7_200, stayPrice: 5_800, activityPrice: 1_100,
  },
  {
    id: "city:manali", name: "Manali", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 32_243_200, longitudeE6: 77_189_200, region: "india", displayOrder: 3, tags: ["mountains", "nature", "adventure", "snow"],
    airport: { id: "airport:kuu", name: "Kullu–Manali Airport", code: "KUU", latitudeE6: 31_876_700, longitudeE6: 77_154_400 }, flightDurationMinutes: 85, transportPrice: 8_200, stayPrice: 5_100, activityPrice: 950,
  },
  {
    id: "city:srinagar", name: "Srinagar", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 34_083_700, longitudeE6: 74_797_300, region: "india", displayOrder: 4, tags: ["mountains", "lakes", "nature", "relaxed"],
    airport: { id: "airport:sxr", name: "Srinagar International Airport", code: "SXR", latitudeE6: 33_987_100, longitudeE6: 74_774_300 }, flightDurationMinutes: 90, transportPrice: 7_000, stayPrice: 6_200, activityPrice: 1_000,
  },
  {
    id: "city:rishikesh", name: "Rishikesh", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 30_086_900, longitudeE6: 78_267_600, region: "india", displayOrder: 5, tags: ["wellness", "river", "adventure", "spiritual"],
    airport: { id: "airport:ded", name: "Dehradun Airport", code: "DED", latitudeE6: 30_189_700, longitudeE6: 78_180_300 }, flightDurationMinutes: 60, transportPrice: 5_600, stayPrice: 4_400, activityPrice: 800,
  },
  {
    id: "city:kochi", name: "Kochi", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 9_931_200, longitudeE6: 76_267_300, region: "india", displayOrder: 6, tags: ["coast", "food", "heritage", "backwaters"],
    airport: { id: "airport:cok", name: "Cochin International Airport", code: "COK", latitudeE6: 10_152_000, longitudeE6: 76_401_900 }, flightDurationMinutes: 190, transportPrice: 8_100, stayPrice: 5_400, activityPrice: 950,
  },
  {
    id: "city:munnar", name: "Munnar", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 10_088_900, longitudeE6: 77_059_500, region: "india", displayOrder: 7, tags: ["hills", "tea", "nature", "relaxed"],
    airport: { id: "airport:munnar-heliport", name: "Munnar Heliport (synthetic)", latitudeE6: 10_088_900, longitudeE6: 77_059_500 }, flightDurationMinutes: 190, transportPrice: 8_100, stayPrice: 5_600, activityPrice: 900,
  },
  {
    id: "city:puducherry", name: "Puducherry", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 11_941_600, longitudeE6: 79_808_300, region: "india", displayOrder: 8, tags: ["coast", "heritage", "food", "relaxed"],
    airport: { id: "airport:pny", name: "Puducherry Airport", code: "PNY", latitudeE6: 11_968_700, longitudeE6: 79_810_100 }, flightDurationMinutes: 185, transportPrice: 8_500, stayPrice: 4_800, activityPrice: 700,
  },
  {
    id: "city:darjeeling", name: "Darjeeling", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 27_041_000, longitudeE6: 88_266_300, region: "india", displayOrder: 9, tags: ["hills", "tea", "heritage", "scenic"],
    airport: { id: "airport:ixb", name: "Bagdogra International Airport", code: "IXB", latitudeE6: 26_681_200, longitudeE6: 88_328_600 }, flightDurationMinutes: 125, transportPrice: 8_000, stayPrice: 5_000, activityPrice: 850,
  },
  {
    id: "city:puri", name: "Puri", locationType: "city", countryId: "country:in", countryName: "India", countryCode: "IN", timezone: "Asia/Kolkata", offsetPeriods: wholeWindow(330), latitudeE6: 19_813_500, longitudeE6: 85_831_200, region: "india", displayOrder: 10, tags: ["beaches", "spiritual", "heritage", "family"],
    airport: { id: "airport:bbi", name: "Biju Patnaik International Airport", code: "BBI", latitudeE6: 20_244_400, longitudeE6: 85_817_800 }, flightDurationMinutes: 125, transportPrice: 7_200, stayPrice: 4_300, activityPrice: 650,
  },
  {
    id: "region:thailand-andaman", name: "Thailand — Phuket & Krabi", locationType: "region", countryId: "country:th", countryName: "Thailand", countryCode: "TH", timezone: "Asia/Bangkok", offsetPeriods: wholeWindow(420), latitudeE6: 7_980_000, longitudeE6: 98_700_000, region: "international", displayOrder: 11, tags: ["beaches", "islands", "food", "multi_stop"],
    stops: [
      { id: "city:phuket", name: "Phuket", latitudeE6: 7_880_400, longitudeE6: 98_392_300, tags: ["beaches", "nightlife", "islands"], airport: { id: "airport:hkt", name: "Phuket International Airport", code: "HKT", latitudeE6: 8_113_200, longitudeE6: 98_316_900 } },
      { id: "city:krabi", name: "Krabi", latitudeE6: 8_086_300, longitudeE6: 98_906_300, tags: ["beaches", "nature", "relaxed"], airport: { id: "airport:kbv", name: "Krabi International Airport", code: "KBV", latitudeE6: 8_099_100, longitudeE6: 98_986_200 } },
    ], flightDurationMinutes: 270, transportPrice: 18_500, stayPrice: 7_200, activityPrice: 1_800,
  },
  {
    id: "city:bali", name: "Bali", locationType: "city", countryId: "country:id", countryName: "Indonesia", countryCode: "ID", timezone: "Asia/Makassar", offsetPeriods: wholeWindow(480), latitudeE6: -8_409_500, longitudeE6: 115_188_900, region: "international", displayOrder: 12, tags: ["beaches", "wellness", "culture", "nature"],
    airport: { id: "airport:dps", name: "I Gusti Ngurah Rai International Airport", code: "DPS", latitudeE6: -8_748_200, longitudeE6: 115_167_200 }, flightDurationMinutes: 520, transportPrice: 29_000, stayPrice: 7_800, activityPrice: 1_700,
  },
  {
    id: "city:singapore", name: "Singapore", locationType: "city", countryId: "country:sg", countryName: "Singapore", countryCode: "SG", timezone: "Asia/Singapore", offsetPeriods: wholeWindow(480), latitudeE6: 1_352_100, longitudeE6: 103_819_800, region: "international", displayOrder: 13, tags: ["food", "family", "architecture", "urban"],
    airport: { id: "airport:sin", name: "Singapore Changi Airport", code: "SIN", latitudeE6: 1_364_400, longitudeE6: 103_991_500 }, flightDurationMinutes: 355, transportPrice: 22_000, stayPrice: 10_500, activityPrice: 2_000,
  },
  {
    id: "city:dubai", name: "Dubai", locationType: "city", countryId: "country:ae", countryName: "United Arab Emirates", countryCode: "AE", timezone: "Asia/Dubai", offsetPeriods: wholeWindow(240), latitudeE6: 25_204_800, longitudeE6: 55_270_800, region: "international", displayOrder: 14, tags: ["architecture", "shopping", "desert", "family"],
    airport: { id: "airport:dxb", name: "Dubai International Airport", code: "DXB", latitudeE6: 25_253_200, longitudeE6: 55_365_700 }, flightDurationMinutes: 220, transportPrice: 17_000, stayPrice: 9_500, activityPrice: 2_200,
  },
  {
    id: "city:tokyo", name: "Tokyo", locationType: "city", countryId: "country:jp", countryName: "Japan", countryCode: "JP", timezone: "Asia/Tokyo", offsetPeriods: wholeWindow(540), latitudeE6: 35_676_200, longitudeE6: 139_650_300, region: "international", displayOrder: 15, tags: ["food", "culture", "urban", "technology"],
    airport: { id: "airport:nrt", name: "Narita International Airport", code: "NRT", latitudeE6: 35_772_000, longitudeE6: 140_392_900 }, flightDurationMinutes: 475, transportPrice: 36_000, stayPrice: 11_500, activityPrice: 2_400,
  },
  {
    id: "city:paris", name: "Paris", locationType: "city", countryId: "country:fr", countryName: "France", countryCode: "FR", timezone: "Europe/Paris", offsetPeriods: [{ from: supportedFrom, until: "2026-10-24", offsetMinutes: 120 }, { from: "2026-10-25", until: "2027-03-27", offsetMinutes: 60 }, { from: "2027-03-28", until: supportedUntil, offsetMinutes: 120 }], latitudeE6: 48_856_600, longitudeE6: 2_352_200, region: "international", displayOrder: 16, tags: ["art", "food", "architecture", "culture"],
    airport: { id: "airport:cdg", name: "Charles de Gaulle Airport", code: "CDG", latitudeE6: 49_009_700, longitudeE6: 2_547_900 }, flightDurationMinutes: 570, transportPrice: 39_000, stayPrice: 13_000, activityPrice: 2_600,
  },
  {
    id: "city:rome", name: "Rome", locationType: "city", countryId: "country:it", countryName: "Italy", countryCode: "IT", timezone: "Europe/Rome", offsetPeriods: [{ from: supportedFrom, until: "2026-10-24", offsetMinutes: 120 }, { from: "2026-10-25", until: "2027-03-27", offsetMinutes: 60 }, { from: "2027-03-28", until: supportedUntil, offsetMinutes: 120 }], latitudeE6: 41_902_800, longitudeE6: 12_496_400, region: "international", displayOrder: 17, tags: ["history", "food", "architecture", "culture"],
    airport: { id: "airport:fco", name: "Leonardo da Vinci–Fiumicino Airport", code: "FCO", latitudeE6: 41_800_300, longitudeE6: 12_238_900 }, flightDurationMinutes: 525, transportPrice: 37_000, stayPrice: 11_500, activityPrice: 2_300,
  },
  {
    id: "city:london", name: "London", locationType: "city", countryId: "country:gb", countryName: "United Kingdom", countryCode: "GB", timezone: "Europe/London", offsetPeriods: [{ from: supportedFrom, until: "2026-10-24", offsetMinutes: 60 }, { from: "2026-10-25", until: "2027-03-27", offsetMinutes: 0 }, { from: "2027-03-28", until: supportedUntil, offsetMinutes: 60 }], latitudeE6: 51_507_400, longitudeE6: -127_800, region: "international", displayOrder: 18, tags: ["history", "arts", "urban", "family"],
    airport: { id: "airport:lhr", name: "Heathrow Airport", code: "LHR", latitudeE6: 51_470_000, longitudeE6: -454_300 }, flightDurationMinutes: 585, transportPrice: 41_000, stayPrice: 14_000, activityPrice: 2_800,
  },
  {
    id: "city:new-york", name: "New York", locationType: "city", countryId: "country:us", countryName: "United States", countryCode: "US", timezone: "America/New_York", offsetPeriods: [{ from: supportedFrom, until: "2026-10-31", offsetMinutes: -240 }, { from: "2026-11-01", until: "2027-03-13", offsetMinutes: -300 }, { from: "2027-03-14", until: supportedUntil, offsetMinutes: -240 }], latitudeE6: 40_712_800, longitudeE6: -74_006_000, region: "international", displayOrder: 19, tags: ["urban", "arts", "food", "nightlife"],
    airport: { id: "airport:jfk", name: "John F. Kennedy International Airport", code: "JFK", latitudeE6: 40_641_300, longitudeE6: -73_778_100 }, flightDurationMinutes: 950, transportPrice: 58_000, stayPrice: 16_000, activityPrice: 3_100,
  },
  {
    id: "city:sydney", name: "Sydney", locationType: "city", countryId: "country:au", countryName: "Australia", countryCode: "AU", timezone: "Australia/Sydney", offsetPeriods: [{ from: supportedFrom, until: "2026-10-02", offsetMinutes: 600 }, { from: "2026-10-03", until: "2026-10-03", offsetMinutes: 600, outboundOffsetMinutes: 660 }, { from: "2026-10-04", until: supportedUntil, offsetMinutes: 660 }], latitudeE6: -33_868_800, longitudeE6: 151_209_300, region: "international", displayOrder: 20, tags: ["coast", "architecture", "nature", "urban"],
    airport: { id: "airport:syd", name: "Sydney Airport", code: "SYD", latitudeE6: -33_939_900, longitudeE6: 151_175_300 }, flightDurationMinutes: 1_005, transportPrice: 62_000, stayPrice: 14_500, activityPrice: 3_000,
  },
];

type GeneratedInventory = Omit<InventorySeed, "meta">;

function slug(id: string) {
  return id.split(":")[1];
}

function localArrival(departureMinutes: number, durationMinutes: number, fromOffset: number, toOffset: number) {
  const total = departureMinutes + durationMinutes + toOffset - fromOffset;
  const arrivalDayOffset = Math.floor(total / 1_440);
  const normalized = ((total % 1_440) + 1_440) % 1_440;
  return { arrivalLocalTime: `${Math.floor(normalized / 60).toString().padStart(2, "0")}:${(normalized % 60).toString().padStart(2, "0")}:00`, arrivalDayOffset };
}

function zonedArrival(date: string, departureMinutes: number, durationMinutes: number, fromTimezone: string, toTimezone: string) {
  const departureTime = `${Math.floor(departureMinutes / 60).toString().padStart(2, "0")}:${(departureMinutes % 60).toString().padStart(2, "0")}:00`;
  const departureAt = localDateTimeWithOffset(date, departureTime, fromTimezone);
  const arrivalAt = addMinutesInTimezone(departureAt, durationMinutes, toTimezone);
  const arrivalDate = arrivalAt.slice(0, 10);
  return {
    departureTime,
    arrivalLocalTime: arrivalAt.slice(11, 19),
    arrivalDayOffset: Math.round((parseDate(arrivalDate) - parseDate(date)) / 86_400_000),
  };
}

function parseDate(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function formatDate(date: number): string {
  return new Date(date).toISOString().slice(0, 10);
}

function intersectPeriods(left: OffsetPeriod, right: OffsetPeriod): OffsetPeriod | undefined {
  const from = Math.max(parseDate(left.from), parseDate(right.from));
  const until = Math.min(parseDate(left.until), parseDate(right.until));
  if (from > until) return undefined;
  return {
    from: formatDate(from),
    until: formatDate(until),
    offsetMinutes: right.offsetMinutes,
    outboundOffsetMinutes: right.outboundOffsetMinutes,
    returnOffsetMinutes: right.returnOffsetMinutes,
  };
}

function distanceKm(left: { latitudeE6: number; longitudeE6: number }, right: { latitudeE6: number; longitudeE6: number }): number {
  const earthKm = 6_371;
  const lat1 = left.latitudeE6 / 1_000_000 * Math.PI / 180;
  const lat2 = right.latitudeE6 / 1_000_000 * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = (right.longitudeE6 - left.longitudeE6) / 1_000_000 * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function emptyInventory(): GeneratedInventory {
  return { imageAssets: [], locations: [], markets: [], transportServices: [], transportSegments: [], properties: [], roomOffers: [], activities: [], activitySessions: [], transfers: [] };
}

function generateMarket(definition: MarketDefinition): GeneratedInventory {
  const seed = emptyInventory();
  const marketSlug = slug(definition.id);
  if (definition.countryId !== "country:in") seed.locations.push({ id: definition.countryId, type: "country", name: definition.countryName, countryCode: definition.countryCode, timezone: definition.timezone, aliases: [definition.countryName], tags: [] });
  seed.locations.push({ id: definition.id, type: definition.locationType, name: definition.name, countryCode: definition.countryCode, parentId: definition.countryId, timezone: definition.timezone, latitudeE6: definition.latitudeE6, longitudeE6: definition.longitudeE6, aliases: [...new Set([definition.name, ...(definition.aliases ?? [])])], tags: [...new Set([...definition.tags, "origin_hub"])], imageAssetKey: `market-${marketSlug}` });
  seed.markets.push({ locationId: definition.id, region: definition.region, displayOrder: definition.displayOrder });

  const stops: StopDefinition[] = definition.stops ?? [{ id: definition.id, name: definition.name, latitudeE6: definition.latitudeE6, longitudeE6: definition.longitudeE6, tags: definition.tags, airport: definition.airport! }];
  if (definition.stops) for (const stop of stops) seed.locations.push({ id: stop.id, type: "city", name: stop.name, countryCode: definition.countryCode, parentId: definition.id, timezone: definition.timezone, latitudeE6: stop.latitudeE6, longitudeE6: stop.longitudeE6, aliases: [stop.name], tags: stop.tags });
  for (const stop of stops) seed.locations.push({ id: stop.airport.id, type: "airport", name: stop.airport.name, countryCode: definition.countryCode, parentId: stop.id, timezone: definition.timezone, latitudeE6: stop.airport.latitudeE6, longitudeE6: stop.airport.longitudeE6, airportCode: stop.airport.code, aliases: [stop.airport.code, `${stop.name} Airport`].filter((alias): alias is string => Boolean(alias)), tags: ["arrival_hub", "origin_hub"] });

  const arrivalAirport = stops[0].airport;
  const departureAirport = stops.at(-1)!.airport;
  for (const [periodIndex, period] of definition.offsetPeriods.entries()) {
    const variants = [
      { key: "outbound-morning", fromId: "airport:del", toId: arrivalAirport.id, departureMinutes: 490, fromOffset: delhiOffsetMinutes, toOffset: period.outboundOffsetMinutes ?? period.offsetMinutes, price: definition.transportPrice, operator: "IndiGo Connect" },
      { key: "outbound-value", fromId: "airport:del", toId: arrivalAirport.id, departureMinutes: 870, fromOffset: delhiOffsetMinutes, toOffset: period.outboundOffsetMinutes ?? period.offsetMinutes, price: Math.round(definition.transportPrice * 0.84), operator: "Air India Connect" },
      { key: "return-afternoon", fromId: departureAirport.id, toId: "airport:del", departureMinutes: 800, fromOffset: period.returnOffsetMinutes ?? period.offsetMinutes, toOffset: delhiOffsetMinutes, price: Math.round(definition.transportPrice * 1.04), operator: "IndiGo Connect" },
      { key: "return-evening", fromId: departureAirport.id, toId: "airport:del", departureMinutes: 1_120, fromOffset: period.returnOffsetMinutes ?? period.offsetMinutes, toOffset: delhiOffsetMinutes, price: Math.round(definition.transportPrice * 0.92), operator: "Air India Connect" },
    ];
    variants.forEach((variant, variantIndex) => {
      const periodKey = definition.offsetPeriods.length === 1 ? "" : `-p${periodIndex + 1}`;
      const serviceId = `transport:${marketSlug}-${variant.key}${periodKey}`;
      const arrival = localArrival(variant.departureMinutes, definition.flightDurationMinutes, variant.fromOffset, variant.toOffset);
      seed.transportServices.push({ id: serviceId, mode: "flight", operator: variant.operator, operatingWeekdays: everyDay, validFrom: period.from, validUntil: period.until, priceAmount: variant.price, currency: "INR", priceUnit: "per_traveller" });
      seed.transportSegments.push({ id: `segment:${marketSlug}-${variant.key}${periodKey}-0`, serviceId, segmentIndex: 0, fromLocationId: variant.fromId, toLocationId: variant.toId, departureLocalTime: `${Math.floor(variant.departureMinutes / 60).toString().padStart(2, "0")}:${(variant.departureMinutes % 60).toString().padStart(2, "0")}:00`, arrivalLocalTime: arrival.arrivalLocalTime, arrivalDayOffset: arrival.arrivalDayOffset, durationMinutes: definition.flightDurationMinutes, operatorNumber: `${variantIndex % 2 === 0 ? "6E" : "AI"} ${definition.displayOrder}${periodIndex}${variantIndex}` });
    });
  }

  for (const [stopIndex, stop] of stops.entries()) {
    const stopSlug = slug(stop.id);
    const propertyTemplates = [
      { suffix: "central", label: "Central House", multiplier: 1, rating: 44, tags: ["central", "food", "family"] },
      { suffix: "quiet", label: "Quiet Retreat", multiplier: 1.25, rating: 47, tags: ["quiet", "premium", "senior_friendly"] },
      { suffix: "value", label: "Value Rooms", multiplier: 0.72, rating: 41, tags: ["value", "budget", "local"] },
      { suffix: "social", label: "Social Stay", multiplier: 0.86, rating: 43, tags: ["social", "walkable", "nightlife"] },
    ];
    propertyTemplates.forEach((template, propertyIndex) => {
      const propertyId = `property:${stopSlug}-${template.suffix}`;
      seed.properties.push({ id: propertyId, name: `${stop.name} ${template.label}`, locationId: stop.id, ratingTenths: template.rating, reviewCount: 240 + definition.displayOrder * 37 + propertyIndex * 113, amenities: propertyIndex === 2 ? ["wifi"] : ["wifi", "breakfast", "restaurant"], accessibility: propertyIndex === 1 ? ["elevator", "step_free_entry"] : ["elevator"], tags: [...template.tags, ...stop.tags.slice(0, 2)], imageAssetKey: `stay-${stopSlug}-${template.suffix}` });
      const offerCount = propertyIndex < 2 ? 2 : 1;
      for (let offerIndex = 0; offerIndex < offerCount; offerIndex += 1) seed.roomOffers.push({ id: `room:${stopSlug}-${template.suffix}-${offerIndex + 1}`, propertyId, roomLabel: offerIndex === 1 ? "Flexible Family Room" : propertyIndex === 1 ? "Premium Room" : "Standard Room", maxOccupancy: offerIndex === 1 ? 4 : propertyIndex === 2 ? 3 : 2, inventoryCount: 4 + propertyIndex, mealPlan: propertyIndex === 2 ? "none" : "breakfast", refundable: propertyIndex !== 2 || offerIndex === 1, validFrom: supportedFrom, validUntil: supportedUntil, priceAmount: Math.round(definition.stayPrice * template.multiplier * (offerIndex === 1 ? 1.35 : 1)), currency: "INR", priceUnit: "per_room_per_night" });
    });

    const activityTemplates = [
      { suffix: "highlights", label: "local highlights walk", mobility: "medium" as const, multiplier: 1, time: "09:30:00", tags: ["culture", "local"] },
      { suffix: "relaxed", label: "relaxed local experience", mobility: "low" as const, multiplier: 0.8, time: "16:30:00", tags: ["relaxed", "family"] },
      { suffix: "food", label: "food and market trail", mobility: "medium" as const, multiplier: 1.1, time: "17:30:00", tags: ["food", "local"] },
      { suffix: "heritage", label: "heritage story", mobility: "low" as const, multiplier: 0.9, time: "11:00:00", tags: ["heritage", "culture"] },
      { suffix: "adventure", label: "outdoor adventure", mobility: "high" as const, multiplier: 1.35, time: "08:00:00", tags: ["outdoors", "adventure"] },
    ];
    activityTemplates.forEach((template, activityIndex) => {
      const activityId = `activity:${stopSlug}-${template.suffix}`;
      seed.activities.push({ id: activityId, name: `${stop.name} ${template.label}`, locationId: stop.id, tags: [...template.tags, ...stop.tags.slice(0, 2)], mobility: template.mobility, childFriendly: activityIndex !== 4, seniorFriendly: activityIndex !== 4, imageAssetKey: `activity-${stopSlug}-${template.suffix}` });
      seed.activitySessions.push({ id: `session:${stopSlug}-${template.suffix}`, activityId, operatingWeekdays: everyDay, startsAtLocalTime: template.time, durationMinutes: activityIndex === 4 ? 180 : 120, capacity: 18 + activityIndex * 4, validFrom: supportedFrom, validUntil: supportedUntil, priceAmount: Math.round(definition.activityPrice * template.multiplier), currency: "INR", priceUnit: "per_participant" });
    });

    const transferPrice = definition.region === "india" ? 1_200 : 2_400;
    seed.transfers.push(
      { id: `transfer:${slug(stop.airport.id)}-${stopSlug}`, fromLocationId: stop.airport.id, toLocationId: stop.id, mode: "car", durationMinutes: 45 + stopIndex * 10, capacity: 3, priceAmount: transferPrice, currency: "INR", priceUnit: "per_vehicle" },
      { id: `transfer:${stopSlug}-${slug(stop.airport.id)}`, fromLocationId: stop.id, toLocationId: stop.airport.id, mode: "car", durationMinutes: 45 + stopIndex * 10, capacity: 3, priceAmount: transferPrice, currency: "INR", priceUnit: "per_vehicle" },
      { id: `transfer:${slug(stop.airport.id)}-${stopSlug}-shared`, fromLocationId: stop.airport.id, toLocationId: stop.id, mode: "shared", durationMinutes: 60 + stopIndex * 10, capacity: 8, priceAmount: Math.round(transferPrice * 0.55), currency: "INR", priceUnit: "per_vehicle" },
    );
  }

  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index]; const to = stops[index + 1];
    seed.transfers.push(
      { id: `transfer:${slug(from.id)}-${slug(to.id)}`, fromLocationId: from.id, toLocationId: to.id, mode: "van", durationMinutes: 165, capacity: 6, priceAmount: 4_800, currency: "INR", priceUnit: "per_vehicle" },
      { id: `transfer:${slug(to.id)}-${slug(from.id)}`, fromLocationId: to.id, toLocationId: from.id, mode: "van", durationMinutes: 165, capacity: 6, priceAmount: 4_800, currency: "INR", priceUnit: "per_vehicle" },
    );
  }
  return seed;
}

function merge(seeds: GeneratedInventory[]): GeneratedInventory {
  const merged = emptyInventory();
  for (const seed of seeds) {
    merged.imageAssets.push(...seed.imageAssets); merged.locations.push(...seed.locations); merged.markets.push(...seed.markets); merged.transportServices.push(...seed.transportServices); merged.transportSegments.push(...seed.transportSegments); merged.properties.push(...seed.properties); merged.roomOffers.push(...seed.roomOffers); merged.activities.push(...seed.activities); merged.activitySessions.push(...seed.activitySessions); merged.transfers.push(...seed.transfers);
  }
  return merged;
}

function routeAirport(definition: MarketDefinition, direction: "arrival" | "departure"): AirportDefinition {
  if (definition.stops?.length) {
    return direction === "arrival" ? definition.stops[0].airport : definition.stops.at(-1)!.airport;
  }
  return definition.airport!;
}

function addCrossMarketTransport(seed: GeneratedInventory, definitions: MarketDefinition[]): GeneratedInventory {
  const existingRoutes = new Set(
    seed.transportSegments.map((segment) => `${segment.fromLocationId}->${segment.toLocationId}`),
  );

  for (const fromMarket of definitions) {
    if (fromMarket.region !== "india") continue;
    const fromAirport = routeAirport(fromMarket, "departure");
    for (const toMarket of definitions) {
      if (fromMarket.id === toMarket.id) continue;
      if (toMarket.region !== "india") continue;
      const toAirport = routeAirport(toMarket, "arrival");
      const routeKey = `${fromAirport.id}->${toAirport.id}`;
      if (existingRoutes.has(routeKey)) continue;
      existingRoutes.add(routeKey);

      const distance = distanceKm(fromAirport, toAirport);
      const durationMinutes = Math.max(55, Math.round(distance / 780 * 60 + 35));
      const basePrice = Math.max(
        2_400,
        Math.round((fromMarket.transportPrice + toMarket.transportPrice) / 2 * Math.max(0.45, Math.min(1.45, distance / 1_600))),
      );
      const periods = fromMarket.offsetPeriods.flatMap((fromPeriod) =>
        toMarket.offsetPeriods.flatMap((toPeriod) => {
          if (fromPeriod.outboundOffsetMinutes || fromPeriod.returnOffsetMinutes || toPeriod.outboundOffsetMinutes || toPeriod.returnOffsetMinutes) {
            return [];
          }
          const overlap = intersectPeriods(fromPeriod, toPeriod);
          return overlap ? [{ fromPeriod, toPeriod, overlap }] : [];
        }),
      );

      for (const [periodIndex, { fromPeriod, toPeriod, overlap }] of periods.entries()) {
        const periodKey = periods.length === 1 ? "" : `-p${periodIndex + 1}`;
        [
          { key: "morning", departureMinutes: 540, multiplier: 1, operator: "IndiGo Connect" },
          { key: "evening", departureMinutes: 1_045, multiplier: 0.92, operator: "Air India Connect" },
        ].forEach((variant, variantIndex) => {
          const serviceId = `transport:${slug(fromAirport.id)}-${slug(toAirport.id)}-${variant.key}${periodKey}`;
          const arrival = zonedArrival(
            overlap.from,
            variant.departureMinutes,
            durationMinutes,
            fromMarket.timezone,
            toMarket.timezone,
          );
          seed.transportServices.push({
            id: serviceId,
            mode: "flight",
            operator: variant.operator,
            operatingWeekdays: everyDay,
            validFrom: overlap.from,
            validUntil: overlap.until,
            priceAmount: Math.round(basePrice * variant.multiplier),
            currency: "INR",
            priceUnit: "per_traveller",
          });
          seed.transportSegments.push({
            id: `segment:${slug(fromAirport.id)}-${slug(toAirport.id)}-${variant.key}${periodKey}-0`,
            serviceId,
            segmentIndex: 0,
            fromLocationId: fromAirport.id,
            toLocationId: toAirport.id,
            departureLocalTime: arrival.departureTime,
            arrivalLocalTime: arrival.arrivalLocalTime,
            arrivalDayOffset: arrival.arrivalDayOffset,
            durationMinutes,
            operatorNumber: `${variantIndex % 2 === 0 ? "6E" : "AI"} ${fromMarket.displayOrder}${toMarket.displayOrder}${periodIndex}`,
          });
        });
      }
    }
  }
  return seed;
}

export const generatedMarketInventory = addCrossMarketTransport(
  merge(marketManifest.map(generateMarket)),
  marketManifest,
);
