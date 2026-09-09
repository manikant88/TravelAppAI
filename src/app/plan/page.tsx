import TravelWorkspace from "@/ui/workspace";
import LiveWorkspace from "@/ui/live-workspace";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ prompt?: string; mode?: string }> }) {
  const { prompt: rawPrompt, mode } = await searchParams;
  const prompt = rawPrompt?.trim().slice(0, 1_200) ?? "";
  if (mode === "snapshot") return <TravelWorkspace initialPrompt={prompt} autoSubmitInitialPrompt={Boolean(prompt)} />;
  return <LiveWorkspace initialPrompt={prompt} autoSubmitInitialPrompt={Boolean(prompt)} />;
}
