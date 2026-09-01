import { redirect } from "next/navigation";
import TravelWorkspace from "@/ui/workspace";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  const { prompt: rawPrompt } = await searchParams;
  const prompt = rawPrompt?.trim().slice(0, 1_200);
  if (!prompt) redirect("/");

  return <TravelWorkspace initialPrompt={prompt} autoSubmitInitialPrompt />;
}
