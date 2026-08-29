import { travelInventorySeed, type InventorySeed } from "@/db/seed/data";
import { normalizeLocationQuery } from "@/inventory/service";
import type {
  ActivityCatalogSession,
  ActiveLocationNode,
  DestinationMarketProfile,
  InventoryRepository,
  LocationInventoryRow,
  StayCatalogOffer,
  TransferCatalogOffer,
  TransportCatalogService,
} from "@/inventory/repository";

function active(value: boolean | undefined): boolean {
  return value !== false;
}

export function createSnapshotInventoryRepository(
  seed: InventorySeed = travelInventorySeed,
): InventoryRepository {
  const meta = seed.meta[0];
  if (!meta) throw new Error("Bundled inventory snapshot has no metadata");

  const locationById = new Map(seed.locations.map((location) => [location.id, location]));
  const propertyById = new Map(seed.properties.map((property) => [property.id, property]));
  const activityById = new Map(seed.activities.map((activity) => [activity.id, activity]));
  const imageByKey = new Map(seed.imageAssets.map((image) => [image.key, image]));

  const locationGraph: ActiveLocationNode[] = seed.locations
    .filter((location) => active(location.active))
    .map((location) => ({
      id: location.id,
      parentId: location.parentId ?? undefined,
      name: location.name,
      type: location.type,
      tags: [...(location.tags ?? [])],
      timezone: location.timezone,
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  const locationRows: LocationInventoryRow[] = seed.locations
    .filter((location) => active(location.active))
    .map((location) => ({
      id: location.id,
      name: location.name,
      type: location.type,
      countryCode: location.countryCode,
      parentLabel: location.parentId ? locationById.get(location.parentId)?.name : undefined,
      aliases: [...(location.aliases ?? [])],
      airportCode: location.airportCode ?? undefined,
    }));

  const transportServices: TransportCatalogService[] = seed.transportServices
    .filter((service) => active(service.active))
    .flatMap((service) => {
      if (service.currency !== "INR" || service.priceUnit !== "per_traveller") return [];
      const segments = seed.transportSegments
        .filter((segment) => segment.serviceId === service.id)
        .sort((left, right) => left.segmentIndex - right.segmentIndex)
        .flatMap((segment) => {
          const from = locationById.get(segment.fromLocationId);
          const to = locationById.get(segment.toLocationId);
          if (!from || !to || !active(from.active) || !active(to.active)) return [];
          return [{
            id: segment.id,
            segmentIndex: segment.segmentIndex,
            fromLocationId: segment.fromLocationId,
            toLocationId: segment.toLocationId,
            fromTimezone: from.timezone,
            toTimezone: to.timezone,
            departureLocalTime: segment.departureLocalTime,
            arrivalLocalTime: segment.arrivalLocalTime,
            arrivalDayOffset: segment.arrivalDayOffset ?? 0,
            durationMinutes: segment.durationMinutes,
            operatorNumber: segment.operatorNumber ?? undefined,
          }];
        });
      return [{
        id: service.id,
        mode: service.mode,
        operator: service.operator,
        operatingWeekdays: [...service.operatingWeekdays],
        validFrom: service.validFrom,
        validUntil: service.validUntil,
        priceAmount: service.priceAmount,
        currency: "INR" as const,
        priceUnit: "per_traveller" as const,
        segments,
      }];
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  const stayOffers: StayCatalogOffer[] = seed.roomOffers
    .filter((offer) => active(offer.active))
    .flatMap((offer) => {
      const property = propertyById.get(offer.propertyId);
      if (!property || !active(property.active) || !active(locationById.get(property.locationId)?.active)) return [];
      if (offer.currency !== "INR" || offer.priceUnit !== "per_room_per_night") return [];
      const image = imageByKey.get(property.imageAssetKey);
      return [{
        roomOfferId: offer.id,
        propertyId: property.id,
        locationId: property.locationId,
        propertyName: property.name,
        ratingTenths: property.ratingTenths,
        reviewCount: property.reviewCount,
        amenities: [...(property.amenities ?? [])],
        accessibility: [...(property.accessibility ?? [])],
        tags: [...(property.tags ?? [])],
        imageAssetKey: property.imageAssetKey,
        imageUrl: image?.url,
        imageAltText: image?.altText,
        imageCredit: image?.photographer,
        imageCreditUrl: image?.photographerUrl,
        imageSourceUrl: image?.sourceUrl,
        roomLabel: offer.roomLabel,
        maxOccupancy: offer.maxOccupancy,
        inventoryCount: offer.inventoryCount,
        mealPlan: offer.mealPlan,
        refundable: offer.refundable,
        validFrom: offer.validFrom,
        validUntil: offer.validUntil,
        priceAmount: offer.priceAmount,
        currency: "INR" as const,
        priceUnit: "per_room_per_night" as const,
      }];
    })
    .sort((left, right) => left.propertyId.localeCompare(right.propertyId, "en") || left.roomOfferId.localeCompare(right.roomOfferId, "en"));

  const activitySessions: ActivityCatalogSession[] = seed.activitySessions
    .filter((session) => active(session.active))
    .flatMap((session) => {
      const activity = activityById.get(session.activityId);
      const location = activity ? locationById.get(activity.locationId) : undefined;
      if (!activity || !location || !active(activity.active) || !active(location.active)) return [];
      if (session.currency !== "INR" || session.priceUnit !== "per_participant") return [];
      const image = imageByKey.get(activity.imageAssetKey);
      return [{
        sessionId: session.id,
        activityId: activity.id,
        locationId: activity.locationId,
        timezone: location.timezone,
        name: activity.name,
        tags: [...(activity.tags ?? [])],
        mobility: activity.mobility,
        childFriendly: activity.childFriendly,
        seniorFriendly: activity.seniorFriendly,
        imageAssetKey: activity.imageAssetKey,
        imageUrl: image?.url,
        imageAltText: image?.altText,
        imageCredit: image?.photographer,
        imageCreditUrl: image?.photographerUrl,
        imageSourceUrl: image?.sourceUrl,
        operatingWeekdays: [...session.operatingWeekdays],
        startsAtLocalTime: session.startsAtLocalTime,
        durationMinutes: session.durationMinutes,
        capacity: session.capacity,
        validFrom: session.validFrom,
        validUntil: session.validUntil,
        priceAmount: session.priceAmount,
        currency: "INR" as const,
        priceUnit: "per_participant" as const,
      }];
    })
    .sort((left, right) => left.activityId.localeCompare(right.activityId, "en") || left.sessionId.localeCompare(right.sessionId, "en"));

  const transferOffers: TransferCatalogOffer[] = seed.transfers
    .filter((transfer) => active(transfer.active))
    .flatMap((transfer) => {
      if (transfer.currency !== "INR" || transfer.priceUnit !== "per_vehicle") return [];
      if (!active(locationById.get(transfer.fromLocationId)?.active) || !active(locationById.get(transfer.toLocationId)?.active)) return [];
      return [{
        id: transfer.id,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        mode: transfer.mode,
        durationMinutes: transfer.durationMinutes,
        operatingStartLocalTime: transfer.operatingStartLocalTime ?? undefined,
        operatingEndLocalTime: transfer.operatingEndLocalTime ?? undefined,
        capacity: transfer.capacity,
        priceAmount: transfer.priceAmount,
        currency: "INR" as const,
        priceUnit: "per_vehicle" as const,
      }];
    })
    .sort((left, right) => left.priceAmount - right.priceAmount || left.durationMinutes - right.durationMinutes || left.id.localeCompare(right.id, "en"));

  const marketProfiles: DestinationMarketProfile[] = seed.markets.flatMap((market) => {
    const location = locationById.get(market.locationId);
    if (!location || !active(location.active)) return [];
    const image = location.imageAssetKey ? imageByKey.get(location.imageAssetKey) : undefined;
    return [{
      id: market.locationId,
      name: location.name,
      countryCode: location.countryCode,
      region: market.region,
      displayOrder: market.displayOrder,
      tags: [...(location.tags ?? [])],
      imageAssetKey: location.imageAssetKey ?? undefined,
      imageUrl: image?.url,
      imageAltText: image?.altText,
    }];
  }).sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id, "en"));

  const supportedThemes = [...new Set([
    ...seed.locations.flatMap((item) => item.tags ?? []),
    ...seed.properties.flatMap((item) => item.tags ?? []),
    ...seed.activities.flatMap((item) => item.tags ?? []),
  ].map((tag) => tag.trim().toLocaleLowerCase("en")).filter(Boolean))].sort((left, right) => left.localeCompare(right, "en"));

  return {
    async getInventoryMeta() {
      return { version: meta.version, supportedFrom: meta.supportedFrom, supportedUntil: meta.supportedUntil };
    },
    async searchLocations(normalizedQuery) {
      const query = normalizeLocationQuery(normalizedQuery);
      return locationRows.filter((row) => [row.name, row.airportCode ?? "", ...row.aliases].some((value) => normalizeLocationQuery(value).includes(query)));
    },
    async getActiveLocationGraph() { return locationGraph; },
    async getPlannerCatalog() {
      return { inventoryVersion: meta.version, locationGraph, marketIds: marketProfiles.map((market) => market.id).sort(), supportedThemes };
    },
    async getDestinationMarketProfiles() { return marketProfiles; },
    async findTransportServices(fromLocationIds, toLocationIds) {
      return transportServices.filter((service) => {
        const first = service.segments[0];
        const last = service.segments.at(-1);
        return first && last && fromLocationIds.includes(first.fromLocationId) && toLocationIds.includes(last.toLocationId);
      });
    },
    async findTransportServiceById(serviceId) { return transportServices.find((service) => service.id === serviceId); },
    async findStayOffers(locationIds) { return stayOffers.filter((offer) => locationIds.includes(offer.locationId)); },
    async findStayOfferById(roomOfferId) { return stayOffers.find((offer) => offer.roomOfferId === roomOfferId); },
    async findActivitySessions(locationIds) { return activitySessions.filter((session) => locationIds.includes(session.locationId)); },
    async findActivitySessionById(sessionId) { return activitySessions.find((session) => session.sessionId === sessionId); },
    async findTransfers(fromLocationId, toLocationId) { return transferOffers.filter((offer) => offer.fromLocationId === fromLocationId && offer.toLocationId === toLocationId); },
    async findTransferById(transferId) { return transferOffers.find((offer) => offer.id === transferId); },
  };
}
