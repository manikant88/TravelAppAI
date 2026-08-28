import { config } from "dotenv";
import { createInventoryRepository, inventorySource } from "@/inventory/repository";

config({ path: ".env.local" });
config({ path: ".env" });

async function verifyRuntimeInventory() {
  const repository = createInventoryRepository();
  const [meta, catalog, markets] = await Promise.all([
    repository.getInventoryMeta(),
    repository.getPlannerCatalog(),
    repository.getDestinationMarketProfiles(),
  ]);
  process.stdout.write(`${JSON.stringify({
    source: inventorySource(),
    inventoryVersion: meta.version,
    supportedFrom: meta.supportedFrom,
    supportedUntil: meta.supportedUntil,
    locationCount: catalog.locationGraph.length,
    marketCount: markets.length,
  }, null, 2)}\n`);
}

verifyRuntimeInventory().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
