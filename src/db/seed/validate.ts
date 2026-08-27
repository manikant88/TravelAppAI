import type { InventorySeed } from "@/db/seed/data";

function assertUnique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} ID in seed`);
}

function assertReferences(ids: string[], allowed: Set<string>, label: string) {
  for (const id of ids) {
    if (!allowed.has(id)) throw new Error(`Unknown ${label} reference: ${id}`);
  }
}

export function validateInventorySeed(seed: InventorySeed): void {
  if (seed.meta.length !== 1) throw new Error("Seed must contain exactly one inventory metadata row");
  if (seed.meta[0].version !== "travel-seed-v1") throw new Error("Unexpected inventory version");

  const locationIds = seed.locations.map((item) => item.id);
  const locationIdSet = new Set(locationIds);
  const serviceIds = seed.transportServices.map((item) => item.id);
  const propertyIds = seed.properties.map((item) => item.id);
  const activityIds = seed.activities.map((item) => item.id);

  assertUnique(locationIds, "location");
  assertUnique(serviceIds, "transport service");
  assertUnique(seed.transportSegments.map((item) => item.id), "transport segment");
  assertUnique(propertyIds, "property");
  assertUnique(seed.roomOffers.map((item) => item.id), "room offer");
  assertUnique(activityIds, "activity");
  assertUnique(seed.activitySessions.map((item) => item.id), "activity session");
  assertUnique(seed.transfers.map((item) => item.id), "transfer");

  assertReferences(
    seed.locations.flatMap((item) => (item.parentId ? [item.parentId] : [])),
    locationIdSet,
    "parent location",
  );
  assertReferences(seed.markets.map((item) => item.locationId), locationIdSet, "market location");
  assertReferences(
    seed.transportSegments.flatMap((item) => [item.fromLocationId, item.toLocationId]),
    locationIdSet,
    "transport location",
  );
  assertReferences(
    seed.transportSegments.map((item) => item.serviceId),
    new Set(serviceIds),
    "transport service",
  );
  assertReferences(
    seed.properties.map((item) => item.locationId),
    locationIdSet,
    "property location",
  );
  assertReferences(
    seed.roomOffers.map((item) => item.propertyId),
    new Set(propertyIds),
    "property",
  );
  assertReferences(
    seed.activities.map((item) => item.locationId),
    locationIdSet,
    "activity location",
  );
  assertReferences(
    seed.activitySessions.map((item) => item.activityId),
    new Set(activityIds),
    "activity",
  );
  assertReferences(
    seed.transfers.flatMap((item) => [item.fromLocationId, item.toLocationId]),
    locationIdSet,
    "transfer location",
  );

  if (seed.markets.length !== 1) throw new Error("The first vertical slice must declare one market");
  if (seed.properties.length < 4) throw new Error("A market requires at least four properties");
  if (seed.roomOffers.length < 6) throw new Error("A market requires at least six room offers");
  if (seed.activities.length < 5) throw new Error("A market requires at least five activities");
  if (seed.transportServices.length < 4) {
    throw new Error("The first market requires outbound and return transport trade-offs");
  }
}
