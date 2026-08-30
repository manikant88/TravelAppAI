import TravelWorkspace from "@/ui/workspace";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const { prompt } = await searchParams;
  return <TravelWorkspace initialPrompt={prompt?.slice(0, 1_200)} autoSubmitInitialPrompt />;
}
