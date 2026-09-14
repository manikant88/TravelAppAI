import type { TransportOffer } from '@/inventory/contracts';
import type { LiveBrief } from './contracts';
import type { LiveProvider } from './google.server';

export type RouteSearchProfile = Pick<Parameters<LiveProvider['travelRoutes']>[2], 'mode' | 'transitModes' | 'roadUse'>;

export function routeSearchProfiles(mode: LiveBrief['travelMode']): RouteSearchProfile[] {
  if (mode === 'self_drive') return [{ mode: 'drive', roadUse: 'self_drive' }];
  if (mode === 'cab') return [{ mode: 'drive', roadUse: 'cab' }];
  if (mode === 'train') return [{ mode: 'transit', transitModes: ['TRAIN', 'LIGHT_RAIL', 'RAIL', 'SUBWAY'] }];
  if (mode === 'bus') return [{ mode: 'transit', transitModes: ['BUS'] }];
  if (mode === 'recommend') return [
    { mode: 'transit', transitModes: ['TRAIN', 'LIGHT_RAIL', 'RAIL', 'SUBWAY'] },
    { mode: 'transit', transitModes: ['BUS'] },
    { mode: 'drive', roadUse: 'cab' },
  ];
  return [{ mode: 'transit' }];
}

export function selectRecommendedFlight(offers: TransportOffer[], direction: 'outbound' | 'return') {
  const scheduleFriendly = scheduleFriendlyFlights(offers, direction);
  return [...scheduleFriendly]
    .sort((left, right) => left.price.amount - right.price.amount || left.durationMinutes - right.durationMinutes)[0];
}

export function scheduleFriendlyFlights(offers: TransportOffer[], direction: 'outbound' | 'return') {
  const available = offers.filter(offer => offer.availability === 'available');
  const preferred = available.filter(offer => {
    const value = direction === 'outbound' ? offer.arrivalAt : offer.departureAt;
    const minutes = Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
    return direction === 'outbound' ? minutes <= 13 * 60 : minutes >= 17 * 60;
  });
  return preferred.length ? preferred : available;
}
