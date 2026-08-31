"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import ThreeGlobe from "@/ui/three-globe";
import { Button } from "@/ui/components/primitives";
import { AppIcon } from "@/ui/components/app-icon";

export interface HomeMarket {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  tags: string[];
  imageUrl?: string;
  prompt: string;
}

export default function HomeGlobe({ markets }: { markets: HomeMarket[] }) {
  const router = useRouter();
  const [active, setActive] = useState<HomeMarket>();
  const [prompt, setPrompt] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  function choose(market: HomeMarket) {
    setPrompt(market.prompt);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(market.prompt.length, market.prompt.length);
    });
  }

  function submit() {
    const value = prompt.trim();
    if (value.length < 3) return;
    router.push(`/plan?prompt=${encodeURIComponent(value)}`);
  }

  return (
    <main className="globe-home">
      <div className="globe-home-art" aria-hidden="true">
        <span className="globe-ribbon globe-ribbon-left" />
        <span className="globe-ribbon globe-ribbon-right" />
      </div>
      <section className="globe-home-copy">
        <header className="globe-home-header">
          <Link className="mmt-logo-link" href="/" aria-label="Go to MakeMyTrip trip planner home">
            <Image src="/figma/itinerary/mmt-logo.png" alt="MakeMyTrip" width={169} height={40} priority />
          </Link>
        </header>
        <h1>Where could your next trip take you?</h1>
        <span>Tell me what matters and I&apos;ll turn it into a grounded, day-by-day itinerary.</span>
      </section>
      <div className="globe-stage" aria-label="Supported destinations around the world">
        <ThreeGlobe markets={markets} activeMarket={active} onHover={setActive} onLeave={() => setActive(undefined)} onSelect={choose} />
      </div>
      <form className={prompt.trim() ? "globe-composer is-populated" : "globe-composer"} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="globe-composer-field">
          <label className="globe-composer-label" htmlFor="home-trip-prompt">Ask your AI trip planner</label>
          <Image className="globe-composer-sparkle" src="/figma/home/sparkle.svg" alt="" width={22} height={22} aria-hidden="true" />
          <textarea ref={composerRef} id="home-trip-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Try: Plan a relaxed four-day coastal escape for two, with great food, minimal travel, and a comfortable stay…" />
          <Button type="submit" disabled={prompt.trim().length < 3}>Build my trip <AppIcon name="arrow-right" size={16} /></Button>
        </div>
        <p className="globe-composer-hint" aria-live="polite">
          {prompt.trim() ? "Your idea is ready to refine before planning." : "Hover a destination for inspiration, or start with your own idea."}
        </p>
      </form>
    </main>
  );
}
