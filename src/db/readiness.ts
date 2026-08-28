import { createInventoryRepository, inventorySource } from "@/inventory/repository";

export interface InventoryReadiness {
  status: "ready";
  inventoryVersion: string;
  supportedFrom: string;
  supportedUntil: string;
  source: "snapshot" | "hybrid" | "neon";
}

export async function checkInventoryReadiness(
  repository: Pick<ReturnType<typeof createInventoryRepository>, "getInventoryMeta"> =
    createInventoryRepository(),
): Promise<InventoryReadiness> {
  const meta = await repository.getInventoryMeta();
  return {
    status: "ready",
    inventoryVersion: meta.version,
    supportedFrom: meta.supportedFrom,
    supportedUntil: meta.supportedUntil,
    source: inventorySource(),
  };
}
