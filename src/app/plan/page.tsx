import LiveWorkspace from "@/ui/live-workspace";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const { prompt: rawPrompt } = await searchParams;
  const prompt = rawPrompt?.trim().slice(0, 1_200) ?? "";
  return <LiveWorkspace initialPrompt={prompt} autoSubmitInitialPrompt={Boolean(prompt)} />;
}
