import { count, eq } from "drizzle-orm";
import { config } from "dotenv";
import { createDatabase } from "@/db/client";
import {
  activities,
  activitySessions,
  destinationMarkets,
  inventoryMeta,
  locations,
  properties,
  roomOffers,
  transfers,
  transportSegments,
  transportServices,
} from "@/db/schema";
import { travelInventorySeed } from "@/db/seed/data";

config({ path: ".env.local" });
config({ path: ".env" });

const expectedCounts = {
  inventoryMeta: travelInventorySeed.meta.length,
  locations: travelInventorySeed.locations.length,
  destinationMarkets: travelInventorySeed.markets.length,
  transportServices: travelInventorySeed.transportServices.length,
  transportSegments: travelInventorySeed.transportSegments.length,
  properties: travelInventorySeed.properties.length,
  roomOffers: travelInventorySeed.roomOffers.length,
  activities: travelInventorySeed.activities.length,
  activitySessions: travelInventorySeed.activitySessions.length,
  transfers: travelInventorySeed.transfers.length,
} as const;

async function tableCount(
  db: ReturnType<typeof createDatabase>,
  table:
    | typeof inventoryMeta
    | typeof locations
    | typeof destinationMarkets
    | typeof transportServices
    | typeof transportSegments
    | typeof properties
    | typeof roomOffers
    | typeof activities
    | typeof activitySessions
    | typeof transfers,
) {
  const [result] = await db.select({ value: count() }).from(table);
  return result.value;
}

async function verifyDatabase() {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required to verify inventory");
  const db = createDatabase(connectionString);

  const counts = {
    inventoryMeta: await tableCount(db, inventoryMeta),
    locations: await tableCount(db, locations),
    destinationMarkets: await tableCount(db, destinationMarkets),
    transportServices: await tableCount(db, transportServices),
    transportSegments: await tableCount(db, transportSegments),
    properties: await tableCount(db, properties),
    roomOffers: await tableCount(db, roomOffers),
    activities: await tableCount(db, activities),
    activitySessions: await tableCount(db, activitySessions),
    transfers: await tableCount(db, transfers),
  };

  for (const [name, expected] of Object.entries(expectedCounts)) {
    const actual = counts[name as keyof typeof counts];
    if (actual !== expected) throw new Error(`${name}: expected ${expected}, found ${actual}`);
  }

  const [meta] = await db.select().from(inventoryMeta).where(eq(inventoryMeta.id, "active"));
  if (!meta || meta.version !== "travel-seed-v2") throw new Error("Active inventory version mismatch");

  const marketRows = await db
    .select({ id: destinationMarkets.locationId, name: locations.name, region: destinationMarkets.region })
    .from(destinationMarkets)
    .innerJoin(locations, eq(destinationMarkets.locationId, locations.id));
  const indiaCount = marketRows.filter((market) => market.region === "india").length;
  const internationalCount = marketRows.filter(
    (market) => market.region === "international",
  ).length;
  if (marketRows.length !== 20 || indiaCount !== 10 || internationalCount !== 10) {
    throw new Error("Expected 10 Indian and 10 international verified markets");
  }

  return {
    counts,
    markets: { total: marketRows.length, india: indiaCount, international: internationalCount },
    inventoryVersion: meta.version,
  };
}

verifyDatabase()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error ? `\nCause: ${error.cause.message}` : "";
    process.stderr.write(`${message}${cause}\n`);
    process.exitCode = 1;
  });
