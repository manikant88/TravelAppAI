import type { ISODate } from "@/domain/model";
import type { ActivityOffer } from "@/inventory/contracts";

interface ActivityReductionOptions {
  startDate: ISODate;
  endDate: ISODate;
  interests?: string[];
  limit?: number;
}

function interestMatchCount(offer: ActivityOffer, interests: Set<string>): number {
  return offer.activityFacts.tags.reduce(
    (count, tag) => count + (interests.has(tag.toLocaleLowerCase("en")) ? 1 : 0),
    0,
  );
}

function rankedOffers(offers: ActivityOffer[], interests: Set<string>): ActivityOffer[] {
  return [...offers].sort(
    (left, right) =>
      interestMatchCount(right, interests) - interestMatchCount(left, interests) ||
      left.price.amount - right.price.amount ||
      left.startsAt.localeCompare(right.startsAt, "en") ||
      left.id.localeCompare(right.id, "en"),
  );
}

function offersByDate(offers: ActivityOffer[], interests: Set<string>): Map<string, ActivityOffer[]> {
  const grouped = new Map<string, ActivityOffer[]>();
  for (const offer of offers) {
    const date = offer.startsAt.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), offer]);
  }
  grouped.forEach((items, date) => grouped.set(date, rankedOffers(items, interests)));
  return grouped;
}

/**
 * Finds the largest set of dated offers where neither an activity identity nor
 * a calendar day is repeated. The planner uses the same identity invariant,
 * so this is the truthful activity-day coverage available to initial PLAN.
 */
export function distinctActivityDayOffers(
  offers: ActivityOffer[],
  startDate: ISODate,
  endDate: ISODate,
  interests: string[] = [],
): ActivityOffer[] {
  const normalizedInterests = new Set(
    interests.map((interest) => interest.trim().toLocaleLowerCase("en")).filter(Boolean),
  );
  const grouped = offersByDate(offers, normalizedInterests);
  const dates = [...grouped.keys()]
    .filter((date) => date > startDate && date < endDate)
    .sort();
  const dateByActivityId = new Map<string, string>();
  const offerByDate = new Map<string, ActivityOffer>();

  function assign(date: string, visitedActivityIds: Set<string>): boolean {
    for (const offer of grouped.get(date) ?? []) {
      if (visitedActivityIds.has(offer.activityId)) continue;
      visitedActivityIds.add(offer.activityId);
      const previousDate = dateByActivityId.get(offer.activityId);
      if (!previousDate || assign(previousDate, visitedActivityIds)) {
        dateByActivityId.set(offer.activityId, date);
        offerByDate.set(date, offer);
        return true;
      }
    }
    return false;
  }

  for (const date of dates) assign(date, new Set());
  return [...offerByDate.values()].sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt, "en") || left.id.localeCompare(right.id, "en"),
  );
}

export function distinctActivityDayCount(
  offers: ActivityOffer[],
  startDate: ISODate,
  endDate: ISODate,
): number {
  return distinctActivityDayOffers(offers, startDate, endDate).length;
}

/**
 * Keeps the bounded observation small while guaranteeing that schedule-valid
 * interior-day coverage and distinct activity identities are represented
 * before additional comparison candidates consume the limit.
 */
export function reduceActivityOffersForPlanning(
  offers: ActivityOffer[],
  options: ActivityReductionOptions,
): ActivityOffer[] {
  const limit = options.limit ?? 8;
  const uniqueOffers = offers.filter(
    (offer, index, values) => values.findIndex((item) => item.id === offer.id) === index,
  );
  const normalizedInterests = new Set(
    (options.interests ?? [])
      .map((interest) => interest.trim().toLocaleLowerCase("en"))
      .filter(Boolean),
  );
  const coverage = distinctActivityDayOffers(
    uniqueOffers,
    options.startDate,
    options.endDate,
    options.interests,
  ).slice(0, limit);
  const selectedIds = new Set(coverage.map((offer) => offer.id));
  const grouped = offersByDate(uniqueOffers, normalizedInterests);
  const dates = [...grouped.keys()].sort();
  const result = [...coverage];

  for (let rank = 0; result.length < limit; rank += 1) {
    let added = false;
    for (const date of dates) {
      const offer = grouped.get(date)?.[rank];
      if (!offer || selectedIds.has(offer.id)) continue;
      result.push(offer);
      selectedIds.add(offer.id);
      added = true;
      if (result.length === limit) break;
    }
    if (!added) break;
  }
  return result;
}
