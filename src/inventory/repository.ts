import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getRuntimeDatabase } from "@/db/client";
import {
  activities,
  activitySessions,
  destinationMarkets,
  imageAssets,
  inventoryMeta,
  locations,
  properties,
  roomOffers,
  transfers,
  transportSegments,
  transportServices,
} from "@/db/schema";
import type {
  ISODate,
  LocalTime,
  LocationType,
  MobilityLoad,
  TravelMode,
} from "@/domain/model";
import { createSnapshotInventoryRepository } from "@/inventory/snapshot-repository";

export interface InventoryMetaSnapshot {
  version: string;
  supportedFrom: ISODate;
  supportedUntil: ISODate;
}

export interface LocationInventoryRow {
  id: string;
  name: string;
  type: LocationType;
  countryCode: string;
  parentLabel?: string;
  aliases: string[];
  airportCode?: string;
}

export interface LocationInventoryRepository {
  getInventoryMeta(): Promise<InventoryMetaSnapshot>;
  searchLocations(normalizedQuery: string): Promise<LocationInventoryRow[]>;
}

export interface ActiveLocationNode {
  id: string;
  parentId?: string;
  name?: string;
  type?: LocationType;
  tags?: string[];
  timezone: string;
}

export interface PlannerCatalogSnapshot {
  inventoryVersion: string;
  locationGraph: ActiveLocationNode[];
  marketIds: string[];
  supportedThemes: string[];
}

export interface PlannerCatalogRepository {
  getPlannerCatalog(): Promise<PlannerCatalogSnapshot>;
}

export interface DestinationMarketProfile {
  id: string;
  name: string;
  countryCode: string;
  region: "india" | "international";
  displayOrder: number;
  tags: string[];
  imageAssetKey?: string;
  imageUrl?: string;
  imageAltText?: string;
}

export interface DestinationDiscoveryRepository {
  getDestinationMarketProfiles(): Promise<DestinationMarketProfile[]>;
}

export interface TransportCatalogSegment {
  id: string;
  segmentIndex: number;
  fromLocationId: string;
  toLocationId: string;
  fromTimezone: string;
  toTimezone: string;
  departureLocalTime: LocalTime;
  arrivalLocalTime: LocalTime;
  arrivalDayOffset: number;
  durationMinutes: number;
  operatorNumber?: string;
}

export interface TransportCatalogService {
  id: string;
  mode: TravelMode;
  operator: string;
  operatingWeekdays: number[];
  validFrom: ISODate;
  validUntil: ISODate;
  priceAmount: number;
  currency: "INR";
  priceUnit: "per_traveller";
  segments: TransportCatalogSegment[];
}

export interface TransportInventoryRepository {
  getInventoryMeta(): Promise<InventoryMetaSnapshot>;
  getActiveLocationGraph(): Promise<ActiveLocationNode[]>;
  findTransportServices(
    fromLocationIds: string[],
    toLocationIds: string[],
  ): Promise<TransportCatalogService[]>;
  findTransportServiceById(serviceId: string): Promise<TransportCatalogService | undefined>;
}

export interface StayCatalogOffer {
  roomOfferId: string;
  propertyId: string;
  locationId: string;
  propertyName: string;
  ratingTenths: number;
  reviewCount: number;
  amenities: string[];
  accessibility: string[];
  tags: string[];
  imageAssetKey: string;
  imageUrl?: string;
  imageAltText?: string;
  imageCredit?: string;
  imageCreditUrl?: string;
  imageSourceUrl?: string;
  roomLabel: string;
  maxOccupancy: number;
  inventoryCount: number;
  mealPlan: "none" | "breakfast";
  refundable: boolean;
  validFrom: ISODate;
  validUntil: ISODate;
  priceAmount: number;
  currency: "INR";
  priceUnit: "per_room_per_night";
}

export interface StayInventoryRepository {
  getInventoryMeta(): Promise<InventoryMetaSnapshot>;
  getActiveLocationGraph(): Promise<ActiveLocationNode[]>;
  findStayOffers(locationIds: string[]): Promise<StayCatalogOffer[]>;
  findStayOfferById(roomOfferId: string): Promise<StayCatalogOffer | undefined>;
}

export interface ActivityCatalogSession {
  sessionId: string;
  activityId: string;
  locationId: string;
  timezone: string;
  name: string;
  tags: string[];
  mobility: MobilityLoad;
  childFriendly: boolean;
  seniorFriendly: boolean;
  imageAssetKey: string;
  imageUrl?: string;
  imageAltText?: string;
  imageCredit?: string;
  imageCreditUrl?: string;
  imageSourceUrl?: string;
  operatingWeekdays: number[];
  startsAtLocalTime: LocalTime;
  durationMinutes: number;
  capacity: number;
  validFrom: ISODate;
  validUntil: ISODate;
  priceAmount: number;
  currency: "INR";
  priceUnit: "per_participant";
}

export interface ActivityInventoryRepository {
  getInventoryMeta(): Promise<InventoryMetaSnapshot>;
  getActiveLocationGraph(): Promise<ActiveLocationNode[]>;
  findActivitySessions(locationIds: string[]): Promise<ActivityCatalogSession[]>;
  findActivitySessionById(sessionId: string): Promise<ActivityCatalogSession | undefined>;
}

export interface TransferCatalogOffer {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  mode: "car" | "van" | "shared";
  durationMinutes: number;
  operatingStartLocalTime?: LocalTime;
  operatingEndLocalTime?: LocalTime;
  capacity: number;
  priceAmount: number;
  currency: "INR";
  priceUnit: "per_vehicle";
}

export interface TransferInventoryRepository {
  getInventoryMeta(): Promise<InventoryMetaSnapshot>;
  getActiveLocationGraph(): Promise<ActiveLocationNode[]>;
  findTransfers(fromLocationId: string, toLocationId: string): Promise<TransferCatalogOffer[]>;
  findTransferById(transferId: string): Promise<TransferCatalogOffer | undefined>;
}

type Database = ReturnType<typeof getRuntimeDatabase>;

export type InventoryRepository = LocationInventoryRepository &
  PlannerCatalogRepository &
  DestinationDiscoveryRepository &
  TransportInventoryRepository &
  StayInventoryRepository &
  ActivityInventoryRepository &
  TransferInventoryRepository;

function createNeonInventoryRepository(database: Database): InventoryRepository {
  const parentLocation = alias(locations, "parent_location");
  const routeFromSegment = alias(transportSegments, "route_from_segment");
  const routeToSegment = alias(transportSegments, "route_to_segment");
  const segmentFromLocation = alias(locations, "segment_from_location");
  const segmentToLocation = alias(locations, "segment_to_location");

  async function getInventoryMeta() {
    const rows = await database
      .select({
        version: inventoryMeta.version,
        supportedFrom: inventoryMeta.supportedFrom,
        supportedUntil: inventoryMeta.supportedUntil,
      })
      .from(inventoryMeta)
      .limit(2);

    if (rows.length !== 1) {
      throw new Error(`Expected one inventory metadata row, found ${rows.length}`);
    }

    return rows[0];
  }

  function groupTransportRows(
    rows: Array<{
      serviceId: string;
      mode: TravelMode;
      operator: string;
      operatingWeekdays: number[];
      validFrom: ISODate;
      validUntil: ISODate;
      priceAmount: number;
      currency: string;
      priceUnit: string;
      segmentId: string;
      segmentIndex: number;
      fromLocationId: string;
      toLocationId: string;
      fromTimezone: string;
      toTimezone: string;
      departureLocalTime: string;
      arrivalLocalTime: string;
      arrivalDayOffset: number;
      durationMinutes: number;
      operatorNumber: string | null;
    }>,
  ): TransportCatalogService[] {
    const services = new Map<string, TransportCatalogService>();

    for (const row of rows) {
      if (row.currency !== "INR" || row.priceUnit !== "per_traveller") {
        throw new Error(`Invalid transport price contract for ${row.serviceId}`);
      }

      let service = services.get(row.serviceId);
      if (!service) {
        service = {
          id: row.serviceId,
          mode: row.mode,
          operator: row.operator,
          operatingWeekdays: row.operatingWeekdays,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
          priceAmount: row.priceAmount,
          currency: "INR",
          priceUnit: "per_traveller",
          segments: [],
        };
        services.set(row.serviceId, service);
      }

      if (!service.segments.some((segment) => segment.id === row.segmentId)) {
        service.segments.push({
          id: row.segmentId,
          segmentIndex: row.segmentIndex,
          fromLocationId: row.fromLocationId,
          toLocationId: row.toLocationId,
          fromTimezone: row.fromTimezone,
          toTimezone: row.toTimezone,
          departureLocalTime: row.departureLocalTime,
          arrivalLocalTime: row.arrivalLocalTime,
          arrivalDayOffset: row.arrivalDayOffset,
          durationMinutes: row.durationMinutes,
          operatorNumber: row.operatorNumber ?? undefined,
        });
      }
    }

    return [...services.values()]
      .map((service) => ({
        ...service,
        segments: service.segments.sort((left, right) => left.segmentIndex - right.segmentIndex),
      }))
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
  }

  const transportSelection = {
    serviceId: transportServices.id,
    mode: transportServices.mode,
    operator: transportServices.operator,
    operatingWeekdays: transportServices.operatingWeekdays,
    validFrom: transportServices.validFrom,
    validUntil: transportServices.validUntil,
    priceAmount: transportServices.priceAmount,
    currency: transportServices.currency,
    priceUnit: transportServices.priceUnit,
    segmentId: transportSegments.id,
    segmentIndex: transportSegments.segmentIndex,
    fromLocationId: transportSegments.fromLocationId,
    toLocationId: transportSegments.toLocationId,
    fromTimezone: segmentFromLocation.timezone,
    toTimezone: segmentToLocation.timezone,
    departureLocalTime: transportSegments.departureLocalTime,
    arrivalLocalTime: transportSegments.arrivalLocalTime,
    arrivalDayOffset: transportSegments.arrivalDayOffset,
    durationMinutes: transportSegments.durationMinutes,
    operatorNumber: transportSegments.operatorNumber,
  };
  const staySelection = {
    roomOfferId: roomOffers.id,
    propertyId: properties.id,
    locationId: properties.locationId,
    propertyName: properties.name,
    ratingTenths: properties.ratingTenths,
    reviewCount: properties.reviewCount,
    amenities: properties.amenities,
    accessibility: properties.accessibility,
    tags: properties.tags,
    imageAssetKey: properties.imageAssetKey,
    imageUrl: imageAssets.url,
    imageAltText: imageAssets.altText,
    imageCredit: imageAssets.photographer,
    imageCreditUrl: imageAssets.photographerUrl,
    imageSourceUrl: imageAssets.sourceUrl,
    roomLabel: roomOffers.roomLabel,
    maxOccupancy: roomOffers.maxOccupancy,
    inventoryCount: roomOffers.inventoryCount,
    mealPlan: roomOffers.mealPlan,
    refundable: roomOffers.refundable,
    validFrom: roomOffers.validFrom,
    validUntil: roomOffers.validUntil,
    priceAmount: roomOffers.priceAmount,
    currency: roomOffers.currency,
    priceUnit: roomOffers.priceUnit,
  };
  const activitySelection = {
    sessionId: activitySessions.id,
    activityId: activities.id,
    locationId: activities.locationId,
    timezone: locations.timezone,
    name: activities.name,
    tags: activities.tags,
    mobility: activities.mobility,
    childFriendly: activities.childFriendly,
    seniorFriendly: activities.seniorFriendly,
    imageAssetKey: activities.imageAssetKey,
    imageUrl: imageAssets.url,
    imageAltText: imageAssets.altText,
    imageCredit: imageAssets.photographer,
    imageCreditUrl: imageAssets.photographerUrl,
    imageSourceUrl: imageAssets.sourceUrl,
    operatingWeekdays: activitySessions.operatingWeekdays,
    startsAtLocalTime: activitySessions.startsAtLocalTime,
    durationMinutes: activitySessions.durationMinutes,
    capacity: activitySessions.capacity,
    validFrom: activitySessions.validFrom,
    validUntil: activitySessions.validUntil,
    priceAmount: activitySessions.priceAmount,
    currency: activitySessions.currency,
    priceUnit: activitySessions.priceUnit,
  };
  const transferSelection = {
    id: transfers.id,
    fromLocationId: transfers.fromLocationId,
    toLocationId: transfers.toLocationId,
    mode: transfers.mode,
    durationMinutes: transfers.durationMinutes,
    operatingStartLocalTime: transfers.operatingStartLocalTime,
    operatingEndLocalTime: transfers.operatingEndLocalTime,
    capacity: transfers.capacity,
    priceAmount: transfers.priceAmount,
    currency: transfers.currency,
    priceUnit: transfers.priceUnit,
  };

  function normalizeStayRows(
    rows: Array<Omit<StayCatalogOffer, "currency" | "priceUnit" | "imageUrl" | "imageAltText" | "imageCredit" | "imageCreditUrl" | "imageSourceUrl"> & { currency: string; priceUnit: string; imageUrl: string | null; imageAltText: string | null; imageCredit: string | null; imageCreditUrl: string | null; imageSourceUrl: string | null }>,
  ): StayCatalogOffer[] {
    return rows.map((row) => {
      if (row.currency !== "INR" || row.priceUnit !== "per_room_per_night") {
        throw new Error(`Invalid stay price contract for ${row.roomOfferId}`);
      }
      return {
        ...row,
        imageUrl: row.imageUrl ?? undefined,
        imageAltText: row.imageAltText ?? undefined,
        imageCredit: row.imageCredit ?? undefined,
        imageCreditUrl: row.imageCreditUrl ?? undefined,
        imageSourceUrl: row.imageSourceUrl ?? undefined,
        currency: "INR",
        priceUnit: "per_room_per_night",
      };
    });
  }

  function normalizeActivityRows(
    rows: Array<
      Omit<ActivityCatalogSession, "currency" | "priceUnit" | "imageUrl" | "imageAltText" | "imageCredit" | "imageCreditUrl" | "imageSourceUrl"> & {
        currency: string;
        priceUnit: string;
        imageUrl: string | null;
        imageAltText: string | null;
        imageCredit: string | null;
        imageCreditUrl: string | null;
        imageSourceUrl: string | null;
      }
    >,
  ): ActivityCatalogSession[] {
    return rows.map((row) => {
      if (row.currency !== "INR" || row.priceUnit !== "per_participant") {
        throw new Error(`Invalid activity price contract for ${row.sessionId}`);
      }
      return {
        ...row,
        imageUrl: row.imageUrl ?? undefined,
        imageAltText: row.imageAltText ?? undefined,
        imageCredit: row.imageCredit ?? undefined,
        imageCreditUrl: row.imageCreditUrl ?? undefined,
        imageSourceUrl: row.imageSourceUrl ?? undefined,
        currency: "INR",
        priceUnit: "per_participant",
      };
    });
  }

  function normalizeTransferRows(
    rows: Array<
      Omit<TransferCatalogOffer, "currency" | "priceUnit" | "operatingStartLocalTime" | "operatingEndLocalTime"> & {
        currency: string;
        priceUnit: string;
        operatingStartLocalTime: string | null;
        operatingEndLocalTime: string | null;
      }
    >,
  ): TransferCatalogOffer[] {
    return rows.map((row) => {
      if (row.currency !== "INR" || row.priceUnit !== "per_vehicle") {
        throw new Error(`Invalid transfer price contract for ${row.id}`);
      }
      return {
        ...row,
        operatingStartLocalTime: row.operatingStartLocalTime ?? undefined,
        operatingEndLocalTime: row.operatingEndLocalTime ?? undefined,
        currency: "INR",
        priceUnit: "per_vehicle",
      };
    });
  }

  return {
    getInventoryMeta,

    async searchLocations(normalizedQuery) {
      const nameMatches = sql<boolean>`position(${normalizedQuery} in lower(${locations.name})) > 0`;
      const aliasMatches = sql<boolean>`exists (
        select 1
        from unnest(${locations.aliases}) as location_alias(value)
        where position(${normalizedQuery} in lower(location_alias.value)) > 0
      )`;
      const airportCodeMatches = sql<boolean>`position(${normalizedQuery} in lower(coalesce(${locations.airportCode}, ''))) > 0`;

      const rows = await database
        .select({
          id: locations.id,
          name: locations.name,
          type: locations.type,
          countryCode: locations.countryCode,
          parentLabel: parentLocation.name,
          aliases: locations.aliases,
          airportCode: locations.airportCode,
        })
        .from(locations)
        .leftJoin(
          parentLocation,
          and(eq(locations.parentId, parentLocation.id), eq(parentLocation.active, true)),
        )
        .where(
          and(
            eq(locations.active, true),
            or(nameMatches, aliasMatches, airportCodeMatches),
          ),
        );

      return rows.map((row) => ({
        ...row,
        parentLabel: row.parentLabel ?? undefined,
        airportCode: row.airportCode ?? undefined,
      }));
    },

    async getActiveLocationGraph() {
      const rows = await database
        .select({
          id: locations.id,
          parentId: locations.parentId,
          name: locations.name,
          type: locations.type,
          tags: locations.tags,
          timezone: locations.timezone,
        })
        .from(locations)
        .where(eq(locations.active, true));

      return rows.map((row) => ({ ...row, parentId: row.parentId ?? undefined }));
    },

    async getPlannerCatalog() {
      const [meta, locationRows, marketRows, locationThemeRows, propertyThemeRows, activityThemeRows] =
        await Promise.all([
          getInventoryMeta(),
          database
            .select({
              id: locations.id,
              parentId: locations.parentId,
              name: locations.name,
              type: locations.type,
              tags: locations.tags,
              timezone: locations.timezone,
            })
            .from(locations)
            .where(eq(locations.active, true)),
          database
            .select({ id: destinationMarkets.locationId })
            .from(destinationMarkets)
            .innerJoin(
              locations,
              and(
                eq(destinationMarkets.locationId, locations.id),
                eq(locations.active, true),
              ),
            ),
          database
            .select({ tags: locations.tags })
            .from(locations)
            .where(eq(locations.active, true)),
          database
            .select({ tags: properties.tags })
            .from(properties)
            .where(eq(properties.active, true)),
          database
            .select({ tags: activities.tags })
            .from(activities)
            .where(eq(activities.active, true)),
        ]);

      return {
        inventoryVersion: meta.version,
        locationGraph: locationRows
          .map((row) => ({ ...row, parentId: row.parentId ?? undefined }))
          .sort((left, right) => left.id.localeCompare(right.id, "en")),
        marketIds: marketRows.map((row) => row.id).sort((left, right) => left.localeCompare(right, "en")),
        supportedThemes: [
          ...new Set(
            [...locationThemeRows, ...propertyThemeRows, ...activityThemeRows]
              .flatMap((row) => row.tags)
              .map((tag) => tag.trim().toLocaleLowerCase("en"))
              .filter(Boolean),
          ),
        ].sort((left, right) => left.localeCompare(right, "en")),
      };
    },

    async getDestinationMarketProfiles() {
      const rows = await database
        .select({
          id: destinationMarkets.locationId,
          name: locations.name,
          countryCode: locations.countryCode,
          region: destinationMarkets.region,
          displayOrder: destinationMarkets.displayOrder,
          tags: locations.tags,
          imageAssetKey: locations.imageAssetKey,
          imageUrl: imageAssets.url,
          imageAltText: imageAssets.altText,
        })
        .from(destinationMarkets)
        .innerJoin(
          locations,
          and(
            eq(destinationMarkets.locationId, locations.id),
            eq(locations.active, true),
          ),
        )
        .leftJoin(imageAssets, eq(locations.imageAssetKey, imageAssets.key))
        .orderBy(asc(destinationMarkets.displayOrder), asc(destinationMarkets.locationId));

      return rows.map((row) => ({
        ...row,
        imageAssetKey: row.imageAssetKey ?? undefined,
        imageUrl: row.imageUrl ?? undefined,
        imageAltText: row.imageAltText ?? undefined,
      }));
    },

    async findTransportServices(fromLocationIds, toLocationIds) {
      if (fromLocationIds.length === 0 || toLocationIds.length === 0) return [];

      const rows = await database
        .selectDistinct(transportSelection)
        .from(transportServices)
        .innerJoin(
          routeFromSegment,
          and(
            eq(routeFromSegment.serviceId, transportServices.id),
            eq(routeFromSegment.segmentIndex, 0),
            inArray(routeFromSegment.fromLocationId, fromLocationIds),
          ),
        )
        .innerJoin(
          routeToSegment,
          and(
            eq(routeToSegment.serviceId, transportServices.id),
            inArray(routeToSegment.toLocationId, toLocationIds),
          ),
        )
        .innerJoin(transportSegments, eq(transportSegments.serviceId, transportServices.id))
        .innerJoin(segmentFromLocation, eq(transportSegments.fromLocationId, segmentFromLocation.id))
        .innerJoin(segmentToLocation, eq(transportSegments.toLocationId, segmentToLocation.id))
        .where(
          and(
            eq(transportServices.active, true),
            eq(segmentFromLocation.active, true),
            eq(segmentToLocation.active, true),
          ),
        )
        .orderBy(asc(transportServices.id), asc(transportSegments.segmentIndex));

      return groupTransportRows(rows).filter((service) => {
        const first = service.segments[0];
        const last = service.segments.at(-1);
        return (
          first !== undefined &&
          last !== undefined &&
          fromLocationIds.includes(first.fromLocationId) &&
          toLocationIds.includes(last.toLocationId)
        );
      });
    },

    async findTransportServiceById(serviceId) {
      const rows = await database
        .select(transportSelection)
        .from(transportServices)
        .innerJoin(transportSegments, eq(transportSegments.serviceId, transportServices.id))
        .innerJoin(segmentFromLocation, eq(transportSegments.fromLocationId, segmentFromLocation.id))
        .innerJoin(segmentToLocation, eq(transportSegments.toLocationId, segmentToLocation.id))
        .where(
          and(
            eq(transportServices.id, serviceId),
            eq(transportServices.active, true),
            eq(segmentFromLocation.active, true),
            eq(segmentToLocation.active, true),
          ),
        )
        .orderBy(asc(transportSegments.segmentIndex));

      return groupTransportRows(rows)[0];
    },

    async findStayOffers(locationIds) {
      if (locationIds.length === 0) return [];

      const rows = await database
        .select(staySelection)
        .from(roomOffers)
        .innerJoin(properties, eq(roomOffers.propertyId, properties.id))
        .leftJoin(imageAssets, eq(properties.imageAssetKey, imageAssets.key))
        .innerJoin(locations, eq(properties.locationId, locations.id))
        .where(
          and(
            inArray(properties.locationId, locationIds),
            eq(properties.active, true),
            eq(roomOffers.active, true),
            eq(locations.active, true),
          ),
        )
        .orderBy(asc(properties.id), asc(roomOffers.id));

      return normalizeStayRows(rows);
    },

    async findStayOfferById(roomOfferId) {
      const rows = await database
        .select(staySelection)
        .from(roomOffers)
        .innerJoin(properties, eq(roomOffers.propertyId, properties.id))
        .leftJoin(imageAssets, eq(properties.imageAssetKey, imageAssets.key))
        .innerJoin(locations, eq(properties.locationId, locations.id))
        .where(
          and(
            eq(roomOffers.id, roomOfferId),
            eq(properties.active, true),
            eq(roomOffers.active, true),
            eq(locations.active, true),
          ),
        )
        .limit(1);

      return normalizeStayRows(rows)[0];
    },

    async findActivitySessions(locationIds) {
      if (locationIds.length === 0) return [];

      const rows = await database
        .select(activitySelection)
        .from(activitySessions)
        .innerJoin(activities, eq(activitySessions.activityId, activities.id))
        .leftJoin(imageAssets, eq(activities.imageAssetKey, imageAssets.key))
        .innerJoin(locations, eq(activities.locationId, locations.id))
        .where(
          and(
            inArray(activities.locationId, locationIds),
            eq(activities.active, true),
            eq(activitySessions.active, true),
            eq(locations.active, true),
          ),
        )
        .orderBy(asc(activities.id), asc(activitySessions.id));

      return normalizeActivityRows(rows);
    },

    async findActivitySessionById(sessionId) {
      const rows = await database
        .select(activitySelection)
        .from(activitySessions)
        .innerJoin(activities, eq(activitySessions.activityId, activities.id))
        .leftJoin(imageAssets, eq(activities.imageAssetKey, imageAssets.key))
        .innerJoin(locations, eq(activities.locationId, locations.id))
        .where(
          and(
            eq(activitySessions.id, sessionId),
            eq(activities.active, true),
            eq(activitySessions.active, true),
            eq(locations.active, true),
          ),
        )
        .limit(1);

      return normalizeActivityRows(rows)[0];
    },

    async findTransfers(fromLocationId, toLocationId) {
      const transferFromLocation = alias(locations, "transfer_from_location");
      const transferToLocation = alias(locations, "transfer_to_location");
      const rows = await database
        .select(transferSelection)
        .from(transfers)
        .innerJoin(transferFromLocation, eq(transfers.fromLocationId, transferFromLocation.id))
        .innerJoin(transferToLocation, eq(transfers.toLocationId, transferToLocation.id))
        .where(
          and(
            eq(transfers.fromLocationId, fromLocationId),
            eq(transfers.toLocationId, toLocationId),
            eq(transfers.active, true),
            eq(transferFromLocation.active, true),
            eq(transferToLocation.active, true),
          ),
        )
        .orderBy(asc(transfers.priceAmount), asc(transfers.durationMinutes), asc(transfers.id));

      return normalizeTransferRows(rows);
    },

    async findTransferById(transferId) {
      const transferFromLocation = alias(locations, "transfer_from_location_by_id");
      const transferToLocation = alias(locations, "transfer_to_location_by_id");
      const rows = await database
        .select(transferSelection)
        .from(transfers)
        .innerJoin(transferFromLocation, eq(transfers.fromLocationId, transferFromLocation.id))
        .innerJoin(transferToLocation, eq(transfers.toLocationId, transferToLocation.id))
        .where(
          and(
            eq(transfers.id, transferId),
            eq(transfers.active, true),
            eq(transferFromLocation.active, true),
            eq(transferToLocation.active, true),
          ),
        )
        .limit(1);

      return normalizeTransferRows(rows)[0];
    },
  };
}

type InventorySource = "snapshot" | "hybrid" | "neon";

const repositoryMethods = [
  "getInventoryMeta",
  "searchLocations",
  "getPlannerCatalog",
  "getDestinationMarketProfiles",
  "getActiveLocationGraph",
  "findTransportServices",
  "findTransportServiceById",
  "findStayOffers",
  "findStayOfferById",
  "findActivitySessions",
  "findActivitySessionById",
  "findTransfers",
  "findTransferById",
] as const satisfies ReadonlyArray<keyof InventoryRepository>;

let neonUnavailableUntil = 0;
let fallbackReported = false;

function configuredInventorySource(): InventorySource {
  const value = process.env.INVENTORY_SOURCE?.trim().toLowerCase();
  return value === "neon" || value === "hybrid" || value === "snapshot" ? value : "snapshot";
}

export function createHybridInventoryRepository(
  neonRepository: InventoryRepository,
  snapshotRepository: InventoryRepository,
): InventoryRepository {
  const entries = repositoryMethods.map((methodName) => [
    methodName,
    async (...args: unknown[]) => {
      if (Date.now() < neonUnavailableUntil) {
        return (snapshotRepository[methodName] as (...values: unknown[]) => unknown)(...args);
      }
      try {
        return await (neonRepository[methodName] as (...values: unknown[]) => unknown)(...args);
      } catch (error: unknown) {
        neonUnavailableUntil = Date.now() + 60_000;
        if (!fallbackReported) {
          fallbackReported = true;
          console.warn("Neon inventory unavailable; using the bundled read-only snapshot", {
            retryAfterMs: 60_000,
            reason: error instanceof Error ? error.message : "inventory request failed",
          });
        }
        return (snapshotRepository[methodName] as (...values: unknown[]) => unknown)(...args);
      }
    },
  ]);
  return Object.fromEntries(entries) as unknown as InventoryRepository;
}

export function createInventoryRepository(database?: Database): InventoryRepository {
  if (database) return createNeonInventoryRepository(database);

  const snapshotRepository = createSnapshotInventoryRepository();
  const source = configuredInventorySource();
  if (source === "snapshot") return snapshotRepository;

  const neonRepository = createNeonInventoryRepository(getRuntimeDatabase());
  return source === "neon"
    ? neonRepository
    : createHybridInventoryRepository(neonRepository, snapshotRepository);
}

export function inventorySource(): InventorySource {
  return configuredInventorySource();
}
