import { createHash } from "node:crypto";
import {
  addCalendarDays,
  addMinutesInTimezone,
  calendarDayDifference,
  calendarWeekday,
  isValidISODate,
  localDateTimeWithOffset,
} from "@/domain/dates";
import type { Constraint, ISODate, LocationType } from "@/domain/model";
import type {
  ActivityOffer,
  ActivitySearchRequest,
  LocationSearchQuery,
  LocationSearchResult,
  SearchResponse,
  StayOffer,
  StaySearchRequest,
  TransferOffer,
  TransferSearchRequest,
  TransportOffer,
  TransportSearchRequest,
} from "@/inventory/contracts";
import type {
  ActiveLocationNode,
  ActivityCatalogSession,
  ActivityInventoryRepository,
  LocationInventoryRepository,
  LocationInventoryRow,
  StayCatalogOffer,
  StayInventoryRepository,
  TransferCatalogOffer,
  TransferInventoryRepository,
  TransportCatalogService,
  TransportInventoryRepository,
} from "@/inventory/repository";

const resultLimit = 8;
const typePriority: Record<LocationType, number> = {
  city: 0,
  airport: 1,
  state: 2,
  region: 3,
  country: 4,
  neighborhood: 5,
};

export function normalizeLocationQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function relevance(row: LocationInventoryRow, query: string): number {
  const name = normalizeLocationQuery(row.name);
  const aliases = row.aliases.map(normalizeLocationQuery);
  const airportCode = row.airportCode?.toLocaleLowerCase("en");

  if (name === query) return 0;
  if (airportCode === query) return 1;
  if (aliases.includes(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (aliases.some((alias) => alias.startsWith(query))) return 4;
  if (airportCode?.startsWith(query)) return 5;
  return 6;
}

function orderLocations(rows: LocationInventoryRow[], query: string): LocationInventoryRow[] {
  return [...rows].sort((left, right) => {
    return (
      relevance(left, query) - relevance(right, query) ||
      typePriority[left.type] - typePriority[right.type] ||
      left.name.localeCompare(right.name, "en") ||
      left.id.localeCompare(right.id, "en")
    );
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(stableValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function createQueryId(endpoint: string, inventoryVersion: string, query: unknown): string {
  const normalizedInput = JSON.stringify(
    stableValue({ endpoint, inventoryVersion, query }),
  );
  return `query:${createHash("sha256").update(normalizedInput).digest("hex")}`;
}

export async function searchLocations(
  query: LocationSearchQuery,
  repository: LocationInventoryRepository,
  now: () => Date = () => new Date(),
): Promise<SearchResponse<LocationSearchResult>> {
  const normalizedQuery = normalizeLocationQuery(query.q);
  const [meta, rows] = await Promise.all([
    repository.getInventoryMeta(),
    repository.searchLocations(normalizedQuery),
  ]);
  const results = orderLocations(rows, normalizedQuery)
    .slice(0, resultLimit)
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      countryCode: row.countryCode,
      parentLabel: row.parentLabel,
      airportCode: row.airportCode,
    }));

  return {
    queryId: createQueryId("locations.search", meta.version, { q: normalizedQuery }),
    inventoryVersion: meta.version,
    results,
    resultCount: results.length,
    appliedFilters: [
      {
        type: "location",
        label: `Active locations matching “${normalizedQuery}”`,
      },
    ],
    coverage: results.length > 0 ? { status: "available" } : { status: "unsupported_location" },
    generatedAt: now().toISOString(),
  };
}

function descendantIds(scopeId: string, graph: ActiveLocationNode[]): string[] {
  const nodes = new Map(graph.map((node) => [node.id, node]));

  return graph
    .filter((node) => {
      let current: ActiveLocationNode | undefined = node;
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        if (current.id === scopeId) return true;
        visited.add(current.id);
        current = current.parentId ? nodes.get(current.parentId) : undefined;
      }
      return false;
    })
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function isServiceAvailable(service: TransportCatalogService, date: ISODate): boolean {
  return (
    service.validFrom <= date &&
    service.validUntil >= date &&
    service.operatingWeekdays.includes(calendarWeekday(date))
  );
}

interface TransportOfferPayload {
  kind: "transport";
  serviceId: string;
  date: ISODate;
  inventoryVersion: string;
}

function offerPayloadSignature(encodedPayload: string): string {
  return createHash("sha256").update(encodedPayload).digest("hex").slice(0, 16);
}

function createTransportOfferId(payload: TransportOfferPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `offer:transport:${encodedPayload}.${offerPayloadSignature(encodedPayload)}`;
}

function parseTransportOfferId(offerId: string): TransportOfferPayload {
  const prefix = "offer:transport:";
  if (!offerId.startsWith(prefix)) throw new Error("Unsupported offer ID");
  const [encodedPayload, suppliedSignature, ...extra] = offerId.slice(prefix.length).split(".");
  if (
    !encodedPayload ||
    !suppliedSignature ||
    extra.length > 0 ||
    offerPayloadSignature(encodedPayload) !== suppliedSignature
  ) {
    throw new Error("Invalid transport offer ID");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid transport offer payload");
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    (payload as Record<string, unknown>).kind !== "transport" ||
    typeof (payload as Record<string, unknown>).serviceId !== "string" ||
    typeof (payload as Record<string, unknown>).date !== "string" ||
    !isValidISODate((payload as Record<string, unknown>).date as string) ||
    typeof (payload as Record<string, unknown>).inventoryVersion !== "string"
  ) {
    throw new Error("Invalid transport offer payload");
  }

  return payload as TransportOfferPayload;
}

function buildTransportOffer(
  service: TransportCatalogService,
  date: ISODate,
  inventoryVersion: string,
): TransportOffer {
  if (service.segments.length === 0) throw new Error(`Transport service ${service.id} has no segments`);

  let previousArrivalAt: string | undefined;
  const segments = service.segments.map((segment, index) => {
    let departureDate = index === 0 ? date : (previousArrivalAt?.slice(0, 10) as ISODate);
    let departureAt = localDateTimeWithOffset(
      departureDate,
      segment.departureLocalTime,
      segment.fromTimezone,
    );

    if (previousArrivalAt) {
      while (Date.parse(departureAt) <= Date.parse(previousArrivalAt)) {
        departureDate = addCalendarDays(departureDate, 1);
        departureAt = localDateTimeWithOffset(
          departureDate,
          segment.departureLocalTime,
          segment.fromTimezone,
        );
      }
    }

    const arrivalDate = addCalendarDays(departureDate, segment.arrivalDayOffset);
    const arrivalAt = localDateTimeWithOffset(
      arrivalDate,
      segment.arrivalLocalTime,
      segment.toTimezone,
    );
    if (Date.parse(arrivalAt) <= Date.parse(departureAt)) {
      throw new Error(`Transport segment ${segment.id} has a non-positive elapsed time`);
    }
    const elapsedMinutes = Math.round((Date.parse(arrivalAt) - Date.parse(departureAt)) / 60_000);
    if (elapsedMinutes !== segment.durationMinutes) {
      throw new Error(
        `Transport segment ${segment.id} duration mismatch: expected ${segment.durationMinutes}, calculated ${elapsedMinutes}`,
      );
    }
    previousArrivalAt = arrivalAt;

    return {
      from: segment.fromLocationId,
      to: segment.toLocationId,
      departureAt,
      arrivalAt,
      operator: service.operator,
      number: segment.operatorNumber,
    };
  });

  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  if (!firstSegment || !lastSegment) throw new Error(`Transport service ${service.id} is incomplete`);
  const durationMinutes = Math.round(
    (Date.parse(lastSegment.arrivalAt) - Date.parse(firstSegment.departureAt)) / 60_000,
  );
  if (durationMinutes <= 0) throw new Error(`Transport service ${service.id} has invalid duration`);

  return {
    id: createTransportOfferId({ kind: "transport", serviceId: service.id, date, inventoryVersion }),
    serviceId: service.id,
    mode: service.mode,
    from: firstSegment.from,
    to: lastSegment.to,
    departureAt: firstSegment.departureAt,
    arrivalAt: lastSegment.arrivalAt,
    durationMinutes,
    stops: segments.length - 1,
    operator: service.operator,
    segments,
    price: {
      amount: service.priceAmount,
      currency: service.currency,
      unit: service.priceUnit,
    },
  };
}

type HardTravelConstraint = Extract<Constraint, { category: "travel" }>;

function appliesToTravellers(
  constraint: { travellerIds?: string[] },
  requestedTravellerIds: Set<string>,
): boolean {
  return (
    !constraint.travellerIds ||
    constraint.travellerIds.length === 0 ||
    constraint.travellerIds.some((id) => requestedTravellerIds.has(id))
  );
}

function passesTravelConstraint(offer: TransportOffer, constraint: HardTravelConstraint): boolean {
  const departureTime = offer.departureAt.slice(11, 16);
  const arrivalTime = offer.arrivalAt.slice(11, 16);
  const { value } = constraint;

  return !(
    (value.earliestDeparture && departureTime < value.earliestDeparture) ||
    (value.latestArrival && arrivalTime > value.latestArrival) ||
    (value.allowedModes && !value.allowedModes.includes(offer.mode)) ||
    (value.maxStops !== undefined && offer.stops > value.maxStops)
  );
}

function emptyTransportResponse(
  request: TransportSearchRequest,
  inventoryVersion: string,
  coverage: SearchResponse<TransportOffer>["coverage"],
  appliedFilters: SearchResponse<TransportOffer>["appliedFilters"],
  now: () => Date,
): SearchResponse<TransportOffer> {
  return {
    queryId: createQueryId("inventory.transport.search", inventoryVersion, request),
    inventoryVersion,
    results: [],
    resultCount: 0,
    appliedFilters,
    coverage,
    generatedAt: now().toISOString(),
  };
}

export async function searchTransport(
  request: TransportSearchRequest,
  repository: TransportInventoryRepository,
  now: () => Date = () => new Date(),
): Promise<SearchResponse<TransportOffer>> {
  const [meta, graph] = await Promise.all([
    repository.getInventoryMeta(),
    repository.getActiveLocationGraph(),
  ]);
  const locationIds = new Set(graph.map((node) => node.id));
  const appliedFilters: SearchResponse<TransportOffer>["appliedFilters"] = [
    { type: "location", label: `Route ${request.from} to ${request.to}` },
    { type: "date", label: `Departure date ${request.date}` },
  ];

  if (!locationIds.has(request.from) || !locationIds.has(request.to)) {
    const unsupportedId = !locationIds.has(request.from) ? request.from : request.to;
    return emptyTransportResponse(
      request,
      meta.version,
      { status: "unsupported_location", locationId: unsupportedId },
      appliedFilters,
      now,
    );
  }

  if (request.date < meta.supportedFrom || request.date > meta.supportedUntil) {
    return emptyTransportResponse(
      request,
      meta.version,
      { status: "outside_inventory_window" },
      appliedFilters,
      now,
    );
  }

  const fromLocationIds = descendantIds(request.from, graph);
  const toLocationIds = descendantIds(request.to, graph);
  const catalogServices = await repository.findTransportServices(fromLocationIds, toLocationIds);
  if (catalogServices.length === 0) {
    return emptyTransportResponse(
      request,
      meta.version,
      { status: "unsupported_route" },
      appliedFilters,
      now,
    );
  }

  const availableServices = catalogServices.filter((service) => isServiceAvailable(service, request.date));
  appliedFilters.push({ type: "availability", label: "Active scheduled services" });
  if (availableServices.length === 0) {
    return emptyTransportResponse(
      request,
      meta.version,
      { status: "no_availability" },
      appliedFilters,
      now,
    );
  }

  const requestedTravellerIds = new Set(request.travellers.map((traveller) => traveller.id));
  const hardConstraints = request.constraints.filter(
    (constraint): constraint is HardTravelConstraint =>
      constraint.category === "travel" &&
      constraint.priority === "hard" &&
      appliesToTravellers(constraint, requestedTravellerIds),
  );
  appliedFilters.push(
    ...hardConstraints.map((constraint) => ({
      type: "hard_constraint" as const,
      label: `Applied travel constraint ${constraint.id}`,
      constraintId: constraint.id,
    })),
  );

  const eliminatedConstraintIds = new Set<string>();
  const results = availableServices
    .map((service) => buildTransportOffer(service, request.date, meta.version))
    .filter((offer) =>
      hardConstraints.every((constraint) => {
        const passes = passesTravelConstraint(offer, constraint);
        if (!passes) eliminatedConstraintIds.add(constraint.id);
        return passes;
      }),
    )
    .sort(
      (left, right) =>
        left.price.amount - right.price.amount ||
        left.durationMinutes - right.durationMinutes ||
        left.departureAt.localeCompare(right.departureAt, "en") ||
        left.id.localeCompare(right.id, "en"),
    )
    .slice(0, 8);

  if (results.length === 0) {
    return emptyTransportResponse(
      request,
      meta.version,
      { status: "eliminated_by_constraints", constraintIds: [...eliminatedConstraintIds].sort() },
      appliedFilters,
      now,
    );
  }

  return {
    queryId: createQueryId("inventory.transport.search", meta.version, request),
    inventoryVersion: meta.version,
    results,
    resultCount: results.length,
    appliedFilters,
    coverage: { status: "available" },
    generatedAt: now().toISOString(),
  };
}

interface StayOfferPayload {
  kind: "stay";
  roomOfferId: string;
  checkIn: ISODate;
  checkOut: ISODate;
  rooms: number;
  inventoryVersion: string;
}

function createStayOfferId(payload: StayOfferPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `offer:stay:${encodedPayload}.${offerPayloadSignature(encodedPayload)}`;
}

function parseStayOfferId(offerId: string): StayOfferPayload {
  const prefix = "offer:stay:";
  if (!offerId.startsWith(prefix)) throw new Error("Unsupported offer ID");
  const [encodedPayload, suppliedSignature, ...extra] = offerId.slice(prefix.length).split(".");
  if (
    !encodedPayload ||
    !suppliedSignature ||
    extra.length > 0 ||
    offerPayloadSignature(encodedPayload) !== suppliedSignature
  ) {
    throw new Error("Invalid stay offer ID");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid stay offer payload");
  }
  const record = payload as Record<string, unknown> | null;
  if (
    !record ||
    record.kind !== "stay" ||
    typeof record.roomOfferId !== "string" ||
    typeof record.checkIn !== "string" ||
    !isValidISODate(record.checkIn) ||
    typeof record.checkOut !== "string" ||
    !isValidISODate(record.checkOut) ||
    record.checkOut <= record.checkIn ||
    typeof record.rooms !== "number" ||
    !Number.isInteger(record.rooms) ||
    record.rooms < 1 ||
    typeof record.inventoryVersion !== "string"
  ) {
    throw new Error("Invalid stay offer payload");
  }

  return record as unknown as StayOfferPayload;
}

function isStayAvailable(catalog: StayCatalogOffer, checkIn: ISODate, checkOut: ISODate): boolean {
  const finalNight = addCalendarDays(checkOut, -1);
  return catalog.validFrom <= checkIn && catalog.validUntil >= finalNight;
}

function buildStayOffer(
  catalog: StayCatalogOffer,
  checkIn: ISODate,
  checkOut: ISODate,
  rooms: number,
  inventoryVersion: string,
): StayOffer {
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > catalog.inventoryCount) {
    throw new Error(`Invalid room quantity for ${catalog.roomOfferId}`);
  }

  return {
    id: createStayOfferId({
      kind: "stay",
      roomOfferId: catalog.roomOfferId,
      checkIn,
      checkOut,
      rooms,
      inventoryVersion,
    }),
    roomOfferId: catalog.roomOfferId,
    propertyId: catalog.propertyId,
    locationId: catalog.locationId,
    checkIn,
    checkOut,
    rooms,
    propertyFacts: {
      name: catalog.propertyName,
      rating: catalog.ratingTenths / 10,
      reviewCount: catalog.reviewCount,
      amenities: catalog.amenities,
      accessibility: catalog.accessibility,
      tags: catalog.tags,
      imageAssetKey: catalog.imageAssetKey,
      imageUrl: catalog.imageUrl,
      imageAltText: catalog.imageAltText,
      imageCredit: catalog.imageCredit,
      imageCreditUrl: catalog.imageCreditUrl,
      imageSourceUrl: catalog.imageSourceUrl,
    },
    roomFacts: {
      roomLabel: catalog.roomLabel,
      maxOccupancy: catalog.maxOccupancy,
      mealPlan: catalog.mealPlan,
      refundable: catalog.refundable,
    },
    price: {
      amount: catalog.priceAmount,
      currency: catalog.currency,
      unit: catalog.priceUnit,
    },
  };
}

type HardStayConstraint = Extract<Constraint, { category: "stay" }>;

function passesStayConstraint(offer: StayOffer, constraint: HardStayConstraint): boolean {
  const requiredAmenities = constraint.value.requiredAmenities?.map((amenity) =>
    amenity.trim().toLocaleLowerCase("en"),
  );
  const availableAmenities = new Set(
    offer.propertyFacts.amenities.map((amenity) => amenity.toLocaleLowerCase("en")),
  );

  return !(
    (constraint.value.maxNightlyPrice &&
      offer.price.amount > constraint.value.maxNightlyPrice.amount) ||
    (requiredAmenities && !requiredAmenities.every((amenity) => availableAmenities.has(amenity))) ||
    (constraint.value.seniorFriendly === true &&
      !offer.propertyFacts.tags.includes("senior_friendly"))
  );
}

function emptyStayResponse(
  request: StaySearchRequest,
  inventoryVersion: string,
  coverage: SearchResponse<StayOffer>["coverage"],
  appliedFilters: SearchResponse<StayOffer>["appliedFilters"],
  now: () => Date,
): SearchResponse<StayOffer> {
  return {
    queryId: createQueryId("inventory.stays.search", inventoryVersion, request),
    inventoryVersion,
    results: [],
    resultCount: 0,
    appliedFilters,
    coverage,
    generatedAt: now().toISOString(),
  };
}

export async function searchStays(
  request: StaySearchRequest,
  repository: StayInventoryRepository,
  now: () => Date = () => new Date(),
): Promise<SearchResponse<StayOffer>> {
  const [meta, graph] = await Promise.all([
    repository.getInventoryMeta(),
    repository.getActiveLocationGraph(),
  ]);
  const appliedFilters: SearchResponse<StayOffer>["appliedFilters"] = [
    { type: "location", label: `Stay location ${request.locationId}` },
    { type: "date", label: `Stay dates ${request.checkIn} to ${request.checkOut}` },
  ];
  const locationIds = new Set(graph.map((node) => node.id));
  if (!locationIds.has(request.locationId)) {
    return emptyStayResponse(
      request,
      meta.version,
      { status: "unsupported_location", locationId: request.locationId },
      appliedFilters,
      now,
    );
  }

  const finalNight = addCalendarDays(request.checkOut, -1);
  if (request.checkIn < meta.supportedFrom || finalNight > meta.supportedUntil) {
    return emptyStayResponse(
      request,
      meta.version,
      { status: "outside_inventory_window" },
      appliedFilters,
      now,
    );
  }

  const catalogOffers = await repository.findStayOffers(descendantIds(request.locationId, graph));
  if (catalogOffers.length === 0) {
    return emptyStayResponse(
      request,
      meta.version,
      { status: "unsupported_location", locationId: request.locationId },
      appliedFilters,
      now,
    );
  }

  const datedOffers = catalogOffers.filter((catalog) =>
    isStayAvailable(catalog, request.checkIn, request.checkOut),
  );
  appliedFilters.push({ type: "availability", label: "Rooms available for every occupied night" });
  if (datedOffers.length === 0) {
    return emptyStayResponse(
      request,
      meta.version,
      { status: "no_availability" },
      appliedFilters,
      now,
    );
  }

  const requestedTravellerIds = new Set(request.travellers.map((traveller) => traveller.id));
  const hardConstraints = request.constraints.filter(
    (constraint): constraint is HardStayConstraint =>
      constraint.category === "stay" &&
      constraint.priority === "hard" &&
      appliesToTravellers(constraint, requestedTravellerIds),
  );
  const requiredRoomConstraints = hardConstraints.filter(
    (constraint) => constraint.value.requiredRooms !== undefined,
  );
  const requiredRooms = requiredRoomConstraints.reduce(
    (maximum, constraint) => Math.max(maximum, constraint.value.requiredRooms ?? 0),
    0,
  );
  appliedFilters.push(
    { type: "capacity", label: "Room occupancy and inventory capacity" },
    ...hardConstraints.map((constraint) => ({
      type: "hard_constraint" as const,
      label: `Applied stay constraint ${constraint.id}`,
      constraintId: constraint.id,
    })),
  );

  const eliminatedConstraintIds = new Set<string>();
  const capacityValidOffers = datedOffers.flatMap((catalog) => {
    const rooms =
      requiredRooms > 0 ? requiredRooms : Math.ceil(request.travellers.length / catalog.maxOccupancy);
    const hasCapacity =
      rooms <= catalog.inventoryCount && rooms * catalog.maxOccupancy >= request.travellers.length;
    if (!hasCapacity) {
      requiredRoomConstraints.forEach((constraint) => eliminatedConstraintIds.add(constraint.id));
      return [];
    }
    return [buildStayOffer(catalog, request.checkIn, request.checkOut, rooms, meta.version)];
  });

  if (capacityValidOffers.length === 0) {
    const coverage =
      requiredRoomConstraints.length > 0
        ? {
            status: "eliminated_by_constraints" as const,
            constraintIds: [...eliminatedConstraintIds].sort(),
          }
        : { status: "no_availability" as const };
    return emptyStayResponse(request, meta.version, coverage, appliedFilters, now);
  }

  const nights = calendarDayDifference(request.checkIn, request.checkOut);
  const results = capacityValidOffers
    .filter((offer) =>
      hardConstraints.every((constraint) => {
        const passes = passesStayConstraint(offer, constraint);
        if (!passes) eliminatedConstraintIds.add(constraint.id);
        return passes;
      }),
    )
    .sort((left, right) => {
      const leftTotal = left.price.amount * left.rooms * nights;
      const rightTotal = right.price.amount * right.rooms * nights;
      return (
        leftTotal - rightTotal ||
        right.propertyFacts.rating - left.propertyFacts.rating ||
        left.id.localeCompare(right.id, "en")
      );
    })
    .slice(0, 8);

  if (results.length === 0) {
    return emptyStayResponse(
      request,
      meta.version,
      { status: "eliminated_by_constraints", constraintIds: [...eliminatedConstraintIds].sort() },
      appliedFilters,
      now,
    );
  }

  return {
    queryId: createQueryId("inventory.stays.search", meta.version, request),
    inventoryVersion: meta.version,
    results,
    resultCount: results.length,
    appliedFilters,
    coverage: { status: "available" },
    generatedAt: now().toISOString(),
  };
}

interface ActivityOfferPayload {
  kind: "activity";
  sessionId: string;
  date: ISODate;
  inventoryVersion: string;
}

function createActivityOfferId(payload: ActivityOfferPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `offer:activity:${encodedPayload}.${offerPayloadSignature(encodedPayload)}`;
}

function parseActivityOfferId(offerId: string): ActivityOfferPayload {
  const prefix = "offer:activity:";
  if (!offerId.startsWith(prefix)) throw new Error("Unsupported offer ID");
  const [encodedPayload, suppliedSignature, ...extra] = offerId.slice(prefix.length).split(".");
  if (
    !encodedPayload ||
    !suppliedSignature ||
    extra.length > 0 ||
    offerPayloadSignature(encodedPayload) !== suppliedSignature
  ) {
    throw new Error("Invalid activity offer ID");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid activity offer payload");
  }
  const record = payload as Record<string, unknown> | null;
  if (
    !record ||
    record.kind !== "activity" ||
    typeof record.sessionId !== "string" ||
    typeof record.date !== "string" ||
    !isValidISODate(record.date) ||
    typeof record.inventoryVersion !== "string"
  ) {
    throw new Error("Invalid activity offer payload");
  }

  return record as unknown as ActivityOfferPayload;
}

function isActivityAvailable(session: ActivityCatalogSession, date: ISODate): boolean {
  return (
    session.validFrom <= date &&
    session.validUntil >= date &&
    session.operatingWeekdays.includes(calendarWeekday(date))
  );
}

function buildActivityOffer(
  session: ActivityCatalogSession,
  date: ISODate,
  inventoryVersion: string,
): ActivityOffer {
  const startsAt = localDateTimeWithOffset(date, session.startsAtLocalTime, session.timezone);
  const endsAt = addMinutesInTimezone(startsAt, session.durationMinutes, session.timezone);

  return {
    id: createActivityOfferId({
      kind: "activity",
      sessionId: session.sessionId,
      date,
      inventoryVersion,
    }),
    activityId: session.activityId,
    sessionId: session.sessionId,
    locationId: session.locationId,
    startsAt,
    endsAt,
    capacity: session.capacity,
    activityFacts: {
      name: session.name,
      tags: session.tags,
      mobility: session.mobility,
      childFriendly: session.childFriendly,
      seniorFriendly: session.seniorFriendly,
      imageAssetKey: session.imageAssetKey,
      imageUrl: session.imageUrl,
      imageAltText: session.imageAltText,
      imageCredit: session.imageCredit,
      imageCreditUrl: session.imageCreditUrl,
      imageSourceUrl: session.imageSourceUrl,
    },
    price: {
      amount: session.priceAmount,
      currency: session.currency,
      unit: session.priceUnit,
    },
  };
}

type HardActivityConstraint = Extract<Constraint, { category: "activity" }>;

const mobilityRank = { low: 0, medium: 1, high: 2 } as const;

function passesActivityConstraint(
  offer: ActivityOffer,
  constraint: HardActivityConstraint,
): boolean {
  const { value } = constraint;
  return !(
    (value.maxMobility &&
      mobilityRank[offer.activityFacts.mobility] > mobilityRank[value.maxMobility]) ||
    (value.childFriendly !== undefined &&
      offer.activityFacts.childFriendly !== value.childFriendly) ||
    (value.seniorFriendly !== undefined &&
      offer.activityFacts.seniorFriendly !== value.seniorFriendly)
  );
}

function inclusiveDates(startDate: ISODate, endDate: ISODate): ISODate[] {
  const days = calendarDayDifference(startDate, endDate);
  return Array.from({ length: days + 1 }, (_, index) => addCalendarDays(startDate, index));
}

function interestMatchCount(offer: ActivityOffer, interests: Set<string>): number {
  return offer.activityFacts.tags.reduce(
    (count, tag) => count + (interests.has(tag.toLocaleLowerCase("en")) ? 1 : 0),
    0,
  );
}

function reduceActivityCandidates(
  offers: ActivityOffer[],
  interests: Set<string>,
  limit = 8,
): ActivityOffer[] {
  const byDate = new Map<string, ActivityOffer[]>();
  for (const offer of offers) {
    const date = offer.startsAt.slice(0, 10);
    const candidates = byDate.get(date) ?? [];
    candidates.push(offer);
    byDate.set(date, candidates);
  }

  const dates = [...byDate.keys()].sort();
  dates.forEach((date) => {
    byDate.get(date)?.sort(
      (left, right) =>
        interestMatchCount(right, interests) - interestMatchCount(left, interests) ||
        left.price.amount - right.price.amount ||
        left.startsAt.localeCompare(right.startsAt, "en") ||
        left.id.localeCompare(right.id, "en"),
    );
  });

  const reduced: ActivityOffer[] = [];
  for (let rank = 0; reduced.length < limit; rank += 1) {
    let added = false;
    for (const date of dates) {
      const offer = byDate.get(date)?.[rank];
      if (offer) {
        reduced.push(offer);
        added = true;
        if (reduced.length === limit) break;
      }
    }
    if (!added) break;
  }
  return reduced;
}

function emptyActivityResponse(
  request: ActivitySearchRequest,
  normalizedInterests: string[],
  inventoryVersion: string,
  coverage: SearchResponse<ActivityOffer>["coverage"],
  appliedFilters: SearchResponse<ActivityOffer>["appliedFilters"],
  now: () => Date,
): SearchResponse<ActivityOffer> {
  return {
    queryId: createQueryId("inventory.activities.search", inventoryVersion, {
      ...request,
      interests: normalizedInterests,
    }),
    inventoryVersion,
    results: [],
    resultCount: 0,
    appliedFilters,
    coverage,
    generatedAt: now().toISOString(),
  };
}

export async function searchActivities(
  request: ActivitySearchRequest,
  repository: ActivityInventoryRepository,
  now: () => Date = () => new Date(),
): Promise<SearchResponse<ActivityOffer>> {
  const [meta, graph] = await Promise.all([
    repository.getInventoryMeta(),
    repository.getActiveLocationGraph(),
  ]);
  const normalizedInterests = [
    ...new Set(request.interests.map((interest) => interest.trim().toLocaleLowerCase("en"))),
  ].sort();
  const appliedFilters: SearchResponse<ActivityOffer>["appliedFilters"] = [
    { type: "location", label: `Activity location ${request.locationId}` },
    { type: "date", label: `Activity dates ${request.startDate} to ${request.endDate}` },
  ];
  const locationIds = new Set(graph.map((node) => node.id));
  if (!locationIds.has(request.locationId)) {
    return emptyActivityResponse(
      request,
      normalizedInterests,
      meta.version,
      { status: "unsupported_location", locationId: request.locationId },
      appliedFilters,
      now,
    );
  }
  if (request.startDate < meta.supportedFrom || request.endDate > meta.supportedUntil) {
    return emptyActivityResponse(
      request,
      normalizedInterests,
      meta.version,
      { status: "outside_inventory_window" },
      appliedFilters,
      now,
    );
  }

  const catalogSessions = await repository.findActivitySessions(
    descendantIds(request.locationId, graph),
  );
  if (catalogSessions.length === 0) {
    return emptyActivityResponse(
      request,
      normalizedInterests,
      meta.version,
      { status: "unsupported_location", locationId: request.locationId },
      appliedFilters,
      now,
    );
  }

  const dates = inclusiveDates(request.startDate, request.endDate);
  const datedCandidates = catalogSessions.flatMap((session) =>
    dates
      .filter((date) => isActivityAvailable(session, date))
      .map((date) => ({ session, offer: buildActivityOffer(session, date, meta.version) })),
  );
  appliedFilters.push({ type: "availability", label: "Active recurring sessions" });
  if (datedCandidates.length === 0) {
    return emptyActivityResponse(
      request,
      normalizedInterests,
      meta.version,
      { status: "no_availability" },
      appliedFilters,
      now,
    );
  }

  const capacityValid = datedCandidates.filter(
    ({ session }) => session.capacity >= request.travellers.length,
  );
  appliedFilters.push({ type: "capacity", label: "Participant capacity" });
  if (capacityValid.length === 0) {
    return emptyActivityResponse(
      request,
      normalizedInterests,
      meta.version,
      { status: "no_availability" },
      appliedFilters,
      now,
    );
  }

  const requestedTravellerIds = new Set(request.travellers.map((traveller) => traveller.id));
  const hardConstraints = request.constraints.filter(
    (constraint): constraint is HardActivityConstraint =>
      constraint.category === "activity" &&
      constraint.priority === "hard" &&
      appliesToTravellers(constraint, requestedTravellerIds),
  );
  appliedFilters.push(
    ...hardConstraints.map((constraint) => ({
      type: "hard_constraint" as const,
      label: `Applied activity constraint ${constraint.id}`,
      constraintId: constraint.id,
    })),
  );

  const eliminatedConstraintIds = new Set<string>();
  const hardValidOffers = capacityValid
    .map(({ offer }) => offer)
    .filter((offer) =>
      hardConstraints.every((constraint) => {
        const passes = passesActivityConstraint(offer, constraint);
        if (!passes) eliminatedConstraintIds.add(constraint.id);
        return passes;
      }),
    );
  if (hardValidOffers.length === 0) {
    return emptyActivityResponse(
      request,
      normalizedInterests,
      meta.version,
      { status: "eliminated_by_constraints", constraintIds: [...eliminatedConstraintIds].sort() },
      appliedFilters,
      now,
    );
  }

  const results = reduceActivityCandidates(hardValidOffers, new Set(normalizedInterests));
  return {
    queryId: createQueryId("inventory.activities.search", meta.version, {
      ...request,
      interests: normalizedInterests,
    }),
    inventoryVersion: meta.version,
    results,
    resultCount: results.length,
    appliedFilters,
    coverage: { status: "available" },
    generatedAt: now().toISOString(),
  };
}

interface TransferOfferPayload {
  kind: "transfer";
  transferId: string;
  inventoryVersion: string;
}

function createTransferOfferId(payload: TransferOfferPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `offer:transfer:${encodedPayload}.${offerPayloadSignature(encodedPayload)}`;
}

function parseTransferOfferId(offerId: string): TransferOfferPayload {
  const prefix = "offer:transfer:";
  if (!offerId.startsWith(prefix)) throw new Error("Unsupported offer ID");
  const [encodedPayload, suppliedSignature, ...extra] = offerId.slice(prefix.length).split(".");
  if (
    !encodedPayload ||
    !suppliedSignature ||
    extra.length > 0 ||
    offerPayloadSignature(encodedPayload) !== suppliedSignature
  ) {
    throw new Error("Invalid transfer offer ID");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid transfer offer payload");
  }
  const record = payload as Record<string, unknown> | null;
  if (
    !record ||
    record.kind !== "transfer" ||
    typeof record.transferId !== "string" ||
    typeof record.inventoryVersion !== "string"
  ) {
    throw new Error("Invalid transfer offer payload");
  }

  return record as unknown as TransferOfferPayload;
}

function buildTransferOffer(
  transfer: TransferCatalogOffer,
  inventoryVersion: string,
): TransferOffer {
  return {
    id: createTransferOfferId({
      kind: "transfer",
      transferId: transfer.id,
      inventoryVersion,
    }),
    transferId: transfer.id,
    from: transfer.fromLocationId,
    to: transfer.toLocationId,
    mode: transfer.mode,
    durationMinutes: transfer.durationMinutes,
    capacity: transfer.capacity,
    price: {
      amount: transfer.priceAmount,
      currency: transfer.currency,
      unit: transfer.priceUnit,
    },
  };
}

function emptyTransferResponse(
  request: TransferSearchRequest,
  inventoryVersion: string,
  coverage: SearchResponse<TransferOffer>["coverage"],
  appliedFilters: SearchResponse<TransferOffer>["appliedFilters"],
  now: () => Date,
): SearchResponse<TransferOffer> {
  return {
    queryId: createQueryId("inventory.transfers.search", inventoryVersion, request),
    inventoryVersion,
    results: [],
    resultCount: 0,
    appliedFilters,
    coverage,
    generatedAt: now().toISOString(),
  };
}

export async function searchTransfers(
  request: TransferSearchRequest,
  repository: TransferInventoryRepository,
  now: () => Date = () => new Date(),
): Promise<SearchResponse<TransferOffer>> {
  const [meta, graph] = await Promise.all([
    repository.getInventoryMeta(),
    repository.getActiveLocationGraph(),
  ]);
  const activeLocationIds = new Set(graph.map((node) => node.id));
  const appliedFilters: SearchResponse<TransferOffer>["appliedFilters"] = [
    { type: "location", label: `Transfer route ${request.from} to ${request.to}` },
  ];

  if (!activeLocationIds.has(request.from) || !activeLocationIds.has(request.to)) {
    const unsupportedId = !activeLocationIds.has(request.from) ? request.from : request.to;
    return emptyTransferResponse(
      request,
      meta.version,
      { status: "unsupported_location", locationId: unsupportedId },
      appliedFilters,
      now,
    );
  }

  const catalogTransfers = await repository.findTransfers(request.from, request.to);
  appliedFilters.push({ type: "availability", label: "Active transfer inventory" });
  if (catalogTransfers.length === 0) {
    return emptyTransferResponse(
      request,
      meta.version,
      { status: "unsupported_route" },
      appliedFilters,
      now,
    );
  }

  appliedFilters.push({ type: "capacity", label: "Per-vehicle traveller capacity" });
  const travellerCount = request.travellers.length;
  const results = catalogTransfers
    .map((transfer) => buildTransferOffer(transfer, meta.version))
    .sort((left, right) => {
      const leftTotal = left.price.amount * Math.ceil(travellerCount / left.capacity);
      const rightTotal = right.price.amount * Math.ceil(travellerCount / right.capacity);
      return (
        leftTotal - rightTotal ||
        left.durationMinutes - right.durationMinutes ||
        left.price.amount - right.price.amount ||
        left.id.localeCompare(right.id, "en")
      );
    })
    .slice(0, resultLimit);

  return {
    queryId: createQueryId("inventory.transfers.search", meta.version, request),
    inventoryVersion: meta.version,
    results,
    resultCount: results.length,
    appliedFilters,
    coverage: { status: "available" },
    generatedAt: now().toISOString(),
  };
}

async function resolveTransportOffer(
  offerId: string,
  repository: TransportInventoryRepository,
): Promise<TransportOffer> {
  const payload = parseTransportOfferId(offerId);
  const [meta, service] = await Promise.all([
    repository.getInventoryMeta(),
    repository.findTransportServiceById(payload.serviceId),
  ]);

  if (payload.inventoryVersion !== meta.version) throw new Error("Offer inventory version is stale");
  if (payload.date < meta.supportedFrom || payload.date > meta.supportedUntil) {
    throw new Error("Offer date is outside the inventory window");
  }
  if (!service || !isServiceAvailable(service, payload.date)) {
    throw new Error("Transport offer is no longer available");
  }

  return buildTransportOffer(service, payload.date, meta.version);
}

async function resolveStayOffer(
  offerId: string,
  repository: StayInventoryRepository,
): Promise<StayOffer> {
  const payload = parseStayOfferId(offerId);
  const [meta, catalog] = await Promise.all([
    repository.getInventoryMeta(),
    repository.findStayOfferById(payload.roomOfferId),
  ]);

  if (payload.inventoryVersion !== meta.version) throw new Error("Offer inventory version is stale");
  const finalNight = addCalendarDays(payload.checkOut, -1);
  if (payload.checkIn < meta.supportedFrom || finalNight > meta.supportedUntil) {
    throw new Error("Offer dates are outside the inventory window");
  }
  if (
    !catalog ||
    !isStayAvailable(catalog, payload.checkIn, payload.checkOut) ||
    payload.rooms > catalog.inventoryCount
  ) {
    throw new Error("Stay offer is no longer available");
  }

  return buildStayOffer(
    catalog,
    payload.checkIn,
    payload.checkOut,
    payload.rooms,
    meta.version,
  );
}

async function resolveActivityOffer(
  offerId: string,
  repository: ActivityInventoryRepository,
): Promise<ActivityOffer> {
  const payload = parseActivityOfferId(offerId);
  const [meta, session] = await Promise.all([
    repository.getInventoryMeta(),
    repository.findActivitySessionById(payload.sessionId),
  ]);

  if (payload.inventoryVersion !== meta.version) throw new Error("Offer inventory version is stale");
  if (payload.date < meta.supportedFrom || payload.date > meta.supportedUntil) {
    throw new Error("Offer date is outside the inventory window");
  }
  if (!session || !isActivityAvailable(session, payload.date)) {
    throw new Error("Activity offer is no longer available");
  }

  return buildActivityOffer(session, payload.date, meta.version);
}

async function resolveTransferOffer(
  offerId: string,
  repository: TransferInventoryRepository,
): Promise<TransferOffer> {
  const payload = parseTransferOfferId(offerId);
  const [meta, transfer] = await Promise.all([
    repository.getInventoryMeta(),
    repository.findTransferById(payload.transferId),
  ]);

  if (payload.inventoryVersion !== meta.version) throw new Error("Offer inventory version is stale");
  if (!transfer) throw new Error("Transfer offer is no longer available");

  return buildTransferOffer(transfer, meta.version);
}

export async function resolveOffer(
  offerId: string,
  repository:
    | TransportInventoryRepository
    | StayInventoryRepository
    | ActivityInventoryRepository
    | TransferInventoryRepository,
): Promise<TransportOffer | StayOffer | ActivityOffer | TransferOffer> {
  if (offerId.startsWith("offer:transport:")) {
    return resolveTransportOffer(offerId, repository as TransportInventoryRepository);
  }
  if (offerId.startsWith("offer:stay:")) {
    return resolveStayOffer(offerId, repository as StayInventoryRepository);
  }
  if (offerId.startsWith("offer:activity:")) {
    return resolveActivityOffer(offerId, repository as ActivityInventoryRepository);
  }
  if (offerId.startsWith("offer:transfer:")) {
    return resolveTransferOffer(offerId, repository as TransferInventoryRepository);
  }
  throw new Error("Unsupported offer ID");
}
