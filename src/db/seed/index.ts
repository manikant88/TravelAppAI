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
import { udaipurSeed } from "@/db/seed/data";
import { validateInventorySeed } from "@/db/seed/validate";

config({ path: ".env.local" });
config({ path: ".env" });

async function seedInventory() {
  validateInventorySeed(udaipurSeed);

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
    db.insert(inventoryMeta).values(udaipurSeed.meta),
    db.insert(locations).values(udaipurSeed.locations),
    db.insert(destinationMarkets).values(udaipurSeed.markets),
    db.insert(transportServices).values(udaipurSeed.transportServices),
    db.insert(transportSegments).values(udaipurSeed.transportSegments),
    db.insert(properties).values(udaipurSeed.properties),
    db.insert(roomOffers).values(udaipurSeed.roomOffers),
    db.insert(activities).values(udaipurSeed.activities),
    db.insert(activitySessions).values(udaipurSeed.activitySessions),
    db.insert(transfers).values(udaipurSeed.transfers),
  ] as const);
}

seedInventory()
  .then(() => {
    process.stdout.write(`Seeded ${udaipurSeed.markets.length} market with travel-seed-v1\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
