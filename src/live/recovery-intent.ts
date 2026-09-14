export const LIVE_SEARCH_RETRY_INSTRUCTION = 'Repeat the live searches that did not finish and plan again with the rest of my Trip Brief unchanged.';

export function isLiveSearchRetryRequest(message: string) {
  return message.includes(LIVE_SEARCH_RETRY_INSTRUCTION);
}
