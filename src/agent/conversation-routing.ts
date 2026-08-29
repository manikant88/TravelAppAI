export type CommittedConversationIntent =
  | "activity_suggestion"
  | "modify_trip"
  | "explain_trip"
  | "travel_context"
  | "unsupported";

const modificationPattern = /\b(?:add|change|replace|remove|delete|cheaper|lock|unlock|update|move|reschedule|cancel|increase|decrease|extend|shorten|make|swap)\b/i;
const activitySuggestionPattern = /\b(?:suggest|recommend|more|nearby|near the (?:stay|hotel)|hang(?:ing)? out|places? to (?:go|visit)|things? to do)\b/i;
const activitySubjectPattern = /\b(?:activit(?:y|ies)|experience|place|nearby|hang(?:ing)? out|things? to do|restaurant|cafe|market)\b/i;
const deterministicTripPattern = /\b(?:trip total|total cost|price|budget|breakdown|selected|selection|itinerary|schedule|departure|arrival|flight|hotel|stay|check[ -]?in|check[ -]?out|activity|mobility|capacity|duration|route|transfer|day\s*\d+)\b/i;
const explanationPattern = /\b(?:why|explain|how much|what time|when|where|reason|breakdown|which)\b/i;
const travelContextPattern = /\b(?:weather|climate|season|temperature|rain|origin|destination|city|country|beach|neighbou?rhood|area|local|culture|food|restaurant|cafe|sight|attraction|activity|hotel|stay|flight|airport|travel|trip|visit|things? to do|tell me about)\b/i;

interface ConversationTripContext {
  request: { origin: string };
  route: { marketId: string; stops: Array<{ locationId: string }> };
}

function tripTerms(trip: ConversationTripContext): string[] {
  return [trip.request.origin, trip.route.marketId, ...trip.route.stops.map((stop) => stop.locationId)]
    .flatMap((value) => value.split(":"))
    .map((value) => value.replaceAll("-", " ").trim())
    .filter((value) => value.length > 2);
}

export function classifyCommittedConversation(
  message: string,
  trip: ConversationTripContext,
): CommittedConversationIntent {
  if (activitySuggestionPattern.test(message) && activitySubjectPattern.test(message)) {
    return "activity_suggestion";
  }
  if (modificationPattern.test(message)) return "modify_trip";
  if (deterministicTripPattern.test(message) && explanationPattern.test(message)) {
    return "explain_trip";
  }
  const mentionsTripPlace = tripTerms(trip).some((term) =>
    message.toLocaleLowerCase("en").includes(term.toLocaleLowerCase("en")),
  );
  if (travelContextPattern.test(message) || mentionsTripPlace) return "travel_context";
  return "unsupported";
}

export function contextualizedMessage(
  message: string,
  history: Array<{ role: "user" | "assistant"; text: string }> = [],
): string {
  const qualifierOnly = /^(?:(?:for|on)\s+)?(?:day\s*\d+|\d{4}-\d{2}-\d{2})(?:\s+(?:only|instead))?[.!?\s]*$/i.test(message)
    || /^(?:that|it|this one|the same)(?:\s+(?:one|option))?[.!?\s]*$/i.test(message);
  if (!qualifierOnly) return message;
  const priorRequest = [...history].reverse().find((entry) =>
    entry.role === "user" && /\b(?:add|change|replace|remove|delete|cheaper|lock|unlock|update|move|reschedule|increase|decrease|make|swap|suggest|recommend)\b/i.test(entry.text),
  );
  return priorRequest ? `${priorRequest.text.replace(/[.!?\s]+$/, "")} ${message}` : message;
}
