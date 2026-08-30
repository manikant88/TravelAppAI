import HomeGlobe, { type HomeMarket } from "@/ui/home-globe";
import { travelInventorySeed } from "@/db/seed/data";

export default function Home() {
  const images = new Map(travelInventorySeed.imageAssets.map((asset) => [asset.key, asset.url]));
  const locations = new Map(travelInventorySeed.locations.map((location) => [location.id, location]));
  const markets: HomeMarket[] = travelInventorySeed.markets
    .toSorted((left, right) => left.displayOrder - right.displayOrder)
    .flatMap((market, index) => {
      const location = locations.get(market.locationId);
      if (!location || typeof location.latitudeE6 !== "number" || typeof location.longitudeE6 !== "number") return [];
      const tags = (location.tags ?? []).filter((tag) => tag !== "origin_hub" && tag !== "multi_stop");
      const country = location.parentId ? locations.get(location.parentId)?.name : undefined;
      const slug = location.id.split(":")[1];
      return [{
        id: location.id,
        name: location.name,
        country: country ?? location.countryCode,
        lat: location.latitudeE6 / 1_000_000,
        lng: location.longitudeE6 / 1_000_000,
        tags: tags.slice(0, 3),
        imageUrl: location.imageAssetKey ? images.get(location.imageAssetKey) : images.get(`activity-${slug}-highlights`),
        prompt: scenarioPrompt(location.name, tags, index),
      }];
    });
  return <HomeGlobe markets={markets} />;
}

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
