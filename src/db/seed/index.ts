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
import { validateInventorySeed } from "@/db/seed/validate";

config({ path: ".env.local" });
config({ path: ".env" });

async function seedInventory() {
  validateInventorySeed(travelInventorySeed);

  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required to seed inventory");

  const db = createDatabase(connectionString);

  await db.batch([
    db.delete(activitySessions),
    db.delete(activities),
    db.delete(roomOffers),
    db.delete(properties),
    db.delete(transfers),
    db.delete(transportSegments),
    db.delete(transportServices),
    db.delete(destinationMarkets),
    db.delete(locations),
    db.delete(inventoryMeta),
    db.insert(inventoryMeta).values(travelInventorySeed.meta),
    db.insert(locations).values(travelInventorySeed.locations),
    db.insert(destinationMarkets).values(travelInventorySeed.markets),
    db.insert(transportServices).values(travelInventorySeed.transportServices),
    db.insert(transportSegments).values(travelInventorySeed.transportSegments),
    db.insert(properties).values(travelInventorySeed.properties),
    db.insert(roomOffers).values(travelInventorySeed.roomOffers),
    db.insert(activities).values(travelInventorySeed.activities),
    db.insert(activitySessions).values(travelInventorySeed.activitySessions),
    db.insert(transfers).values(travelInventorySeed.transfers),
  ] as const);
}

seedInventory()
  .then(() => {
    process.stdout.write(
      `Seeded ${travelInventorySeed.markets.length} markets with travel-seed-v1\n`,
    );
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
