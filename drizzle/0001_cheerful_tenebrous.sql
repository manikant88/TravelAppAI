ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_duration_check" CHECK ("activity_sessions"."duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_capacity_check" CHECK ("activity_sessions"."capacity" > 0);--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_date_range_check" CHECK ("activity_sessions"."valid_until" >= "activity_sessions"."valid_from");--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_price_check" CHECK ("activity_sessions"."price_amount" >= 0);--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_currency_check" CHECK ("activity_sessions"."currency" = 'INR');--> statement-breakpoint
ALTER TABLE "inventory_meta" ADD CONSTRAINT "inventory_meta_date_range_check" CHECK ("inventory_meta"."supported_until" >= "inventory_meta"."supported_from");--> statement-breakpoint
ALTER TABLE "inventory_meta" ADD CONSTRAINT "inventory_meta_currency_check" CHECK ("inventory_meta"."currency" = 'INR');--> statement-breakpoint
ALTER TABLE "inventory_meta" ADD CONSTRAINT "inventory_meta_provenance_check" CHECK ("inventory_meta"."data_provenance" = 'synthetic');--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_rating_check" CHECK ("properties"."rating_tenths" between 0 and 50);--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_review_count_check" CHECK ("properties"."review_count" >= 0);--> statement-breakpoint
ALTER TABLE "room_offers" ADD CONSTRAINT "room_offers_capacity_check" CHECK ("room_offers"."max_occupancy" > 0 and "room_offers"."inventory_count" > 0);--> statement-breakpoint
ALTER TABLE "room_offers" ADD CONSTRAINT "room_offers_date_range_check" CHECK ("room_offers"."valid_until" >= "room_offers"."valid_from");--> statement-breakpoint
ALTER TABLE "room_offers" ADD CONSTRAINT "room_offers_price_check" CHECK ("room_offers"."price_amount" >= 0);--> statement-breakpoint
ALTER TABLE "room_offers" ADD CONSTRAINT "room_offers_currency_check" CHECK ("room_offers"."currency" = 'INR');--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_duration_check" CHECK ("transfers"."duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_capacity_check" CHECK ("transfers"."capacity" > 0);--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_price_check" CHECK ("transfers"."price_amount" >= 0);--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_currency_check" CHECK ("transfers"."currency" = 'INR');--> statement-breakpoint
ALTER TABLE "transport_segments" ADD CONSTRAINT "transport_segments_index_check" CHECK ("transport_segments"."segment_index" >= 0);--> statement-breakpoint
ALTER TABLE "transport_segments" ADD CONSTRAINT "transport_segments_duration_check" CHECK ("transport_segments"."duration_minutes" > 0);--> statement-breakpoint
ALTER TABLE "transport_segments" ADD CONSTRAINT "transport_segments_day_offset_check" CHECK ("transport_segments"."arrival_day_offset" between 0 and 2);--> statement-breakpoint
ALTER TABLE "transport_services" ADD CONSTRAINT "transport_services_date_range_check" CHECK ("transport_services"."valid_until" >= "transport_services"."valid_from");--> statement-breakpoint
ALTER TABLE "transport_services" ADD CONSTRAINT "transport_services_price_check" CHECK ("transport_services"."price_amount" >= 0);--> statement-breakpoint
ALTER TABLE "transport_services" ADD CONSTRAINT "transport_services_currency_check" CHECK ("transport_services"."currency" = 'INR');