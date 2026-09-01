type TransportInsightFacts = {
  operator: string;
  from: string;
  to: string;
  departureTime: string;
  arrivalTime: string;
  stops: number;
};

type TransferInsightFacts = {
  mode: "car" | "van" | "shared";
  from: string;
  to: string;
  duration: string;
};

type StayInsightFacts = {
  nights: number;
  rooms: number;
  rating: string;
  reviewCount: number;
  amenities: string[];
};

type ActivityInsightFacts = {
  mobility: string;
  interests: string[];
};

function naturalList(values: string[]): string {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(values);
}

function readableAmenity(value: string): string {
  if (/^wi-?fi$/i.test(value)) return "Wi-Fi";
  return value.replaceAll("_", " ");
}

export function transportSelectionInsight(facts: TransportInsightFacts): string {
  if (facts.stops === 0) {
    return `A non-stop ${facts.operator} service keeps this leg simple: you’ll leave ${facts.from} at ${facts.departureTime} and arrive in ${facts.to} at ${facts.arrivalTime}.`;
  }

  const stopLabel = `${facts.stops} stop${facts.stops === 1 ? "" : "s"}`;
  return `${facts.operator} connects ${facts.from} to ${facts.to} with ${stopLabel}, departing at ${facts.departureTime} and arriving at ${facts.arrivalTime}.`;
}

export function transferSelectionInsight(facts: TransferInsightFacts): string {
  const transferKind = facts.mode === "shared" ? "shared transfer" : `private ${facts.mode} transfer`;
  return `This ${transferKind} gives you a direct connection from ${facts.from} to ${facts.to}, with ${facts.duration} allowed for the journey.`;
}

export function staySelectionInsight(facts: StayInsightFacts): string {
  const roomLabel = `${facts.rooms} room${facts.rooms === 1 ? "" : "s"}`;
  const nightLabel = `${facts.nights}-night stay`;
  const amenities = facts.amenities.slice(0, 2).map(readableAmenity).filter(Boolean);
  const amenityPhrase = amenities.length > 0 ? ` and includes ${naturalList(amenities)}` : "";

  return `${roomLabel} cover${facts.rooms === 1 ? "s" : ""} your full ${nightLabel}. The property is rated ${facts.rating} from ${facts.reviewCount.toLocaleString("en-IN")} reviews${amenityPhrase}.`;
}

export function activitySelectionInsight(facts: ActivityInsightFacts): string {
  const interests = facts.interests.slice(0, 3).filter(Boolean);
  const interestPhrase = interests.length > 0
    ? ` It also connects with your ${naturalList(interests)} interests.`
    : "";

  return `This ${facts.mobility}-mobility experience fits comfortably into the day without clashing with your travel plans.${interestPhrase}`;
}
