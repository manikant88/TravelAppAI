"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { useEffect, useState } from "react";
import type { TripRequest } from "@/domain/model";

type PlanningPhase = "scanning_route" | "searching_stays" | "searching_activities" | "validating";

let planningAnimationPromise: Promise<ArrayBuffer> | undefined;

function loadPlanningAnimation(): Promise<ArrayBuffer> {
  planningAnimationPromise ??= fetch("/animations/travel-planning.lottie").then((response) => {
    if (!response.ok) throw new Error("Planning animation is unavailable");
    return response.arrayBuffer();
  });
  return planningAnimationPromise;
}

export function PlanningAnimation({ phase, request, origin: suppliedOrigin, status }: { phase: PlanningPhase; request?: TripRequest; origin?: string | null; status?: string }) {
  const [animationData, setAnimationData] = useState<ArrayBuffer>();
  useEffect(() => {
    let mounted = true;
    void loadPlanningAnimation()
      .then((data) => {
        if (mounted) setAnimationData(data.slice(0));
      })
      .catch(() => {
        // The copy remains a complete loading state if the optional animation fails.
      });
    return () => { mounted = false; };
  }, []);
  const title = phase === "scanning_route" ? "Scanning the route" : phase === "searching_stays" ? "Checking stays" : phase === "searching_activities" ? "Finding activities" : "Validating the trip";
  const detail = status || (phase === "scanning_route" ? "Understanding the places, dates, travellers, and preferences you shared" : phase === "searching_stays" ? "Matching stays to your dates, guests, and budget" : phase === "searching_activities" ? "Looking for experiences that fit your interests" : "Checking timing, prices, and availability");
  const rawOrigin = suppliedOrigin ?? request?.origin;
  const origin = rawOrigin ? rawOrigin.replace(/^(city|airport):/, "").replaceAll("-", " ") : "your request";
  return (
    <div className={`planning-animation planning-animation-${phase}`} role="status" aria-live="polite">
      <div className="planning-lottie" aria-hidden="true">
        {animationData ? <DotLottieReact data={animationData} autoplay loop /> : null}
      </div>
      <div className="planning-animation-copy" key={phase}><span>{title}</span><strong>{detail}</strong><small>Searching from {origin}. Grounded inventory is checked before anything becomes your trip.</small></div>
    </div>
  );
}
