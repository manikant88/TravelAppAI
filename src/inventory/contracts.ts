import { z } from "zod";
import { constraintSchema, isoDateSchema, travellerSchema } from "@/domain/request";
import {
  travelModes,
  type CatalogItemID,
  type ISODate,
  type ISODateTime,
  type LocationID,
  type LocationType,
  type Money,
  type MobilityLoad,
  type OfferID,
  type TravelMode,
  type UnitPrice,
} from "@/domain/model";
import {
  supplierOfferSourceSchema,
  type SupplierOfferSource,
} from "@/inventory/option-evidence";

export type { SupplierOfferSource } from "@/inventory/option-evidence";

export interface AppliedFilter {
  type: "availability" | "hard_constraint" | "location" | "date" | "capacity";
  label: string;
  constraintId?: string;
}

export type CoverageResult =
  | { status: "available" }
  | { status: "unsupported_location"; locationId?: LocationID }
  | { status: "unsupported_route" }
  | { status: "outside_inventory_window" }
  | { status: "no_availability" }
  | { status: "eliminated_by_constraints"; constraintIds: string[] };

export interface SearchResponse<T> {
  queryId: string;
  inventoryVersion: string;
  results: T[];
  resultCount: number;
  appliedFilters: AppliedFilter[];
  coverage: CoverageResult;
  generatedAt: ISODateTime;
}

export interface LocationSearchResult {
  id: LocationID;
  name: string;
  type: LocationType;
  countryCode: string;
  parentLabel?: string;
  airportCode?: string;
}

export interface TransportSegment {
  mode: TravelMode;
  from: LocationID;
  to: LocationID;
  departureAt: ISODateTime;
  arrivalAt: ISODateTime;
  operator: string;
  number?: string;
}

export interface OfferBooking {
  method: "handoff" | "managed";
  url?: string;
}

export interface OfferCancellationTerms {
  summary: string;
  refundable?: boolean;
}

export interface TransportOffer {
  schemaVersion: 1;
  kind: "supplier_offer";
  id: OfferID;
  serviceId: CatalogItemID;
  mode: TravelMode;
  from: LocationID;
  to: LocationID;
  departureAt: ISODateTime;
  arrivalAt: ISODateTime;
  durationMinutes: number;
  stops: number;
  operator: string;
  segments: TransportSegment[];
  price: UnitPrice;
  availability: "available" | "unavailable" | "unknown";
  source: SupplierOfferSource;
  booking: OfferBooking | null;
  cancellationTerms?: OfferCancellationTerms;
  capacity?: { total?: number; remaining?: number };
}

export interface PropertyFacts {
  name: string;
  rating: number;
  reviewCount: number;
  amenities: string[];
  accessibility: string[];
  tags: string[];
  imageAssetKey: string;
  imageUrl?: string;
  imageAltText?: string;
  imageCredit?: string;
  imageCreditUrl?: string;
  imageSourceUrl?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
  starRating?: number;
}

export interface RoomFacts {
  roomLabel: string;
  maxOccupancy: number;
  mealPlan: "none" | "breakfast";
  refundable: boolean;
}

export interface StayOffer {
  schemaVersion: 1;
  kind: "supplier_offer";
  id: OfferID;
  roomOfferId: CatalogItemID;
  propertyId: CatalogItemID;
  locationId: LocationID;
  checkIn: ISODate;
  checkOut: ISODate;
  rooms: number;
  propertyFacts: PropertyFacts;
  roomFacts: RoomFacts;
  price: UnitPrice;
  /** Exact customer-facing total returned by the supplier for all rooms and nights. */
  totalPrice?: Money;
  availability: "available" | "unavailable" | "unknown";
  source: SupplierOfferSource;
  booking: OfferBooking | null;
  cancellationTerms?: OfferCancellationTerms;
}

export interface ActivityFacts {
  name: string;
  tags: string[];
  mobility: MobilityLoad;
  childFriendly: boolean;
  seniorFriendly: boolean;
  imageAssetKey: string;
  imageUrl?: string;
  imageAltText?: string;
  imageCredit?: string;
  imageCreditUrl?: string;
  imageSourceUrl?: string;
}

export interface ActivityOffer {
  schemaVersion: 1;
  kind: "supplier_offer";
  id: OfferID;
  activityId: CatalogItemID;
  sessionId: CatalogItemID;
  locationId: LocationID;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  capacity: number;
  activityFacts: ActivityFacts;
  price: UnitPrice;
  availability: "available" | "unavailable" | "unknown";
  source: SupplierOfferSource;
  booking: OfferBooking | null;
  cancellationTerms?: OfferCancellationTerms;
}

export interface TransferOffer {
  schemaVersion: 1;
  kind: "supplier_offer";
  id: OfferID;
  transferId: CatalogItemID;
  from: LocationID;
  to: LocationID;
  mode: "car" | "van" | "shared";
  transportMode?: TravelMode;
  durationMinutes: number;
  capacity: number;
  price: UnitPrice;
  availability: "available" | "unavailable" | "unknown";
  source: SupplierOfferSource;
  booking: OfferBooking | null;
  cancellationTerms?: OfferCancellationTerms;
}

const locationTypes = [
  "country",
  "state",
  "region",
  "city",
  "airport",
  "neighborhood",
] as const;

export const locationSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1, "Enter a location").max(80, "Location query is too long"),
  })
  .strict();

export type LocationSearchQuery = z.infer<typeof locationSearchQuerySchema>;

export const transportSearchRequestSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    date: isoDateSchema,
    travellers: z.array(travellerSchema).min(1),
    constraints: z.array(constraintSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const travellerIds = value.travellers.map((traveller) => traveller.id);
    if (new Set(travellerIds).size !== travellerIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Traveller IDs must be unique", path: ["travellers"] });
    }

    const constraintIds = value.constraints.map((constraint) => constraint.id);
    if (new Set(constraintIds).size !== constraintIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Constraint IDs must be unique", path: ["constraints"] });
    }

    const knownTravellerIds = new Set(travellerIds);
    value.constraints.forEach((constraint, constraintIndex) => {
      constraint.travellerIds?.forEach((travellerId) => {
        if (!knownTravellerIds.has(travellerId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown traveller ID: ${travellerId}`,
            path: ["constraints", constraintIndex, "travellerIds"],
          });
        }
      });
    });
  });

export type TransportSearchRequest = z.infer<typeof transportSearchRequestSchema>;

export const staySearchRequestSchema = z
  .object({
    locationId: z.string().min(1),
    checkIn: isoDateSchema,
    checkOut: isoDateSchema,
    travellers: z.array(travellerSchema).min(1),
    constraints: z.array(constraintSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.checkOut <= value.checkIn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Check-out must be after check-in",
        path: ["checkOut"],
      });
    }

    const travellerIds = value.travellers.map((traveller) => traveller.id);
    if (new Set(travellerIds).size !== travellerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Traveller IDs must be unique",
        path: ["travellers"],
      });
    }

    const constraintIds = value.constraints.map((constraint) => constraint.id);
    if (new Set(constraintIds).size !== constraintIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Constraint IDs must be unique",
        path: ["constraints"],
      });
    }

    const knownTravellerIds = new Set(travellerIds);
    value.constraints.forEach((constraint, constraintIndex) => {
      constraint.travellerIds?.forEach((travellerId) => {
        if (!knownTravellerIds.has(travellerId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown traveller ID: ${travellerId}`,
            path: ["constraints", constraintIndex, "travellerIds"],
          });
        }
      });
    });
  });

export type StaySearchRequest = z.infer<typeof staySearchRequestSchema>;

export const activitySearchRequestSchema = z
  .object({
    locationId: z.string().min(1),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    travellers: z.array(travellerSchema).min(1),
    interests: z.array(z.string().trim().min(1)).max(20),
    constraints: z.array(constraintSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Activity end date must not be before start date",
        path: ["endDate"],
      });
    }

    const travellerIds = value.travellers.map((traveller) => traveller.id);
    if (new Set(travellerIds).size !== travellerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Traveller IDs must be unique",
        path: ["travellers"],
      });
    }

    const constraintIds = value.constraints.map((constraint) => constraint.id);
    if (new Set(constraintIds).size !== constraintIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Constraint IDs must be unique",
        path: ["constraints"],
      });
    }

    const knownTravellerIds = new Set(travellerIds);
    value.constraints.forEach((constraint, constraintIndex) => {
      constraint.travellerIds?.forEach((travellerId) => {
        if (!knownTravellerIds.has(travellerId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown traveller ID: ${travellerId}`,
            path: ["constraints", constraintIndex, "travellerIds"],
          });
        }
      });
    });
  });

export type ActivitySearchRequest = z.infer<typeof activitySearchRequestSchema>;

export const transferSearchRequestSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    travellers: z.array(travellerSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from === value.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transfer origin and destination must differ",
        path: ["to"],
      });
    }

    const travellerIds = value.travellers.map((traveller) => traveller.id);
    if (new Set(travellerIds).size !== travellerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Traveller IDs must be unique",
        path: ["travellers"],
      });
    }
  });

export type TransferSearchRequest = z.infer<typeof transferSearchRequestSchema>;

export const locationSearchResultSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(locationTypes),
    countryCode: z.string().length(2),
    parentLabel: z.string().min(1).optional(),
    airportCode: z.string().min(3).max(4).optional(),
  })
  .strict();

const appliedFilterSchema = z
  .object({
    type: z.enum(["availability", "hard_constraint", "location", "date", "capacity"]),
    label: z.string().min(1),
    constraintId: z.string().min(1).optional(),
  })
  .strict();

export const coverageResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available") }).strict(),
  z
    .object({ status: z.literal("unsupported_location"), locationId: z.string().min(1).optional() })
    .strict(),
  z.object({ status: z.literal("unsupported_route") }).strict(),
  z.object({ status: z.literal("outside_inventory_window") }).strict(),
  z.object({ status: z.literal("no_availability") }).strict(),
  z
    .object({
      status: z.literal("eliminated_by_constraints"),
      constraintIds: z.array(z.string().min(1)),
    })
    .strict(),
]);

const unitPriceSchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: z.literal("INR"),
    unit: z.enum(["per_traveller", "per_room_per_night", "per_participant", "per_vehicle"]),
  })
  .strict();

const offerBookingSchema = z.object({
  method: z.enum(["handoff", "managed"]),
  url: z.string().url().optional(),
}).strict().superRefine((booking, context) => {
  if (booking.method === "handoff" && !booking.url) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Booking handoff requires a URL", path: ["url"] });
  }
});

const cancellationTermsSchema = z.object({
  summary: z.string().trim().min(1),
  refundable: z.boolean().optional(),
}).strict();

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
    price: unitPriceSchema.extend({ unit: z.literal("per_traveller") }).strict(),
    availability: z.enum(["available", "unavailable", "unknown"]),
    source: supplierOfferSourceSchema,
    booking: z.union([z.null(), offerBookingSchema]),
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
    price: unitPriceSchema.extend({ unit: z.literal("per_room_per_night") }).strict(),
    totalPrice: z.object({ amount: z.number().finite().nonnegative(), currency: z.literal("INR") }).strict().optional(),
    availability: z.enum(["available", "unavailable", "unknown"]),
    source: supplierOfferSourceSchema,
    booking: z.union([z.null(), offerBookingSchema]),
    cancellationTerms: cancellationTermsSchema.optional(),
  })
  .strict();

const activityFactsSchema = z
  .object({
    name: z.string().min(1),
    tags: z.array(z.string().min(1)),
    mobility: z.enum(["low", "medium", "high"]),
    childFriendly: z.boolean(),
    seniorFriendly: z.boolean(),
    imageAssetKey: z.string().min(1),
    imageUrl: z.string().url().optional(),
    imageAltText: z.string().min(1).optional(),
    imageCredit: z.string().min(1).optional(),
    imageCreditUrl: z.string().url().optional(),
    imageSourceUrl: z.string().url().optional(),
  })
  .strict();

export const activityOfferSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("supplier_offer"),
    id: z.string().min(1),
    activityId: z.string().min(1),
    sessionId: z.string().min(1),
    locationId: z.string().min(1),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    capacity: z.number().int().positive(),
    activityFacts: activityFactsSchema,
    price: unitPriceSchema.extend({ unit: z.literal("per_participant") }).strict(),
    availability: z.enum(["available", "unavailable", "unknown"]),
    source: supplierOfferSourceSchema,
    booking: z.union([z.null(), offerBookingSchema]),
    cancellationTerms: cancellationTermsSchema.optional(),
  })
  .strict();

export const transferOfferSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("supplier_offer"),
    id: z.string().min(1),
    transferId: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    mode: z.enum(["car", "van", "shared"]),
    transportMode: z.enum(travelModes).optional(),
    durationMinutes: z.number().int().positive(),
    capacity: z.number().int().positive(),
    price: unitPriceSchema.extend({ unit: z.enum(["per_vehicle", "per_traveller"]) }).strict(),
    availability: z.enum(["available", "unavailable", "unknown"]),
    source: supplierOfferSourceSchema,
    booking: z.union([z.null(), offerBookingSchema]),
    cancellationTerms: cancellationTermsSchema.optional(),
  })
  .strict();

function createSearchResponseSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z
    .object({
      queryId: z.string().min(1),
      inventoryVersion: z.string().min(1),
      results: z.array(resultSchema),
      resultCount: z.number().int().nonnegative(),
      appliedFilters: z.array(appliedFilterSchema),
      coverage: coverageResultSchema,
      generatedAt: z.string().datetime({ offset: true }),
    })
    .strict()
    .refine((value) => value.resultCount === value.results.length, {
      message: "resultCount must equal results.length",
      path: ["resultCount"],
    });
}

export const locationSearchResponseSchema = createSearchResponseSchema(locationSearchResultSchema);
export const transportSearchResponseSchema = createSearchResponseSchema(transportOfferSchema);
export const staySearchResponseSchema = createSearchResponseSchema(stayOfferSchema);
export const activitySearchResponseSchema = createSearchResponseSchema(activityOfferSchema);
export const transferSearchResponseSchema = createSearchResponseSchema(transferOfferSchema);

export const requestValidationErrorSchema = z
  .object({
    code: z.literal("INVALID_REQUEST"),
    message: z.string().min(1),
    retryable: z.literal(false),
  })
  .strict();

export const databaseFailureSchema = z
  .object({
    code: z.literal("DATABASE_FAILURE"),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();
