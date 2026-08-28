"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import type { TripRequest } from "@/domain/model";

type PlanningPhase = "scanning_route" | "searching_stays" | "searching_activities" | "validating";

export function PlanningAnimation({ phase, request }: { phase: PlanningPhase; request: TripRequest }) {
  const title = phase === "scanning_route" ? "Scanning the route" : phase === "searching_stays" ? "Checking stays" : phase === "searching_activities" ? "Finding activities" : "Validating the trip";
  const detail = phase === "scanning_route" ? "Finding a connected way from your origin" : phase === "searching_stays" ? "Matching stays to your dates, guests, and budget" : phase === "searching_activities" ? "Looking for experiences that fit your interests" : "Checking timing, prices, and availability";
  const origin = request.origin ? request.origin.replace(/^(city|airport):/, "").replaceAll("-", " ") : "your origin";
  return (
    <div className={`planning-animation planning-animation-${phase}`} role="status" aria-live="polite">
      <div className="planning-lottie" aria-hidden="true"><DotLottieReact src="/animations/travel-planning.lottie" autoplay loop /></div>
      <div className="planning-animation-copy"><span>{title}</span><strong>{detail}</strong><small>Searching from {origin}. Grounded inventory is checked before anything becomes your trip.</small></div>
    </div>
  );
}
