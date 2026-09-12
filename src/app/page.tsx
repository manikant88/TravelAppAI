import HomeGlobe, { type HomeMarket } from "@/ui/home-globe";

export default function Home() {
  const markets: HomeMarket[] = destinationIdeas.map((market, index) => ({
    ...market,
    id: `destination:${market.name.toLocaleLowerCase("en").replaceAll(" ", "-")}`,
    prompt: scenarioPrompt(market.name, market.tags, index),
  }));
  return <HomeGlobe markets={markets} />;
}

const destinationIdeas: Array<Omit<HomeMarket, "id" | "prompt">> = [
  { name: "Udaipur", country: "India", lat: 24.5854, lng: 73.7125, tags: ["lakes", "heritage", "food"] },
  { name: "Darjeeling", country: "India", lat: 27.041, lng: 88.2663, tags: ["hills", "tea", "heritage"] },
  { name: "Goa", country: "India", lat: 15.2993, lng: 74.124, tags: ["beaches", "food", "nightlife"] },
  { name: "Kochi", country: "India", lat: 9.9312, lng: 76.2673, tags: ["coast", "culture", "food"] },
  { name: "Jaipur", country: "India", lat: 26.9124, lng: 75.7873, tags: ["forts", "markets", "food"] },
  { name: "Leh", country: "India", lat: 34.1526, lng: 77.5771, tags: ["mountains", "monasteries", "scenery"] },
  { name: "Bangkok", country: "Thailand", lat: 13.7563, lng: 100.5018, tags: ["food", "markets", "culture"] },
  { name: "Singapore", country: "Singapore", lat: 1.3521, lng: 103.8198, tags: ["food", "architecture", "family"] },
  { name: "Dubai", country: "United Arab Emirates", lat: 25.2048, lng: 55.2708, tags: ["architecture", "shopping", "desert"] },
  { name: "Bali", country: "Indonesia", lat: -8.4095, lng: 115.1889, tags: ["beaches", "temples", "wellness"] },
  { name: "Rome", country: "Italy", lat: 41.9028, lng: 12.4964, tags: ["history", "food", "art"] },
  { name: "Sydney", country: "Australia", lat: -33.8688, lng: 151.2093, tags: ["harbour", "beaches", "food"] },
];

function scenarioPrompt(name: string, tags: string[], index: number): string {
  const themes = tags.filter((tag) => !["origin_hub", "multi_stop"].includes(tag)).slice(0, 3).join(", ");
  const scenarios = [
    `Plan a relaxed trip from Delhi to ${name} for two adults from 10 October 2026 to 13 October 2026. Prioritise ${themes}, comfortable travel, and a balanced itinerary.`,
    `Plan a family-friendly holiday from Delhi to ${name} for two adults and one child from 10 October 2026 to 14 October 2026. Prioritise ${themes}, comfortable travel, and a relaxed pace.`,
    `Plan an adventurous friends trip from Delhi to ${name} for four adults from 10 October 2026 to 13 October 2026. Balance ${themes} with downtime and keep the itinerary practical.`,
    `Plan a calm solo escape from Delhi to ${name} for one adult from 10 October 2026 to 12 October 2026. Focus on ${themes}, minimal travel effort, and a comfortable stay.`,
  ];
  return scenarios[index % scenarios.length]!;
}
