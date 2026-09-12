import { z } from "zod";

import { isValidISODate } from "@/domain/dates";
import { travelModes } from "@/domain/model";

const isoDateSchema = z.string().refine(isValidISODate, "Expected a valid date in YYYY-MM-DD format");
const availabilitySchema = z.enum(["available", "unavailable", "unknown"]);

export const supplierOfferSourceSchema = z
  .object({
    provider: z.string().trim().min(1),
    providerOfferId: z.string().trim().min(1),
    evidenceKind: z.enum(["live", "sandbox"]),
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.expiresAt && Date.parse(source.expiresAt) < Date.parse(source.checkedAt)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Offer expiry cannot precede its checked time", path: ["expiresAt"] });
    }
  });

export type SupplierOfferSource = z.infer<typeof supplierOfferSourceSchema>;

const bookingSchema = z
  .object({ method: z.enum(["handoff", "managed"]), url: z.string().url().optional() })
  .strict()
  .superRefine((booking, context) => {
    if (booking.method === "handoff" && !booking.url) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Booking handoff requires a URL", path: ["url"] });
    }
  });

const cancellationTermsSchema = z
  .object({ summary: z.string().trim().min(1), refundable: z.boolean().optional() })
  .strict();

const transportSegmentSchema = z
  .object({
    mode: z.enum(travelModes),
    from: z.string().min(1),
    to: z.string().min(1),
    departureAt: z.string().datetime({ offset: true }),
    arrivalAt: z.string().datetime({ offset: true }),
    operator: z.string().min(1),
    number: z.string().min(1).optional(),
  })
  .strict();

export const transportOfferSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("supplier_offer"),
    id: z.string().min(1),
    serviceId: z.string().min(1),
    mode: z.enum(travelModes),
    from: z.string().min(1),
    to: z.string().min(1),
    departureAt: z.string().datetime({ offset: true }),
    arrivalAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().positive(),
    stops: z.number().int().nonnegative(),
    operator: z.string().min(1),
    segments: z.array(transportSegmentSchema).min(1),
    price: z.object({ amount: z.number().finite().nonnegative(), currency: z.literal("INR"), unit: z.literal("per_traveller") }).strict(),
    availability: availabilitySchema,
    source: supplierOfferSourceSchema,
    booking: z.union([z.null(), bookingSchema]),
    cancellationTerms: cancellationTermsSchema.optional(),
    capacity: z.object({ total: z.number().int().positive().optional(), remaining: z.number().int().nonnegative().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((offer, context) => {
    const first = offer.segments[0];
    const last = offer.segments.at(-1);
    if (!first || !last) return;
    if (first.from !== offer.from) context.addIssue({ code: z.ZodIssueCode.custom, message: "First segment must start at offer origin", path: ["segments", 0, "from"] });
    if (last.to !== offer.to) context.addIssue({ code: z.ZodIssueCode.custom, message: "Last segment must end at offer destination", path: ["segments", offer.segments.length - 1, "to"] });
    if (offer.stops !== offer.segments.length - 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "Stops must equal segment count minus one", path: ["stops"] });
    offer.segments.forEach((segment, index) => {
      if (Date.parse(segment.arrivalAt) <= Date.parse(segment.departureAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Segment arrival must follow departure", path: ["segments", index, "arrivalAt"] });
      const next = offer.segments[index + 1];
      if (next && (segment.to !== next.from || Date.parse(next.departureAt) < Date.parse(segment.arrivalAt))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Segments must connect in place and time order", path: ["segments", index + 1] });
    });
    if (Date.parse(offer.departureAt) !== Date.parse(first.departureAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Offer departure must match first segment", path: ["departureAt"] });
    if (Date.parse(offer.arrivalAt) !== Date.parse(last.arrivalAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Offer arrival must match last segment", path: ["arrivalAt"] });
    const elapsed = Math.round((Date.parse(offer.arrivalAt) - Date.parse(offer.departureAt)) / 60_000);
    if (elapsed !== offer.durationMinutes) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duration must match offer timestamps", path: ["durationMinutes"] });
    if (offer.capacity?.total !== undefined && offer.capacity.remaining !== undefined && offer.capacity.remaining > offer.capacity.total) context.addIssue({ code: z.ZodIssueCode.custom, message: "Remaining capacity cannot exceed total capacity", path: ["capacity", "remaining"] });
    if (offer.availability === "available" && offer.capacity?.remaining === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "An available offer cannot have zero remaining capacity", path: ["availability"] });
  });

export type TransportOffer = z.infer<typeof transportOfferSchema>;

const propertyFactsSchema = z
  .object({
    name: z.string().min(1),
    rating: z.number().min(0).max(5),
    reviewCount: z.number().int().nonnegative(),
    amenities: z.array(z.string().min(1)),
    accessibility: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
    imageAssetKey: z.string().min(1),
    imageUrl: z.string().url().optional(),
    imageAltText: z.string().min(1).optional(),
    imageCredit: z.string().min(1).optional(),
    imageCreditUrl: z.string().url().optional(),
    imageSourceUrl: z.string().url().optional(),
    address: z.string().trim().min(1).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    description: z.string().trim().min(1).optional(),
    starRating: z.number().min(0).max(5).optional(),
  })
  .strict();

const roomFactsSchema = z
  .object({
    roomLabel: z.string().min(1),
    maxOccupancy: z.number().int().positive(),
    mealPlan: z.enum(["none", "breakfast"]),
    refundable: z.boolean(),
  })
  .strict();

export const stayOfferSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("supplier_offer"),
    id: z.string().min(1),
    roomOfferId: z.string().min(1),
    propertyId: z.string().min(1),
    locationId: z.string().min(1),
    checkIn: isoDateSchema,
    checkOut: isoDateSchema,
    rooms: z.number().int().positive(),
    propertyFacts: propertyFactsSchema,
    roomFacts: roomFactsSchema,
    price: z.object({ amount: z.number().finite().nonnegative(), currency: z.literal("INR"), unit: z.literal("per_room_per_night") }).strict(),
    totalPrice: z.object({ amount: z.number().finite().nonnegative(), currency: z.literal("INR") }).strict().optional(),
    availability: availabilitySchema,
    source: supplierOfferSourceSchema,
    booking: z.union([z.null(), bookingSchema]),
    cancellationTerms: cancellationTermsSchema.optional(),
  })
  .strict();

export type StayOffer = z.infer<typeof stayOfferSchema>;
