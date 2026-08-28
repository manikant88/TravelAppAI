CREATE TABLE "image_assets" (
	"key" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"photographer" text NOT NULL,
	"photographer_url" text NOT NULL,
	"source_url" text NOT NULL,
	"alt_text" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL
);
