import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const locationTypeEnum = pgEnum("location_type", [
  "country",
  "state",
  "region",
  "city",
  "airport",
  "neighborhood",
]);

export const marketRegionEnum = pgEnum("market_region", ["india", "international"]);
export const travelModeEnum = pgEnum("travel_mode", ["flight", "train", "bus", "ferry"]);
export const mealPlanEnum = pgEnum("meal_plan", ["none", "breakfast"]);
export const mobilityLoadEnum = pgEnum("mobility_load", ["low", "medium", "high"]);
export const transferModeEnum = pgEnum("transfer_mode", ["car", "van", "shared"]);
export const priceUnitEnum = pgEnum("price_unit", [
  "per_traveller",
  "per_room_per_night",
  "per_participant",
  "per_vehicle",
]);

export const imageAssets = pgTable("image_assets", {
  key: text("key").primaryKey(),
  source: text("source").notNull(),
  sourceId: text("source_id").notNull(),
  url: text("url").notNull(),
  photographer: text("photographer").notNull(),
  photographerUrl: text("photographer_url").notNull(),
  sourceUrl: text("source_url").notNull(),
  altText: text("alt_text").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
});

export const inventoryMeta = pgTable(
  "inventory_meta",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull().unique(),
    seededAt: timestamp("seeded_at", { withTimezone: true, mode: "string" }).notNull(),
    supportedFrom: date("supported_from", { mode: "string" }).notNull(),
    supportedUntil: date("supported_until", { mode: "string" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    dataProvenance: text("data_provenance").notNull().default("synthetic"),
  },
  (table) => [
    check("inventory_meta_date_range_check", sql`${table.supportedUntil} >= ${table.supportedFrom}`),
    check("inventory_meta_currency_check", sql`${table.currency} = 'INR'`),
    check("inventory_meta_provenance_check", sql`${table.dataProvenance} = 'synthetic'`),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: text("id").primaryKey(),
    type: locationTypeEnum("type").notNull(),
    name: text("name").notNull(),
    countryCode: text("country_code").notNull(),
    parentId: text("parent_id").references((): AnyPgColumn => locations.id),
    timezone: text("timezone").notNull(),
    latitudeE6: integer("latitude_e6"),
    longitudeE6: integer("longitude_e6"),
    aliases: text("aliases").array().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    airportCode: text("airport_code"),
    imageAssetKey: text("image_asset_key"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("locations_parent_idx").on(table.parentId),
    index("locations_name_idx").on(table.name),
    uniqueIndex("locations_airport_code_unique").on(table.airportCode),
  ],
);

export const destinationMarkets = pgTable("destination_markets", {
  locationId: text("location_id")
    .primaryKey()
    .references(() => locations.id, { onDelete: "restrict" }),
  region: marketRegionEnum("region").notNull(),
  displayOrder: integer("display_order").notNull(),
});

export const transportServices = pgTable(
  "transport_services",
  {
    id: text("id").primaryKey(),
    mode: travelModeEnum("mode").notNull(),
    operator: text("operator").notNull(),
    operatingWeekdays: integer("operating_weekdays").array().notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    priceAmount: integer("price_amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    priceUnit: priceUnitEnum("price_unit").notNull().default("per_traveller"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("transport_services_validity_idx").on(table.validFrom, table.validUntil),
    check("transport_services_date_range_check", sql`${table.validUntil} >= ${table.validFrom}`),
    check("transport_services_price_check", sql`${table.priceAmount} >= 0`),
    check("transport_services_currency_check", sql`${table.currency} = 'INR'`),
  ],
);

export const transportSegments = pgTable(
  "transport_segments",
  {
    id: text("id").primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => transportServices.id, { onDelete: "cascade" }),
    segmentIndex: integer("segment_index").notNull(),
    fromLocationId: text("from_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    toLocationId: text("to_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    departureLocalTime: time("departure_local_time", { withTimezone: false }).notNull(),
    arrivalLocalTime: time("arrival_local_time", { withTimezone: false }).notNull(),
    arrivalDayOffset: integer("arrival_day_offset").notNull().default(0),
    durationMinutes: integer("duration_minutes").notNull(),
    operatorNumber: text("operator_number"),
  },
  (table) => [
    uniqueIndex("transport_segments_service_order_unique").on(
      table.serviceId,
      table.segmentIndex,
    ),
    index("transport_segments_route_idx").on(table.fromLocationId, table.toLocationId),
    check("transport_segments_index_check", sql`${table.segmentIndex} >= 0`),
    check("transport_segments_duration_check", sql`${table.durationMinutes} > 0`),
    check("transport_segments_day_offset_check", sql`${table.arrivalDayOffset} between 0 and 2`),
  ],
);

export const properties = pgTable(
  "properties",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    ratingTenths: integer("rating_tenths").notNull(),
    reviewCount: integer("review_count").notNull(),
    amenities: text("amenities").array().notNull().default([]),
    accessibility: text("accessibility").array().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    imageAssetKey: text("image_asset_key").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("properties_location_idx").on(table.locationId),
    check("properties_rating_check", sql`${table.ratingTenths} between 0 and 50`),
    check("properties_review_count_check", sql`${table.reviewCount} >= 0`),
  ],
);

export const roomOffers = pgTable(
  "room_offers",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    roomLabel: text("room_label").notNull(),
    maxOccupancy: integer("max_occupancy").notNull(),
    inventoryCount: integer("inventory_count").notNull(),
    mealPlan: mealPlanEnum("meal_plan").notNull(),
    refundable: boolean("refundable").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    priceAmount: integer("price_amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    priceUnit: priceUnitEnum("price_unit").notNull().default("per_room_per_night"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("room_offers_property_idx").on(table.propertyId),
    index("room_offers_validity_idx").on(table.validFrom, table.validUntil),
    check("room_offers_capacity_check", sql`${table.maxOccupancy} > 0 and ${table.inventoryCount} > 0`),
    check("room_offers_date_range_check", sql`${table.validUntil} >= ${table.validFrom}`),
    check("room_offers_price_check", sql`${table.priceAmount} >= 0`),
    check("room_offers_currency_check", sql`${table.currency} = 'INR'`),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    tags: text("tags").array().notNull().default([]),
    mobility: mobilityLoadEnum("mobility").notNull(),
    childFriendly: boolean("child_friendly").notNull(),
    seniorFriendly: boolean("senior_friendly").notNull(),
    imageAssetKey: text("image_asset_key").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [index("activities_location_idx").on(table.locationId)],
);

export const activitySessions = pgTable(
  "activity_sessions",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    operatingWeekdays: integer("operating_weekdays").array().notNull(),
    startsAtLocalTime: time("starts_at_local_time", { withTimezone: false }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    capacity: integer("capacity").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    priceAmount: integer("price_amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    priceUnit: priceUnitEnum("price_unit").notNull().default("per_participant"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("activity_sessions_activity_idx").on(table.activityId),
    index("activity_sessions_validity_idx").on(table.validFrom, table.validUntil),
    check("activity_sessions_duration_check", sql`${table.durationMinutes} > 0`),
    check("activity_sessions_capacity_check", sql`${table.capacity} > 0`),
    check("activity_sessions_date_range_check", sql`${table.validUntil} >= ${table.validFrom}`),
    check("activity_sessions_price_check", sql`${table.priceAmount} >= 0`),
    check("activity_sessions_currency_check", sql`${table.currency} = 'INR'`),
  ],
);

export const transfers = pgTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    fromLocationId: text("from_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    toLocationId: text("to_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    mode: transferModeEnum("mode").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    operatingStartLocalTime: time("operating_start_local_time", { withTimezone: false }),
    operatingEndLocalTime: time("operating_end_local_time", { withTimezone: false }),
    capacity: integer("capacity").notNull(),
    priceAmount: integer("price_amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    priceUnit: priceUnitEnum("price_unit").notNull().default("per_vehicle"),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("transfers_route_idx").on(table.fromLocationId, table.toLocationId),
    check("transfers_duration_check", sql`${table.durationMinutes} > 0`),
    check("transfers_capacity_check", sql`${table.capacity} > 0`),
    check("transfers_price_check", sql`${table.priceAmount} >= 0`),
    check("transfers_currency_check", sql`${table.currency} = 'INR'`),
  ],
);

export const inventoryTables = {
  imageAssets,
  inventoryMeta,
  locations,
  destinationMarkets,
  transportServices,
  transportSegments,
  properties,
  roomOffers,
  activities,
  activitySessions,
  transfers,
};
