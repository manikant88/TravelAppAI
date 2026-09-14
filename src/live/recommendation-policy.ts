import type { TransportOffer } from '@/inventory/contracts';
import type { LivePlace, LiveTravelOption, TripBudget } from './contracts';

export type JourneyRecommendationCandidate =
  | { kind: 'flight'; id: string; minutes: number; knownCost: number; currency: 'INR' }
  | { kind: 'route'; id: string; minutes: number; knownCost?: number; currency?: string };

export type JourneyRecommendation = JourneyRecommendationCandidate & {
  budgetStatus: 'not_requested' | 'within_known_budget' | 'over_known_budget' | 'cost_unknown';
};

export function selectBudgetAwareHotel(selected: LivePlace, hotels: LivePlace[], budget: TripBudget | null) {
  if (!budget) return selected;
  const accommodationLimit = budget.amount * 0.6;
  const comparable = hotels.filter(hotel => {
    const offer = hotel.stayOffer;
    return offer?.availability === 'available'
      && offer.totalPrice?.currency === budget.currency;
  });
  const eligible = comparable.filter(hotel => hotel.stayOffer!.totalPrice!.amount <= accommodationLimit);
  if (!eligible.length) return comparable.sort((left, right) => left.stayOffer!.totalPrice!.amount - right.stayOffer!.totalPrice!.amount)[0] ?? selected;
  return [...eligible].sort((left, right) => qualityScore(right) - qualityScore(left)
    || (left.stayOffer!.totalPrice!.amount - right.stayOffer!.totalPrice!.amount))[0];
}

export function flightCandidate(offer: TransportOffer, travellers: number, transferMinutes = 0): JourneyRecommendationCandidate {
  return {
    kind: 'flight',
    id: offer.id,
    minutes: offer.durationMinutes + 120 + transferMinutes,
    knownCost: offer.price.amount * travellers,
    currency: offer.price.currency,
  };
}

export function routeCandidate(option: LiveTravelOption, travellers: number): JourneyRecommendationCandidate {
  return {
    kind: 'route',
    id: option.id,
    minutes: option.minutes,
    ...(option.fare ? { knownCost: option.fare.amount * travellers, currency: option.fare.currency } : {}),
  };
}

export function selectJourneyRecommendation(candidates: JourneyRecommendationCandidate[], budget?: { amount: number; currency: string } | null): JourneyRecommendation | undefined {
  if (!candidates.length) return undefined;
  if (!budget) return { ...[...candidates].sort(byTimeThenCost)[0], budgetStatus: 'not_requested' };

  const comparable = candidates.filter(candidate => candidate.knownCost !== undefined && candidate.currency === budget.currency);
  const affordable = comparable.filter(candidate => candidate.knownCost! <= budget.amount);
  if (affordable.length) return { ...[...affordable].sort(byTimeThenCost)[0], budgetStatus: 'within_known_budget' };
  if (comparable.length) return { ...[...comparable].sort((left, right) => left.knownCost! - right.knownCost! || byTimeThenCost(left, right))[0], budgetStatus: 'over_known_budget' };
  return { ...[...candidates].sort(byTimeThenCost)[0], budgetStatus: 'cost_unknown' };
}

function qualityScore(place: LivePlace) {
  const rating = place.rating ?? 0;
  const confidence = Math.min(1, Math.log10((place.reviewCount ?? 0) + 1) / 4);
  return rating * 100 + confidence * 20;
}

function byTimeThenCost(left: JourneyRecommendationCandidate, right: JourneyRecommendationCandidate) {
  return left.minutes - right.minutes
    || (left.knownCost ?? Number.MAX_SAFE_INTEGER) - (right.knownCost ?? Number.MAX_SAFE_INTEGER);
}
