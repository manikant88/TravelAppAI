import type { TransferOffer } from './contracts';

export function transferPriceUnits(offer: TransferOffer, travellerCount: number): number {
  return offer.price.unit === 'per_traveller'
    ? travellerCount
    : Math.ceil(travellerCount / offer.capacity);
}

export function transferTotalAmount(offer: TransferOffer, travellerCount: number): number {
  return offer.price.amount * transferPriceUnits(offer, travellerCount);
}

export function transferPriceUnitLabel(offer: TransferOffer): string {
  return offer.price.unit === 'per_traveller' ? 'traveller' : 'vehicle';
}
