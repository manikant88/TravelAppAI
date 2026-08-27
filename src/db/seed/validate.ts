import type { InventorySeed } from "@/db/seed/data";

function assertUnique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} ID in seed`);
}

function assertReferences(ids: string[], allowed: Set<string>, label: string) {
  for (const id of ids) {
    if (!allowed.has(id)) throw new Error(`Unknown ${label} reference: ${id}`);
  }
}

function locationScope(seed: InventorySeed, rootId: string): Set<string> {
  const scope = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const location of seed.locations) {
      if (location.parentId && scope.has(location.parentId) && !scope.has(location.id)) {
        scope.add(location.id);
        changed = true;
      }
    }
  }
  return scope;
}

function marketCoverage(seed: InventorySeed, marketId: string) {
  const scope = locationScope(seed, marketId);
  const serviceSegments = new Map<string, InventorySeed["transportSegments"]>();
  for (const segment of seed.transportSegments) {
    const segments = serviceSegments.get(segment.serviceId) ?? [];
    segments.push(segment);
    serviceSegments.set(segment.serviceId, segments);
  }

  let outboundTransport = 0;
  let returnTransport = 0;
  const outboundServices: InventorySeed["transportServices"] = [];
  const returnServices: InventorySeed["transportServices"] = [];
  for (const service of seed.transportServices) {
    const segments = [...(serviceSegments.get(service.id) ?? [])].sort(
      (left, right) => left.segmentIndex - right.segmentIndex,
    );
    const first = segments[0];
    const last = segments.at(-1);
    if (!first || !last) continue;
    if (first.fromLocationId === "airport:del" && scope.has(last.toLocationId)) {
      outboundTransport += 1;
      outboundServices.push(service);
    }
    if (scope.has(first.fromLocationId) && last.toLocationId === "airport:del") {
      returnTransport += 1;
      returnServices.push(service);
    }
  }

  const properties = seed.properties.filter((property) => scope.has(property.locationId));
  const propertyIds = new Set(properties.map((property) => property.id));
  const roomOffers = seed.roomOffers.filter((offer) => propertyIds.has(offer.propertyId));
  const activities = seed.activities.filter((activity) => scope.has(activity.locationId));
  const activityIds = new Set(activities.map((activity) => activity.id));
  const sessions = seed.activitySessions.filter((session) => activityIds.has(session.activityId));
  const airports = new Set(
    seed.locations
      .filter((location) => scope.has(location.id) && location.type === "airport")
      .map((location) => location.id),
  );
  const arrivalTransfers = seed.transfers.filter(
    (transfer) => airports.has(transfer.fromLocationId) && scope.has(transfer.toLocationId),
  );
  const departureTransfers = seed.transfers.filter(
    (transfer) => scope.has(transfer.fromLocationId) && airports.has(transfer.toLocationId),
  );

  return {
    scope,
    outboundTransport,
    returnTransport,
    outboundServices,
    returnServices,
    properties,
    roomOffers,
    activities,
    sessions,
    airports,
    arrivalTransfers,
    departureTransfers,
  };
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
  assertUnique(seed.markets.map((item) => item.locationId), "market");
  assertUnique(seed.markets.map((item) => String(item.displayOrder)), "market display order");
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

  if (seed.markets.length !== 20) throw new Error("P0 inventory must declare exactly 20 markets");
  const indiaMarkets = seed.markets.filter((market) => market.region === "india");
  const internationalMarkets = seed.markets.filter(
    (market) => market.region === "international",
  );
  if (indiaMarkets.length !== 10 || internationalMarkets.length !== 10) {
    throw new Error("P0 inventory requires 10 Indian and 10 international markets");
  }

  for (const market of seed.markets) {
    const coverage = marketCoverage(seed, market.locationId);
    if (coverage.outboundTransport < 2 || coverage.returnTransport < 2) {
      throw new Error(`${market.locationId} requires two outbound and two return choices`);
    }
    const supportedFrom = seed.meta[0].supportedFrom;
    const supportedUntil = seed.meta[0].supportedUntil;
    for (
      let cursor = new Date(`${supportedFrom}T00:00:00.000Z`);
      cursor <= new Date(`${supportedUntil}T00:00:00.000Z`);
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const date = cursor.toISOString().slice(0, 10);
      const weekday = cursor.getUTCDay();
      const available = (services: InventorySeed["transportServices"]) =>
        services.filter(
          (service) =>
            service.validFrom <= date &&
            service.validUntil >= date &&
            service.operatingWeekdays.includes(weekday),
        ).length;
      if (available(coverage.outboundServices) < 2 || available(coverage.returnServices) < 2) {
        throw new Error(`${market.locationId} has a transport coverage gap on ${date}`);
      }
    }
    if (coverage.properties.length < 4 || coverage.roomOffers.length < 6) {
      throw new Error(`${market.locationId} requires four properties and six dated room offers`);
    }
    if (coverage.activities.length < 5 || coverage.sessions.length < 5) {
      throw new Error(`${market.locationId} requires five dated activity choices`);
    }
    if (coverage.airports.size === 0) {
      throw new Error(`${market.locationId} requires an arrival airport`);
    }
    if (coverage.arrivalTransfers.length === 0 || coverage.departureTransfers.length === 0) {
      throw new Error(`${market.locationId} requires arrival and departure transfer coverage`);
    }
  }

  const thailand = marketCoverage(seed, "region:thailand-andaman");
  const thailandStops = seed.locations.filter(
    (location) => location.parentId === "region:thailand-andaman" && location.type === "city",
  );
  if (thailandStops.length !== 2) {
    throw new Error("Thailand market must expose exactly two city stops");
  }
  const [firstStop, secondStop] = thailandStops;
  const hasForwardTransfer = seed.transfers.some(
    (transfer) =>
      transfer.fromLocationId === firstStop.id && transfer.toLocationId === secondStop.id,
  );
  const hasReverseTransfer = seed.transfers.some(
    (transfer) =>
      transfer.fromLocationId === secondStop.id && transfer.toLocationId === firstStop.id,
  );
  if (!thailand.scope.has("airport:hkt") || !thailand.scope.has("airport:kbv")) {
    throw new Error("Thailand market must include normalized Phuket and Krabi airports");
  }
  if (!hasForwardTransfer || !hasReverseTransfer) {
    throw new Error("Thailand market requires bidirectional inter-stop transfer coverage");
  }
}
