import { z } from 'zod';
import type { ISODate, ISODateTime, LocationID, TravelMode } from '@/domain/model';
import { transportOfferSchema, type TransportOffer } from '@/inventory/contracts';

export interface TransportProviderCapabilities {
  modes: readonly TravelMode[];
  livePrices: boolean;
  liveAvailability: boolean;
  booking: 'none' | 'handoff' | 'managed';
  cancellationTerms: boolean;
  capacity: boolean;
  refresh: 'none' | 'manual' | 'polling' | 'webhook';
}

export interface TransportOfferSearch {
  from: LocationID;
  to: LocationID;
  departureDate: ISODate;
  returnDate?: ISODate;
  travellerIds: string[];
  modes: TravelMode[];
}

export interface TransportOfferSearchResult {
  offers: TransportOffer[];
  checkedAt: ISODateTime;
  warnings: string[];
}

/**
 * A provider adapter owns supplier-specific request and response schemas. Only
 * validated canonical offers may cross this boundary into planning state.
 */
export interface TransportProviderAdapter {
  readonly id: string;
  readonly capabilities: TransportProviderCapabilities;
  fetchOffers(input: TransportOfferSearch, signal: AbortSignal): Promise<unknown>;
}

const transportOfferSearchResultSchema = z.object({
  offers: z.array(transportOfferSchema),
  checkedAt: z.string().datetime({ offset: true }),
  warnings: z.array(z.string()),
}).strict();

function assertProviderCapabilities(
  adapter: TransportProviderAdapter,
  input: TransportOfferSearch,
  result: TransportOfferSearchResult,
): void {
  const supportedModes = new Set(adapter.capabilities.modes);
  const requestedModes = new Set(input.modes);

  for (const offer of result.offers) {
    const departureDate = offer.departureAt.slice(0, 10);
    const matchesOutbound = offer.from === input.from && offer.to === input.to && departureDate === input.departureDate;
    const matchesReturn = Boolean(
      input.returnDate &&
      offer.from === input.to &&
      offer.to === input.from &&
      departureDate === input.returnDate,
    );
    if (offer.source.provider !== adapter.id) {
      throw new Error(`Provider ${adapter.id} returned an offer attributed to ${offer.source.provider}`);
    }
    if (!matchesOutbound && !matchesReturn) {
      throw new Error(`Provider ${adapter.id} returned an offer outside the requested route or date`);
    }
    if (!supportedModes.has(offer.mode) || !requestedModes.has(offer.mode)) {
      throw new Error(`Provider ${adapter.id} returned unsupported or unrequested mode ${offer.mode}`);
    }
    if (offer.source.evidenceKind === 'live' && !adapter.capabilities.livePrices) {
      throw new Error(`Provider ${adapter.id} cannot supply live prices`);
    }
    if (!adapter.capabilities.liveAvailability && offer.availability !== 'unknown') {
      throw new Error(`Provider ${adapter.id} cannot supply live availability`);
    }
    if (!adapter.capabilities.cancellationTerms && offer.cancellationTerms) {
      throw new Error(`Provider ${adapter.id} cannot supply cancellation terms`);
    }
    if (!adapter.capabilities.capacity && offer.capacity) {
      throw new Error(`Provider ${adapter.id} cannot supply capacity`);
    }
    if (adapter.capabilities.booking === 'none' && offer.booking) {
      throw new Error(`Provider ${adapter.id} cannot supply a booking action`);
    }
    if (adapter.capabilities.booking === 'handoff' && offer.booking?.method === 'managed') {
      throw new Error(`Provider ${adapter.id} cannot manage bookings`);
    }
    if (adapter.capabilities.refresh === 'none' && offer.source.expiresAt) {
      throw new Error(`Provider ${adapter.id} cannot refresh expiring offers`);
    }
  }
}

/**
 * The only entry point for supplier transport search. It validates supplier
 * output and checks capability claims before canonical offers reach planning.
 */
export async function searchTransportOffers(
  adapter: TransportProviderAdapter,
  input: TransportOfferSearch,
  signal: AbortSignal,
): Promise<TransportOfferSearchResult> {
  const supportedModes = new Set(adapter.capabilities.modes);
  const unsupportedMode = input.modes.find(mode => !supportedModes.has(mode));
  if (unsupportedMode) {
    throw new Error(`Provider ${adapter.id} does not support requested mode ${unsupportedMode}`);
  }
  const result = transportOfferSearchResultSchema.parse(await adapter.fetchOffers(input, signal));
  assertProviderCapabilities(adapter, input, result);
  return result;
}
