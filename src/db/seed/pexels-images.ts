import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/db/client";
import { imageAssets } from "@/db/schema";
import { travelInventorySeed } from "@/db/seed/data";

config({ path: ".env.local" });
config({ path: ".env" });

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  src: {
    large2x?: string;
    large?: string;
    medium?: string;
    landscape?: string;
  };
  alt?: string;
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
}

interface ImageTarget {
  key: string;
  query: string;
  altText: string;
  category: "market" | "stay" | "activity";
}

function locationName(locationId: string): string {
  return travelInventorySeed.locations.find((location) => location.id === locationId)?.name ?? locationId.split(":").at(-1) ?? locationId;
}

function uniqueTargets(): ImageTarget[] {
  const targets = new Map<string, ImageTarget>();

  for (const location of travelInventorySeed.locations) {
    if (location.imageAssetKey) {
      targets.set(location.imageAssetKey, {
        key: location.imageAssetKey,
        query: `${location.name} travel destination`,
        altText: `${location.name} travel destination`,
        category: "market",
      });
    }
  }

  for (const property of travelInventorySeed.properties) {
    const place = locationName(property.locationId);
    const tags = property.tags ?? [];
    const vibe = tags.includes("luxury")
      ? "luxury hotel exterior"
      : tags.includes("family")
        ? "family hotel room"
        : tags.includes("heritage")
          ? "heritage boutique hotel"
          : tags.includes("quiet")
            ? "quiet hotel room"
            : "hotel room";
    targets.set(property.imageAssetKey, {
      key: property.imageAssetKey,
      query: `${place} ${vibe} travel`,
      altText: `${property.name} stay in ${place}`,
      category: "stay",
    });
  }

  for (const activity of travelInventorySeed.activities) {
    const place = locationName(activity.locationId);
    const tags = activity.tags ?? [];
    const theme = tags.includes("food")
      ? "street food market"
      : tags.includes("heritage")
        ? "heritage landmark walking tour"
        : tags.includes("adventure")
          ? "outdoor adventure activity"
          : tags.includes("relaxed")
            ? "relaxed local travel experience"
            : tags.includes("culture")
              ? "cultural travel experience"
              : "travel activity";
    targets.set(activity.imageAssetKey, {
      key: activity.imageAssetKey,
      query: `${place} ${theme}`,
      altText: `${activity.name} in ${place}`,
      category: "activity",
    });
  }

  return [...targets.values()].sort((left, right) => left.key.localeCompare(right.key, "en"));
}

function photoUrl(photo: PexelsPhoto): string {
  return photo.src.large2x ?? photo.src.large ?? photo.src.landscape ?? photo.src.medium ?? photo.url;
}

async function searchPexels(
  target: ImageTarget,
  apiKey: string,
  usedPhotoIds: Set<number>,
): Promise<PexelsPhoto> {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", target.query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("per_page", process.env.PEXELS_RESULTS_PER_TARGET ?? "8");

  const response = await fetch(url, { headers: { Authorization: apiKey } });
  if (!response.ok) {
    throw new Error(`Pexels request failed for ${target.key}: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as PexelsSearchResponse;
  const validPhotos = body.photos.filter((photo) => Boolean(photoUrl(photo)));
  const photo = validPhotos.find((candidate) => !usedPhotoIds.has(candidate.id)) ?? validPhotos[0];
  if (!photo) throw new Error(`Pexels returned no photos for ${target.key} (${target.query})`);
  usedPhotoIds.add(photo.id);
  return photo;
}

async function main() {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY is required");

  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required");

  const limit = process.env.PEXELS_IMAGE_LIMIT ? Number(process.env.PEXELS_IMAGE_LIMIT) : undefined;
  const targets = uniqueTargets().slice(0, limit);
  const db = createDatabase(connectionString);
  let written = 0;
  const usedPhotoIds = new Set<number>();

  for (const target of targets) {
    const photo = await searchPexels(target, apiKey, usedPhotoIds);
    const url = photoUrl(photo);
    await db
      .insert(imageAssets)
      .values({
        key: target.key,
        source: "pexels",
        sourceId: String(photo.id),
        url,
        photographer: photo.photographer,
        photographerUrl: photo.photographer_url,
        sourceUrl: photo.url,
        altText: photo.alt || target.altText,
        width: photo.width,
        height: photo.height,
      })
      .onConflictDoUpdate({
        target: imageAssets.key,
        set: {
          source: "pexels",
          sourceId: String(photo.id),
          url,
          photographer: photo.photographer,
          photographerUrl: photo.photographer_url,
          sourceUrl: photo.url,
          altText: photo.alt || target.altText,
          width: photo.width,
          height: photo.height,
        },
      });
    written += 1;
    process.stdout.write(`Saved image ${written}/${targets.length}: ${target.key}\n`);
  }

  const [count] = await db.select({ key: imageAssets.key }).from(imageAssets).where(eq(imageAssets.source, "pexels"));
  process.stdout.write(`Pexels image import complete. Processed ${written} assets.\n`);
  if (!count) process.stdout.write("No Pexels rows were found after import.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
