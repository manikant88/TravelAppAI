export function scheduleInitialPrompt(submit: () => void) {
  const timer = setTimeout(submit, 0);
  return () => clearTimeout(timer);
}
