import { z } from "zod";
import { constraintSchema, isoDateSchema, travellerSchema } from "@/domain/request";
import type {
  CatalogItemID,
  ISODate,
  ISODateTime,
  LocationID,
  LocationType,
  MobilityLoad,
  OfferID,
  TravelMode,
  UnitPrice,
} from "@/domain/model";

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
  from: LocationID;
  to: LocationID;
  departureAt: ISODateTime;
  arrivalAt: ISODateTime;
  operator: string;
  number?: string;
}

export interface TransportOffer {
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
}

export interface PropertyFacts {
  name: string;
  rating: number;
  reviewCount: number;
  amenities: string[];
  accessibility: string[];
  tags: string[];
  imageAssetKey: string;
}

export interface RoomFacts {
  roomLabel: string;
  maxOccupancy: number;
  mealPlan: "none" | "breakfast";
  refundable: boolean;
}

export interface StayOffer {
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
}

export interface ActivityFacts {
  name: string;
  tags: string[];
  mobility: MobilityLoad;
  childFriendly: boolean;
  seniorFriendly: boolean;
  imageAssetKey: string;
}

export interface ActivityOffer {
  id: OfferID;
  activityId: CatalogItemID;
  sessionId: CatalogItemID;
  locationId: LocationID;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  capacity: number;
  activityFacts: ActivityFacts;
  price: UnitPrice;
}

export interface TransferOffer {
  id: OfferID;
  transferId: CatalogItemID;
  from: LocationID;
  to: LocationID;
  mode: "car" | "van" | "shared";
  durationMinutes: number;
  capacity: number;
  price: UnitPrice;
}

const locationTypes = [
  "country",
  "state",
  "region",
  "city",
  "airport",
  "neighborhood",
] as const;
const travelModes = ["flight", "train", "bus", "ferry"] as const;

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
    amount: z.number().int().nonnegative(),
    currency: z.literal("INR"),
    unit: z.enum(["per_traveller", "per_room_per_night", "per_participant", "per_vehicle"]),
  })
  .strict();

const transportSegmentSchema = z
  .object({
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
  })
  .strict();

const propertyFactsSchema = z
  .object({
    name: z.string().min(1),
    rating: z.number().min(0).max(5),
    reviewCount: z.number().int().nonnegative(),
    amenities: z.array(z.string().min(1)),
    accessibility: z.array(z.string().min(1)),
    tags: z.array(z.string().min(1)),
    imageAssetKey: z.string().min(1),
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
  })
  .strict();

export const activityOfferSchema = z
  .object({
    id: z.string().min(1),
    activityId: z.string().min(1),
    sessionId: z.string().min(1),
    locationId: z.string().min(1),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    capacity: z.number().int().positive(),
    activityFacts: activityFactsSchema,
    price: unitPriceSchema.extend({ unit: z.literal("per_participant") }).strict(),
  })
  .strict();

export const transferOfferSchema = z
  .object({
    id: z.string().min(1),
    transferId: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    mode: z.enum(["car", "van", "shared"]),
    durationMinutes: z.number().int().positive(),
    capacity: z.number().int().positive(),
    price: unitPriceSchema.extend({ unit: z.literal("per_vehicle") }).strict(),
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
