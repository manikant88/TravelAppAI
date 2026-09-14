import { createHash } from "node:crypto";
import { z } from "zod";
import { stayOfferSchema, type StayOffer } from "@/inventory/contracts";
import {
  type StayProvider,
  StayProviderError,
  type SupplierStaySearchRequest,
  type SupplierStaySearchResult,
} from "@/inventory/providers/stay-provider";

const moneySchema = z.object({ amount: z.number().finite().nonnegative(), currency: z.string().min(3) }).passthrough();
const cancellationSchema = z.object({
  refundableTag: z.string().optional(),
  cancelPolicyInfos: z.array(z.object({ cancelTime: z.string().optional(), amount: z.number().optional(), currency: z.string().optional() }).passthrough()).optional(),
}).passthrough();
const rateSchema = z.object({
  name: z.string().optional(),
  maxOccupancy: z.number().int().positive().optional(),
  boardType: z.string().optional(),
  boardName: z.string().optional(),
  retailRate: z.object({
    total: z.array(moneySchema).default([]),
    taxesAndFees: z.array(z.object({ included: z.boolean().optional(), amount: z.number().optional(), currency: z.string().optional() }).passthrough()).nullish(),
  }).passthrough(),
  cancellationPolicies: cancellationSchema.optional(),
  mappedRoomId: z.union([z.string(), z.number()]).optional(),
}).passthrough();
const roomTypeSchema = z.object({
  roomTypeId: z.union([z.string(), z.number()]).optional(),
  offerId: z.string().min(1),
  rates: z.array(rateSchema).default([]),
  offerRetailRate: moneySchema.optional(),
  suggestedSellingPrice: moneySchema.optional(),
}).passthrough();
const hotelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  main_photo: z.string().url().nullish(),
  thumbnail: z.string().url().nullish(),
  address: z.string().nullish(),
  city_name: z.string().nullish(),
  country_code: z.string().nullish(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  rating: z.number().nonnegative().nullish(),
  stars: z.number().nonnegative().nullish(),
  review_count: z.number().int().nonnegative().nullish(),
  tags: z.array(z.string()).nullish(),
  story: z.string().nullish(),
}).passthrough();
const responseSchema = z.object({
  sandbox: z.boolean().default(false),
  hotels: z.array(hotelSchema).default([]),
  data: z.array(z.object({ hotelId: z.string(), roomTypes: z.array(roomTypeSchema).default([]) }).passthrough()).default([]),
  error: z.object({ code: z.union([z.string(), z.number()]).optional(), message: z.string().optional(), description: z.string().optional() }).passthrough().optional(),
}).passthrough();

function calendarNights(checkIn: string, checkOut: string) {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

function occupancies(travellers: number) {
  const rooms = Math.ceil(travellers / 2);
  return Array.from({ length: rooms }, (_, index) => ({ adults: Math.min(2, travellers - index * 2) }));
}

function inr(money: { amount: number; currency: string } | undefined) {
  return money?.currency.toUpperCase() === "INR" ? money.amount : undefined;
}

function normalizedRating(value = 0) {
  return Math.min(5, value > 5 ? value / 2 : value);
}

function cancellationTerms(rate: z.infer<typeof rateSchema>) {
  const cancellation = rate.cancellationPolicies;
  if (!cancellation) return undefined;
  const refundable = cancellation.refundableTag === "RFN";
  const firstDeadline = cancellation.cancelPolicyInfos?.find(policy => policy.cancelTime)?.cancelTime;
  return {
    refundable,
    summary: refundable
      ? firstDeadline ? `Refundable under the supplier policy; first cancellation deadline ${firstDeadline}.` : "Refundable under the supplier policy; review deadlines during prebook."
      : "Non-refundable under the supplier policy returned for this rate.",
  };
}

function stableOfferId(providerOfferId: string) {
  return `offer:stay:nuitee:${createHash("sha256").update(providerOfferId).digest("hex").slice(0, 24)}`;
}

export function normalizeNuiteeStayResponse(
  raw: unknown,
  request: SupplierStaySearchRequest,
  checkedAt: string,
): SupplierStaySearchResult {
  const response = responseSchema.parse(raw);
  if (response.error) {
    throw new StayProviderError(response.error.description ?? response.error.message ?? `Nuitée error ${response.error.code ?? "unknown"}`);
  }
  const hotelById = new Map(response.hotels.map(hotel => [hotel.id, hotel]));
  const nights = calendarNights(request.checkIn, request.checkOut);
  const rooms = occupancies(request.travellers).length;
  const evidenceKind = response.sandbox ? "sandbox" : "live";
  const offers: StayOffer[] = [];

  for (const hotelRates of response.data) {
    const hotel = hotelById.get(hotelRates.hotelId);
    if (!hotel) continue;
    const roomType = hotelRates.roomTypes.find(candidate => candidate.rates.length > 0);
    const rate = roomType?.rates[0];
    if (!roomType || !rate) continue;
    const customerTotal = inr(roomType.suggestedSellingPrice) ?? inr(roomType.offerRetailRate) ?? inr(rate.retailRate.total[0]);
    if (customerTotal === undefined || nights <= 0 || rooms <= 0) continue;
    const refundable = rate.cancellationPolicies?.refundableTag === "RFN";
    const imageUrl = hotel.main_photo ?? hotel.thumbnail ?? undefined;
    const address = [hotel.address, hotel.city_name, hotel.country_code?.toUpperCase()].filter(Boolean).join(", ");
    const tags = (hotel.tags ?? []).map(tag => tag.trim()).filter(Boolean);
    const breakfastBoardTypes = new Set(["BI", "BB", "HB", "FB", "AI", "BDI", "BLI"]);
    const mealPlan = rate.boardType && breakfastBoardTypes.has(rate.boardType) ? "breakfast" : "none";
    const candidate = {
      schemaVersion: 1,
      kind: "supplier_offer",
      id: stableOfferId(roomType.offerId),
      roomOfferId: String(rate.mappedRoomId ?? roomType.roomTypeId ?? roomType.offerId),
      propertyId: hotel.id,
      locationId: `nuitee:hotel:${hotel.id}`,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      rooms,
      propertyFacts: {
        name: hotel.name,
        rating: normalizedRating(hotel.rating ?? undefined),
        reviewCount: hotel.review_count ?? 0,
        amenities: tags,
        accessibility: [],
        tags,
        imageAssetKey: `nuitee:${hotel.id}`,
        imageUrl,
        imageAltText: imageUrl ? `${hotel.name} supplied by Nuitée Connect` : undefined,
        imageCredit: imageUrl ? "Nuitée Connect" : undefined,
        address: address || undefined,
        latitude: hotel.latitude,
        longitude: hotel.longitude,
        description: hotel.story ?? undefined,
        starRating: hotel.stars == null ? undefined : Math.min(5, hotel.stars),
      },
      roomFacts: {
        roomLabel: rate.name ?? "Room",
        maxOccupancy: rate.maxOccupancy ?? 2,
        mealPlan,
        refundable,
      },
      price: {
        amount: Number((customerTotal / (rooms * nights)).toFixed(2)),
        currency: "INR",
        unit: "per_room_per_night",
      },
      totalPrice: { amount: customerTotal, currency: "INR" },
      availability: "available",
      source: {
        provider: "Nuitée Connect",
        providerOfferId: roomType.offerId,
        evidenceKind,
        checkedAt,
      },
      booking: null,
      cancellationTerms: cancellationTerms(rate),
    };
    const parsed = stayOfferSchema.safeParse(candidate);
    if (parsed.success) offers.push(parsed.data);
  }

  return {
    offers: offers.slice(0, request.limit ?? 8),
    environment: evidenceKind,
    checkedAt,
    assumptions: [
      `${rooms} room${rooms === 1 ? "" : "s"} assumed, with no more than two travellers per room.`,
      `Guest nationality ${request.guestNationality.toUpperCase()} was used for rate eligibility.`,
    ],
  };
}

export function createNuiteeStayProvider(signal: AbortSignal): StayProvider {
  const apiKey = process.env.NUITEE_API_KEY?.trim();
  if (!apiKey) throw new StayProviderError("Nuitée API key is missing. Configure NUITEE_API_KEY.");
  const baseUrl = (process.env.NUITEE_API_BASE_URL?.trim() || "https://api.liteapi.travel").replace(/\/$/, "");
  return {
    async search(request) {
      const checkedAt = new Date().toISOString();
      const response = await fetch(`${baseUrl}/v3.0/hotels/rates`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          occupancies: occupancies(request.travellers),
          currency: request.currency,
          guestNationality: request.guestNationality.toUpperCase(),
          checkin: request.checkIn,
          checkout: request.checkOut,
          maxRatesPerHotel: 1,
          roomMapping: true,
          aiSearch: `hotels in ${request.destination}`,
          includeHotelData: true,
          timeout: 10,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) throw new StayProviderError(`Nuitée request failed (${response.status}).`);
      return normalizeNuiteeStayResponse(body, request, checkedAt);
    },
  };
}
