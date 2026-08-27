CREATE TYPE "public"."location_type" AS ENUM('country', 'state', 'region', 'city', 'airport', 'neighborhood');--> statement-breakpoint
CREATE TYPE "public"."market_region" AS ENUM('india', 'international');--> statement-breakpoint
CREATE TYPE "public"."meal_plan" AS ENUM('none', 'breakfast');--> statement-breakpoint
CREATE TYPE "public"."mobility_load" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."price_unit" AS ENUM('per_traveller', 'per_room_per_night', 'per_participant', 'per_vehicle');--> statement-breakpoint
CREATE TYPE "public"."transfer_mode" AS ENUM('car', 'van', 'shared');--> statement-breakpoint
CREATE TYPE "public"."travel_mode" AS ENUM('flight', 'train', 'bus', 'ferry');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location_id" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"mobility" "mobility_load" NOT NULL,
	"child_friendly" boolean NOT NULL,
	"senior_friendly" boolean NOT NULL,
	"image_asset_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"operating_weekdays" integer[] NOT NULL,
	"starts_at_local_time" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"capacity" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"price_amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"price_unit" "price_unit" DEFAULT 'per_participant' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination_markets" (
	"location_id" text PRIMARY KEY NOT NULL,
	"region" "market_region" NOT NULL,
	"display_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_meta" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"seeded_at" timestamp with time zone NOT NULL,
	"supported_from" date NOT NULL,
	"supported_until" date NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"data_provenance" text DEFAULT 'synthetic' NOT NULL,
	CONSTRAINT "inventory_meta_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "location_type" NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"parent_id" text,
	"timezone" text NOT NULL,
	"latitude_e6" integer,
	"longitude_e6" integer,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"airport_code" text,
	"image_asset_key" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location_id" text NOT NULL,
	"rating_tenths" integer NOT NULL,
	"review_count" integer NOT NULL,
	"amenities" text[] DEFAULT '{}' NOT NULL,
	"accessibility" text[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"image_asset_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"room_label" text NOT NULL,
	"max_occupancy" integer NOT NULL,
	"inventory_count" integer NOT NULL,
	"meal_plan" "meal_plan" NOT NULL,
	"refundable" boolean NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"price_amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"price_unit" "price_unit" DEFAULT 'per_room_per_night' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"from_location_id" text NOT NULL,
	"to_location_id" text NOT NULL,
	"mode" "transfer_mode" NOT NULL,
	"duration_minutes" integer NOT NULL,
	"operating_start_local_time" time,
	"operating_end_local_time" time,
	"capacity" integer NOT NULL,
	"price_amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"price_unit" "price_unit" DEFAULT 'per_vehicle' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"segment_index" integer NOT NULL,
	"from_location_id" text NOT NULL,
	"to_location_id" text NOT NULL,
	"departure_local_time" time NOT NULL,
	"arrival_local_time" time NOT NULL,
	"arrival_day_offset" integer DEFAULT 0 NOT NULL,
	"duration_minutes" integer NOT NULL,
	"operator_number" text
);
--> statement-breakpoint
CREATE TABLE "transport_services" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" "travel_mode" NOT NULL,
	"operator" text NOT NULL,
	"operating_weekdays" integer[] NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"price_amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"price_unit" "price_unit" DEFAULT 'per_traveller' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_markets" ADD CONSTRAINT "destination_markets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_offers" ADD CONSTRAINT "room_offers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_segments" ADD CONSTRAINT "transport_segments_service_id_transport_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."transport_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_segments" ADD CONSTRAINT "transport_segments_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_segments" ADD CONSTRAINT "transport_segments_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_location_idx" ON "activities" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "activity_sessions_activity_idx" ON "activity_sessions" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activity_sessions_validity_idx" ON "activity_sessions" USING btree ("valid_from","valid_until");--> statement-breakpoint
CREATE INDEX "locations_parent_idx" ON "locations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "locations_name_idx" ON "locations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_airport_code_unique" ON "locations" USING btree ("airport_code");--> statement-breakpoint
CREATE INDEX "properties_location_idx" ON "properties" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "room_offers_property_idx" ON "room_offers" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "room_offers_validity_idx" ON "room_offers" USING btree ("valid_from","valid_until");--> statement-breakpoint
CREATE INDEX "transfers_route_idx" ON "transfers" USING btree ("from_location_id","to_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_segments_service_order_unique" ON "transport_segments" USING btree ("service_id","segment_index");--> statement-breakpoint
CREATE INDEX "transport_segments_route_idx" ON "transport_segments" USING btree ("from_location_id","to_location_id");--> statement-breakpoint
CREATE INDEX "transport_services_validity_idx" ON "transport_services" USING btree ("valid_from","valid_until");