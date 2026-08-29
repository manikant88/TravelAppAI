"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { SpecifiedPlanApiResult } from "@/agent/plan-api";
import type {
  DestinationDiscoveryApiResult,
  DestinationOption,
} from "@/agent/discovery";
import type { ModificationResult } from "@/agent/modification-contracts";
import type { ExplanationResult } from "@/agent/explanation-contracts";
import type { NaturalIntakeResponse } from "@/agent/natural-intake-contracts";
import type {
  Constraint,
  Traveller,
  TripRequest,
  TripState,
} from "@/domain/model";
import type {
  HydratedSelection,
  TripProjection,
} from "@/domain/trip";
import type {
  ActivityOffer,
  LocationSearchResult,
  SearchResponse,
  StayOffer,
  TransferOffer,
  TransportOffer,
} from "@/inventory/contracts";
import {
  initialWorkspaceState,
  workspaceReducer,
} from "@/state";
import type { TripProposal } from "@/domain/proposals";
import { cachedInventoryPost } from "@/ui/inventory-cache";
import { PlanningAnimation } from "@/ui/planning-animation";
import {
  interactionPresentationSchema,
  type GuidedAction,
  type InteractionEvent,
  type InteractionPresentation,
} from "@/agent/interaction-contracts";
import { completePlanningEvents, planningEvents } from "@/agent/interaction-guidance";

type InventoryReadiness = "checking" | "ready" | "unavailable";
type BriefFact = "origin" | "destination" | "dates" | "guests" | "preferences";
type InventoryPicker =
  | { kind: "travel"; selectionId: string; currentOfferId: string; offers: Array<TransportOffer | TransferOffer>; loading: boolean; error?: string }
  | { kind: "stay"; selectionId: string; currentOfferId: string; offers: StayOffer[]; loading: boolean; error?: string }
  | { kind: "activity"; date: string; selectionId?: string; currentOfferId?: string; offers: ActivityOffer[]; loading: boolean; error?: string };

const MINIMUM_PLANNING_VISIBLE_MS = 5_000;
const GUIDED_CHANGE_VISIBLE_MS = 6_000;

function minimumPlanningVisibility(): Promise<void> {
  return new Promise<void>((resolve) => window.setTimeout(resolve, MINIMUM_PLANNING_VISIBLE_MS));
}

function waitForUi(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function operationId(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function messageId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function displayLocation(id: string): string {
  const value = id.split(":").at(-1) ?? id;
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function formatDateTime(value?: string): string | undefined {
  if (!value) return undefined;
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function formatCompactDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours}h` : undefined, remainder ? `${remainder}m` : undefined]
    .filter(Boolean)
    .join(" ");
}

function stayImage(offer: StayOffer): string | undefined {
  return offer.propertyFacts.imageUrl;
}

function activityImage(offer: ActivityOffer): string | undefined {
  return offer.activityFacts.imageUrl;
}

function SkeletonImage({
  src,
  alt,
  className,
  fill,
  width,
  height,
  sizes,
}: {
  src?: string;
  alt: string;
  className?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const imageSrc = status === "failed" ? undefined : src;
  return (
    <span className={`skeleton-image ${status === "loaded" ? "loaded" : ""} ${!imageSrc ? "missing" : ""} ${className ?? ""}`}>
      <span className="image-skeleton" aria-hidden="true" />
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={alt}
          fill={fill}
          width={fill ? undefined : width}
          height={fill ? undefined : height}
          sizes={sizes}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("failed")}
        />
      ) : (
        <span className="image-missing" aria-hidden="true">Image pending</span>
      )}
    </span>
  );
}

function dayAnchor(date: string): string {
  return `itinerary-day-${date}`;
}

function travellerSummary(travellers: Traveller[]): string {
  const adults = travellers.filter((traveller) => traveller.type === "adult").length;
  const children = travellers.filter((traveller) => traveller.type === "child").length;
  const seniors = travellers.filter((traveller) => traveller.type === "senior").length;
  return [
    adults ? `${adults} adult${adults === 1 ? "" : "s"}` : undefined,
    children ? `${children} child${children === 1 ? "" : "ren"}` : undefined,
    seniors ? `${seniors} senior${seniors === 1 ? "" : "s"}` : undefined,
  ].filter(Boolean).join(" · ");
}

function isTransport(offer: HydratedSelection["offer"]): offer is TransportOffer {
  return "serviceId" in offer;
}

function isTransfer(offer: HydratedSelection["offer"]): offer is TransferOffer {
  return "transferId" in offer;
}

function isStay(offer: HydratedSelection["offer"]): offer is StayOffer {
  return "roomOfferId" in offer;
}

function isActivity(offer: HydratedSelection["offer"]): offer is ActivityOffer {
  return "sessionId" in offer;
}

function isPlanResult(value: unknown): value is SpecifiedPlanApiResult {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "trip_ready" || type === "clarification" || type === "conflict";
}

function isDestinationDiscoveryResult(value: unknown): value is DestinationDiscoveryApiResult {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "destination_options" || type === "conflict";
}

function isModificationResult(value: unknown): value is ModificationResult {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "proposal" || type === "alternatives" || type === "conflict";
}

function isExplanationResult(value: unknown): value is ExplanationResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "explanation" &&
      typeof (value as { message?: unknown }).message === "string",
  );
}

function isNaturalIntakeResponse(value: unknown): value is NaturalIntakeResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as {
    request?: unknown;
    appliedFields?: unknown;
    missingRequired?: unknown;
    issues?: unknown;
    message?: unknown;
  };
  return Boolean(
    item.request &&
      Array.isArray(item.appliedFields) &&
      Array.isArray(item.missingRequired) &&
      Array.isArray(item.issues) &&
      typeof item.message === "string",
  );
}

interface LocationFieldProps {
  id: string;
  label: string;
  placeholder: string;
  selectedId?: string;
  selectedLabel: string;
  onSelectedLabelChange(value: string): void;
  onSelect(location?: LocationSearchResult): void;
  disabled?: boolean;
}

function LocationField({
  id,
  label,
  placeholder,
  selectedId,
  selectedLabel,
  onSelectedLabelChange,
  onSelect,
  disabled = false,
}: LocationFieldProps) {
  const [options, setOptions] = useState<LocationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = selectedLabel.trim();
    if (disabled || selectedId || query.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/locations/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Location search failed");
        const body = (await response.json()) as SearchResponse<LocationSearchResult>;
        setOptions(body.results);
        setOpen(true);
      } catch (error: unknown) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setOptions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [disabled, selectedId, selectedLabel]);

  return (
    <div className="field location-field">
      <label>{label}</label>
      <div className="location-input-wrap">
        <span className="field-icon" aria-hidden="true">
          <PinIcon />
        </span>
        <input
          id={id}
          disabled={disabled}
          value={selectedLabel}
          placeholder={placeholder}
          role="combobox"
          aria-controls={`${id}-results`}
          aria-expanded={open && options.length > 0}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setOptions([]);
            setLoading(false);
            onSelectedLabelChange(event.target.value);
            if (selectedId) onSelect(undefined);
          }}
        />
        {selectedId ? <span className="verified-dot" title="Normalized location" /> : null}
        {loading ? <span className="mini-spinner" aria-label="Searching locations" /> : null}
      </div>
      {open && !selectedId && selectedLabel.trim().length >= 2 ? (
        <div id={`${id}-results`} className="location-results" role="listbox">
          {options.length > 0 ? (
            options.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelectedLabelChange(option.name);
                  onSelect(option);
                  setOpen(false);
                }}
              >
                <span>{option.name}</span>
                <small>
                  {option.airportCode ? `${option.airportCode} · ` : ""}
                  {option.type} · {option.countryCode}
                </small>
              </button>
            ))
          ) : loading ? null : (
            <p>No supported location found</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s6-5.1 6-12a6 6 0 1 0-12 0c0 6.9 6 12 6 12Z" />
      <circle cx="12" cy="9" r="2.2" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2 1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2Z" />
      <path d="m19 15 .8 2.3L22 18l-2.2.7L19 21l-.8-2.3L16 18l2.2-.7L19 15Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

function PlanningState({ elapsed, mode, request }: { elapsed: number; mode: "discovering" | "planning"; request: TripRequest }) {
  const discovering = mode === "discovering";
  const phase = discovering ? "scanning_route" : elapsed < 3 ? "scanning_route" : elapsed < 7 ? "searching_stays" : elapsed < 11 ? "searching_activities" : "validating";
  return (
    <div className="planning-state" role="status" aria-live="polite">
      <PlanningAnimation phase={phase} request={request} />
      <div className="planning-meta">
        <span className="live-dot" />
        Working for {elapsed}s
      </div>
    </div>
  );
}

function EmptyWorkspace() {
  return (
    <div className="empty-workspace">
      <div className="empty-visual" aria-hidden="true">
        <div className="route-node start" />
        <div className="route-line" />
        <div className="route-node middle" />
        <div className="route-line second" />
        <div className="route-node end" />
      </div>
      <p className="eyebrow">One connected workspace</p>
      <h2>Your itinerary will take shape here</h2>
      <p>
        Add the essentials in your Trip Brief. The agent can choose among valid options, while code
        remains responsible for prices, dates, routes, and final validation.
      </p>
      <div className="trust-row">
        <span>Grounded inventory</span>
        <span>Explicit trade-offs</span>
        <span>Direct, validated selection</span>
      </div>
    </div>
  );
}

type QuickStart = {
  id: string;
  title: string;
  image: string;
  prompt: string;
  originLabel: string;
  destinationLabel: string;
  request: TripRequest;
};

function presetTravellers(types: Traveller["type"][]): Traveller[] {
  return types.map((type, index) => ({ id: `traveller:${index + 1}`, type }));
}

function maximumBudget(amount: number): Constraint {
  return {
    id: "constraint:budget:all",
    category: "budget",
    priority: "hard",
    value: { maxTotal: { amount, currency: "INR" } },
  };
}

const quickStarts = [
  {
    id: "weekend",
    title: "Weekend Getaway",
    image: "/figma/start/weekend.jpeg",
    prompt: "3-day weekend trip from Delhi this Saturday for 2 people. Budget ₹45K. Flexible destination, relaxing vibe, great food, minimal travel.",
    originLabel: "Delhi",
    destinationLabel: "",
    request: {
      origin: "city:delhi",
      destination: { kind: "open" },
      startDate: "2026-08-29",
      endDate: "2026-08-30",
      travellers: presetTravellers(["adult", "adult"]),
      preferences: { pace: "relaxed", interests: ["food", "relaxation"] },
      constraints: [maximumBudget(15_000)],
    },
  },
  {
    id: "family",
    title: "A Family Trip",
    image: "/figma/start/family.jpeg",
    prompt: "5-day Goa trip from Delhi starting 15 Dec for 6 people. Budget ₹1.8L. Family-friendly, relaxed pace, kid and senior friendly.",
    originLabel: "Delhi",
    destinationLabel: "Goa",
    request: {
      origin: "city:delhi",
      destination: { kind: "specified", locationId: "city:goa" },
      startDate: "2026-12-15",
      endDate: "2026-12-19",
      travellers: presetTravellers(["adult", "adult", "adult", "adult", "child", "senior"]),
      preferences: { pace: "relaxed", interests: ["family", "food"] },
      constraints: [maximumBudget(180_000)],
    },
  },
  {
    id: "group",
    title: "A Group Trip",
    image: "/figma/start/group.jpeg",
    prompt: "4-day trip from Bangalore starting 10 Oct for 6 friends. Budget ₹20K–₹35K per person. Balance adventure and relaxation.",
    originLabel: "Bengaluru",
    destinationLabel: "",
    request: {
      origin: "city:bengaluru",
      destination: { kind: "open" },
      startDate: "2026-10-10",
      endDate: "2026-10-13",
      travellers: presetTravellers(["adult", "adult", "adult", "adult", "adult", "adult"]),
      preferences: { pace: "balanced", interests: ["adventure", "relaxation"] },
      constraints: [maximumBudget(210_000)],
    },
  },
  {
    id: "escape",
    title: "A Short Escape",
    image: "/figma/start/escape.jpeg",
    prompt: "4-day getaway from Bangalore starting Thursday for 1 person. Budget ₹40K. Extend my work trip with a relaxing holiday nearby.",
    originLabel: "Bengaluru",
    destinationLabel: "",
    request: {
      origin: "city:bengaluru",
      destination: { kind: "open" },
      startDate: "2026-09-03",
      endDate: "2026-09-06",
      travellers: presetTravellers(["adult"]),
      preferences: { pace: "relaxed", interests: ["relaxation"] },
      constraints: [maximumBudget(40_000)],
    },
  },
] satisfies QuickStart[];

function QuickStartGrid({ busy, onSelect }: { busy: boolean; onSelect(item: QuickStart): void }) {
  return (
    <section className="quick-start-grid" aria-label="Quick start trip ideas">
      {quickStarts.map((item) => (
        <article className="quick-start-card" key={item.id}>
          <Image src={item.image} alt="" width={840} height={420} sizes="(max-width: 820px) 100vw, 40vw" loading="eager" />
          <div>
            <h2>{item.title}</h2>
            <p>{item.prompt}</p>
            <button type="button" disabled={busy} onClick={() => onSelect(item)}>Try this <span aria-hidden="true">→</span></button>
          </div>
        </article>
      ))}
    </section>
  );
}

type DestinationOptionsResult = Extract<
  DestinationDiscoveryApiResult,
  { type: "destination_options" }
>;

const comparisonFactDimensions = {
  price: ["price_floor"],
  duration: ["travel_minutes"],
  activity_fit: ["theme_matches", "activity_options"],
  pace: ["themes"],
  location: ["region", "country"],
} as const;

function formatDestinationFact(dimension: string, value: string | number | boolean): string {
  if (dimension.endsWith("floor") && typeof value === "number") return formatMoney(value);
  if (dimension === "travel_minutes" && typeof value === "number") {
    return `${Math.floor(value / 60)}h ${value % 60}m return travel`;
  }
  if (dimension === "theme_matches" && typeof value === "number") {
    return `${value} interest match${value === 1 ? "" : "es"}`;
  }
  if (dimension === "activity_options" && typeof value === "number") {
    return `${value} dated activities`;
  }
  return String(value);
}

function DestinationComparison({
  result,
  busy,
  onSelect,
}: {
  result: DestinationOptionsResult;
  busy: boolean;
  onSelect(option: DestinationOption): void;
}) {
  const factsByMarket = new Map<string, typeof result.factBundle.facts>();
  for (const fact of result.factBundle.facts) {
    factsByMarket.set(fact.subjectId, [...(factsByMarket.get(fact.subjectId) ?? []), fact]);
  }
  const preferredDimensions = (result.block.emphasis?.comparisonDimensions ?? []).flatMap(
    (dimension) =>
      comparisonFactDimensions[dimension as keyof typeof comparisonFactDimensions] ?? [],
  );
  const supportingFacts = new Set(result.block.emphasis?.supportingFactIds ?? []);

  return (
    <section className="destination-comparison" aria-labelledby="destination-options-title">
      <header className="destination-comparison-heading">
        <div>
          <p className="eyebrow">Grounded destination comparison</p>
          <h2 id="destination-options-title">Choose where to continue</h2>
          <p>{result.message}</p>
        </div>
        <span>{result.options.length} valid markets</span>
      </header>
      <div className="destination-option-grid">
        {result.options.map((option) => {
          const recommended = option.id === result.block.emphasis?.recommendedId;
          const allFacts = factsByMarket.get(option.id) ?? [];
          const facts = preferredDimensions
            .map((dimension) => allFacts.find((fact) => fact.dimension === dimension))
            .filter((fact): fact is (typeof allFacts)[number] => Boolean(fact))
            .filter((fact, index, items) => items.findIndex((item) => item.id === fact.id) === index)
            .slice(0, 3);
          return (
            <article className={recommended ? "destination-option recommended" : "destination-option"} key={option.id}>
              <div className="destination-option-art" aria-hidden="true">
                <span>{option.countryCode}</span>
              </div>
              <div className="destination-option-body">
                <div className="destination-option-labels">
                  <span>{option.region}</span>
                  {recommended ? <strong>Recommended</strong> : null}
                </div>
                <h3>{option.name}</h3>
                <div className="chip-row">
                  {option.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <dl>
                  {facts.map((fact) => (
                    <div key={fact.id}>
                      <dt>{fact.label}</dt>
                      <dd>{formatDestinationFact(fact.dimension, fact.value)}</dd>
                      {supportingFacts.has(fact.id) ? <i title="Used by the planner recommendation">Grounded</i> : null}
                    </div>
                  ))}
                </dl>
                <button type="button" disabled={busy} onClick={() => onSelect(option)}>
                  Continue with {option.name}
                  <ArrowIcon />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="comparison-disclosure">
        Prices are conservative floors from currently seeded offers, not booking quotes. Selecting a destination starts the same validated PLAN workflow used for direct destination requests.
      </p>
    </section>
  );
}

function TravelCard({ item }: { item: HydratedSelection }) {
  const { offer } = item;
  if (isTransport(offer)) {
    return (
      <article className="itinerary-card itinerary-flight-card">
        <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true">✈</span><strong>{offer.mode} · {displayLocation(offer.from)} to {displayLocation(offer.to)} · {durationLabel(offer.durationMinutes)}</strong></header>
        <div className="flight-card-body">
          <div className="airline-mark" aria-hidden="true">✈</div>
          <div className="flight-stop"><strong>{offer.departureAt.slice(11, 16)}</strong><span>{formatCompactDateTime(offer.departureAt)}</span><small>{displayLocation(offer.from)}</small></div>
          <div className="flight-line"><i /><span>✈</span></div>
          <div className="flight-stop"><strong>{offer.arrivalAt.slice(11, 16)}</strong><span>{formatCompactDateTime(offer.arrivalAt)}</span><small>{displayLocation(offer.to)}</small></div>
          <dl className="flight-facts"><div><dt>Operator</dt><dd>{offer.operator}</dd></div><div><dt>Stops</dt><dd>{offer.stops === 0 ? "Non-stop" : `${offer.stops} stop${offer.stops === 1 ? "" : "s"}`}</dd></div></dl>
          <div className="card-price"><strong>{formatMoney(offer.price.amount)}</strong><span>/ traveller</span></div>
        </div>
        <div className="card-grounding"><span>Selected from currently valid transport inventory for this route and date.</span></div>
      </article>
    );
  }
  if (isTransfer(offer)) {
    return (
      <article className="itinerary-card itinerary-transfer-card">
        <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true">▰</span><strong>Transfer · {displayLocation(offer.from)} to {displayLocation(offer.to)}</strong></header>
        <div className="transfer-card-body">
          <div className="transfer-illustration" aria-hidden="true">🚗</div>
          <div><h3>{offer.mode === "shared" ? "Shared transfer" : "Private transfer"}</h3><p>A direct connection between the selected arrival point and stay area.</p><span>⌖ {displayLocation(offer.from)} to {displayLocation(offer.to)}</span><small>{durationLabel(offer.durationMinutes)} · capacity {offer.capacity} · {formatMoney(offer.price.amount)} / vehicle</small></div>
        </div>
      </article>
    );
  }
  return null;
}

function StayCard({ item, travellerCount, onModify }: { item: HydratedSelection; travellerCount: number; onModify(): void }) {
  if (!isStay(item.offer)) return null;
  const offer = item.offer;
  const nights = Math.max(1, Math.round((new Date(offer.checkOut).getTime() - new Date(offer.checkIn).getTime()) / 86400000));
  const image = stayImage(offer);
  return (
    <article className="itinerary-card itinerary-hotel-card">
      <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true">▦</span><strong>Hotel · {nights} night{nights === 1 ? "" : "s"} · {displayLocation(offer.locationId)}</strong></header>
      <div className="hotel-card-body">
        <div className="hotel-gallery">
          <SkeletonImage src={image} alt={offer.propertyFacts.imageAltText ?? offer.propertyFacts.name} width={320} height={216} />
          <div aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <span key={index} style={image ? { backgroundImage: `url(${image})` } : undefined}>
                {index === 3 ? <>1+<small>view all</small></> : null}
              </span>
            ))}
          </div>
        </div>
        <div className="hotel-details">
          <div className="hotel-rating"><strong>{offer.propertyFacts.rating.toFixed(1)}</strong><span>{offer.propertyFacts.rating >= 4.5 ? "Excellent" : offer.propertyFacts.rating >= 4 ? "Very Good" : "Good"}</span><small>({offer.propertyFacts.reviewCount} ratings)</small></div>
          <h3>{offer.propertyFacts.name}</h3>
          <p>{offer.roomFacts.roomLabel} · {offer.roomFacts.mealPlan === "breakfast" ? "Breakfast included" : "Room only"}</p>
          <div className="card-price"><strong>{formatMoney(offer.price.amount)}</strong><span>/ per night</span></div>
          <ul><li>{offer.rooms} room{offer.rooms === 1 ? "" : "s"} · {travellerCount} traveller{travellerCount === 1 ? "" : "s"}</li><li>{formatDate(offer.checkIn)} – {formatDate(offer.checkOut)}</li><li>{offer.roomFacts.refundable ? "Refundable" : "Non-refundable"}</li></ul>
          <button type="button" className="inline-card-action" onClick={onModify}>Modify room</button>
        </div>
      </div>
      <div className="card-grounding"><span>Rated {offer.propertyFacts.rating.toFixed(1)} from {offer.propertyFacts.reviewCount} reviews. {offer.propertyFacts.amenities.slice(0, 2).join(" and ")} are listed amenities.</span><button type="button">Read more</button></div>
    </article>
  );
}

function ActivityCard({ item, onModify }: { item: HydratedSelection; onModify(): void }) {
  if (!isActivity(item.offer)) return null;
  const offer = item.offer;
  const durationMinutes = Math.round((new Date(offer.endsAt).getTime() - new Date(offer.startsAt).getTime()) / 60000);
  return (
    <article className="itinerary-card itinerary-activity-card">
      <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true">▧</span><strong>Activity · {durationLabel(durationMinutes)} · {displayLocation(offer.locationId)}</strong></header>
      <div className="activity-card-body">
        <SkeletonImage src={activityImage(offer)} alt={offer.activityFacts.imageAltText ?? offer.activityFacts.name} width={320} height={240} />
        <div><h3>{offer.activityFacts.name}</h3><p>{formatDateTime(offer.startsAt)} – {formatDateTime(offer.endsAt)}</p><div className="card-price"><strong>{formatMoney(offer.price.amount)}</strong><span>/ per person</span></div><ul><li>Duration {durationLabel(durationMinutes)}</li><li>{offer.activityFacts.mobility} mobility</li><li>Capacity {offer.capacity}</li></ul><button type="button" className="inline-card-action" onClick={onModify}>Modify activity</button></div>
      </div>
      <div className="card-grounding"><span>{offer.activityFacts.tags.slice(0, 3).join(" · ")}. Suitability and schedule are validated against this trip.</span><button type="button">Read more</button></div>
    </article>
  );
}

function SelectionActions({
  locked,
  busy,
  onToggleLock,
  alternativeLabel,
  onBrowseAlternatives,
}: {
  locked: boolean;
  busy: boolean;
  onToggleLock(): void;
  alternativeLabel?: string;
  onBrowseAlternatives?(): void;
}) {
  return (
    <div className="selection-actions">
      <button type="button" disabled={busy} onClick={onToggleLock}>{locked ? "Unlock" : "Lock"}</button><span>·</span>
      {onBrowseAlternatives ? <button type="button" disabled={busy} onClick={onBrowseAlternatives}>{alternativeLabel ?? "Change"}</button> : null}
    </div>
  );
}

function InventoryOptionPicker({ picker, busy, selectingOfferId, onSelect, onClose }: {
  picker: InventoryPicker;
  busy: boolean;
  selectingOfferId?: string;
  onSelect(offer: TransportOffer | TransferOffer | StayOffer | ActivityOffer): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const title = picker.kind === "travel" ? "Change Travel" : picker.kind === "stay" ? "Change Hotel" : picker.selectionId ? "Change Activity" : "Add Activity";
  const noun = picker.kind === "travel" ? "travel options" : picker.kind === "stay" ? "stays" : "activities";
  const currentPrice = picker.offers.find((offer) => offer.id === picker.currentOfferId)?.price.amount;
  const visibleOffers = picker.offers.filter((offer) => {
    const haystack = isTransport(offer)
      ? `${offer.operator} ${offer.mode} ${displayLocation(offer.from)} ${displayLocation(offer.to)}`
      : isTransfer(offer)
        ? `${offer.mode} ${displayLocation(offer.from)} ${displayLocation(offer.to)}`
        : isStay(offer)
          ? `${offer.propertyFacts.name} ${offer.roomFacts.roomLabel} ${offer.propertyFacts.amenities.join(" ")}`
          : `${offer.activityFacts.name} ${offer.activityFacts.tags.join(" ")}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });
  return (
    <div className="inventory-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="inventory-drawer" role="dialog" aria-modal="true" aria-labelledby="inventory-picker-title">
        <header className="inventory-drawer-header">
          <h2 id="inventory-picker-title">{title}</h2>
          <label><span className="sr-only">Search {noun}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${noun}`} /></label>
          <button type="button" aria-label="Close drawer" onClick={onClose}>×</button>
        </header>
        <div className="inventory-drawer-filter">Showing {visibleOffers.length} valid {noun} <span>· Sorted by best fit</span></div>
        <div className="inventory-drawer-list">
          {picker.loading ? <p className="inventory-picker-status">Checking dated availability…</p> : null}
          {picker.error ? <p className="inventory-picker-status error">{picker.error}</p> : null}
          {!picker.loading && !picker.error && visibleOffers.length === 0 ? <p className="inventory-picker-status">No matching valid inventory is available.</p> : null}
          {visibleOffers.map((offer) => {
            const selected = offer.id === picker.currentOfferId;
            const selecting = offer.id === selectingOfferId;
            const priceDelta = currentPrice === undefined ? offer.price.amount : offer.price.amount - currentPrice;
            return <article className={selected ? "drawer-option selected" : "drawer-option"} key={offer.id}>
              <div className="drawer-option-media">
                {isStay(offer) ? <SkeletonImage src={stayImage(offer)} alt="" fill sizes="220px" /> : isActivity(offer) ? <SkeletonImage src={activityImage(offer)} alt="" fill sizes="220px" /> : <span aria-hidden="true">{isTransfer(offer) ? "🚗" : "✈"}</span>}
                {selected ? <b>Selected</b> : null}
              </div>
              <div className="drawer-option-content">
                {isTransport(offer) ? <><h3>{offer.operator} · {offer.mode}</h3><p>{displayLocation(offer.from)} → {displayLocation(offer.to)}</p><small>{formatCompactDateTime(offer.departureAt)} · {durationLabel(offer.durationMinutes)} · {offer.stops === 0 ? "Non-stop" : `${offer.stops} stop`}</small></> : null}
                {isTransfer(offer) ? <><h3>{offer.mode === "shared" ? "Shared transfer" : "Private transfer"}</h3><p>{displayLocation(offer.from)} → {displayLocation(offer.to)}</p><small>{durationLabel(offer.durationMinutes)} · capacity {offer.capacity}</small></> : null}
                {isStay(offer) ? <><h3>{offer.propertyFacts.name}</h3><p>★ {offer.propertyFacts.rating.toFixed(1)} · {offer.propertyFacts.reviewCount} reviews</p><small>{offer.roomFacts.roomLabel} · {offer.roomFacts.mealPlan === "breakfast" ? "Includes breakfast" : "Room only"} · {offer.roomFacts.refundable ? "Refundable" : "Non-refundable"}</small></> : null}
                {isActivity(offer) ? <><h3>{offer.activityFacts.name}</h3><p>{formatDateTime(offer.startsAt)} · {offer.activityFacts.mobility} mobility</p><small>{offer.activityFacts.tags.slice(0, 3).join(" · ")}</small></> : null}
              </div>
              <div className="drawer-option-action">
                <strong>{selected ? "Current" : priceDelta === 0 ? "No price change" : `${priceDelta > 0 ? "+ " : "− "}${formatMoney(Math.abs(priceDelta))}`}</strong>
                <small>{isStay(offer) ? "per room / night" : isTransfer(offer) ? "per vehicle" : "per person"}</small>
                {selected ? <span>Selected</span> : <button type="button" disabled={busy || Boolean(selectingOfferId)} onClick={() => onSelect(offer)}>{selecting ? "Selecting…" : "Select"}</button>}
              </div>
            </article>;
          })}
        </div>
      </aside>
    </div>
  );
}

function Itinerary({
  trip,
  projection,
  busy,
  onToggleLock,
  onAddActivity,
  onBrowseTravel,
  onBrowseStay,
  onBrowseActivity,
  highlightedDay,
  highlightedSelectionId,
}: {
  trip: TripState;
  projection: TripProjection;
  busy: boolean;
  onToggleLock(selectionId: string, locked: boolean): void;
  onAddActivity(date: string): void;
  onBrowseTravel(selectionId: string): void;
  onBrowseStay(selectionId: string): void;
  onBrowseActivity(date: string, selectionId?: string): void;
  highlightedDay?: string;
  highlightedSelectionId?: string;
}) {
  const hydrated = new Map(projection.hydratedSelections.map((item) => [item.selectionId, item]));
  const selections = new Map(
    [...trip.selectedTravel, ...trip.selectedStays, ...trip.selectedActivities].map((selection) => [selection.id, selection]),
  );
  return (
    <section className="itinerary-section" aria-labelledby="itinerary-heading">
      <div className="timeline">
        {projection.itinerary.map((day) => (
          <article className={highlightedDay === day.date ? "timeline-day agent-highlight" : "timeline-day"} id={dayAnchor(day.date)} key={day.date}>
            <div className="day-marker">
              <strong>{day.dayNumber}</strong>
              <i />
            </div>
            <div className="day-content">
              <header>
                <div>
                  <h3>{displayLocation(day.locationId)}</h3>
                  <span>{formatDate(day.date)}</span>
                </div>
                <button type="button" disabled={busy} onClick={() => onAddActivity(day.date)}>
                  + Add activity
                </button>
              </header>
              <div className="day-events">
                {day.events.map((event) => {
                  if (event.type === "free_time") {
                    return <div className="free-time-card" key={event.id}><span aria-hidden="true">◉</span><strong>{event.title}</strong><button type="button" disabled={busy} onClick={() => onAddActivity(day.date)}>+ Add activity</button></div>;
                  }
                  const item = event.selectionId ? hydrated.get(event.selectionId) : undefined;
                  const selection = event.selectionId ? selections.get(event.selectionId) : undefined;
                  if (!item || !selection) return null;
                  const onBrowse = selection.kind === "travel"
                    ? () => onBrowseTravel(selection.id)
                    : selection.kind === "stay"
                      ? () => onBrowseStay(selection.id)
                      : () => onBrowseActivity(selection.date, selection.id);
                  return (
                    <div className={highlightedSelectionId === selection.id ? "itinerary-selection agent-highlight" : "itinerary-selection"} key={event.id}>
                      <SelectionActions
                        locked={selection.locked}
                        busy={busy}
                        onToggleLock={() => onToggleLock(selection.id, selection.locked)}
                        alternativeLabel="Change"
                        onBrowseAlternatives={onBrowse}
                      />
                      {selection.kind === "travel" ? <TravelCard item={item} /> : null}
                      {selection.kind === "stay" ? <StayCard item={item} travellerCount={trip.request.travellers.length} onModify={onBrowse} /> : null}
                      {selection.kind === "activity" ? <ActivityCard item={item} onModify={onBrowse} /> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TripReview({
  trip,
  projection,
  busy,
  onToggleLock,
  onAddActivity,
  onBrowseTravel,
  onBrowseStay,
  onBrowseActivity,
  onBook,
  onRequestCallback,
  highlightedDay,
  highlightedSelectionId,
}: {
  trip: TripState;
  projection: TripProjection;
  busy: boolean;
  onToggleLock(selectionId: string, locked: boolean): void;
  onAddActivity(date: string): void;
  onBrowseTravel(selectionId: string): void;
  onBrowseStay(selectionId: string): void;
  onBrowseActivity(date: string, selectionId?: string): void;
  onBook(): void;
  onRequestCallback(): void;
  highlightedDay?: string;
  highlightedSelectionId?: string;
}) {
  const [activeDay, setActiveDay] = useState(projection.itinerary[0]?.date ?? "");

  useEffect(() => {
    const days = Array.from(document.querySelectorAll<HTMLElement>(".timeline-day[id]"));
    if (days.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.id;
        if (id) setActiveDay(id.replace(/^itinerary-day-/, ""));
      },
      { rootMargin: "-150px 0px -55% 0px", threshold: [0, 0.25, 0.6] },
    );
    days.forEach((day) => observer.observe(day));
    return () => observer.disconnect();
  }, [projection.itinerary]);

  return (
    <div className="trip-review">
      <header className="itinerary-overview">
        <div>
          <p>Day by day</p>
          <h1 id="itinerary-heading">Booking summary</h1>
        </div>
        <span className="trip-generated-badge">◉ Trip generated</span>
      </header>
      <nav className="day-navigation" aria-label="Jump to itinerary day">
        {projection.itinerary.map((day) => <a className={activeDay === day.date ? "is-active" : undefined} key={day.date} href={`#${dayAnchor(day.date)}`} onClick={() => setActiveDay(day.date)}>Day {day.dayNumber}</a>)}
      </nav>
      <Itinerary trip={trip} projection={projection} busy={busy} onToggleLock={onToggleLock} onAddActivity={onAddActivity} onBrowseTravel={onBrowseTravel} onBrowseStay={onBrowseStay} onBrowseActivity={onBrowseActivity} highlightedDay={highlightedDay} highlightedSelectionId={highlightedSelectionId} />
      <footer className="trip-checkout-bar">
        <div className="trip-total"><span>Trip total</span><strong>{formatMoney(projection.budget.total.amount)}</strong><small>Calculated from selected offers</small></div>
        <div className="checkout-divider" />
        <div className="trip-total"><span>Travel total</span><strong>{formatMoney(projection.budget.breakdown.travel.amount)}</strong><small>Calculated from selected offers</small></div>
        <div className="trip-total"><span>Stays total</span><strong>{formatMoney(projection.budget.breakdown.stays.amount)}</strong><small>Calculated from selected offers</small></div>
        <div className="trip-total"><span>Activities total</span><strong>{formatMoney(projection.budget.breakdown.activities.amount)}</strong><small>Calculated from selected offers</small></div>
        {/* <dl className="checkout-breakdown"><div><dt>Travel</dt><dd>{formatMoney(projection.budget.breakdown.travel.amount)}</dd></div><div><dt>Stays</dt><dd>{formatMoney(projection.budget.breakdown.stays.amount)}</dd></div><div><dt>Activities</dt><dd>{formatMoney(projection.budget.breakdown.activities.amount)}</dd></div></dl> */}
        <div className="checkout-divider" />
        <div className="checkout-actions"><button type="button" onClick={onBook}>Book now</button><button type="button" onClick={onRequestCallback}>Request callback</button></div>
      </footer>
    </div>
  );
}

function InteractionProgress({ events }: { events: InteractionEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="interaction-progress" role="status" aria-label="Planning progress">
      {events.map((event) => (
        <div className={`interaction-step is-${event.status}`} key={event.id}>
          <i aria-hidden="true">{event.status === "completed" ? "✓" : event.status === "failed" ? "!" : ""}</i>
          <span>{event.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function TravelWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const request = state.itinerary.request;
  const trip = state.itinerary.trip;
  const projectionState = state.itinerary.projection;
  const [originLabel, setOriginLabel] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [interestText, setInterestText] = useState("");
  const [composerText, setComposerText] = useState("");
  const [inventoryPicker, setInventoryPicker] = useState<InventoryPicker>();
  const [selectingOfferId, setSelectingOfferId] = useState<string>();
  const [guidedChangeActive, setGuidedChangeActive] = useState(false);
  const [highlightedDay, setHighlightedDay] = useState<string>();
  const [showPlanningAnimation, setShowPlanningAnimation] = useState(false);
  const [editingFact, setEditingFact] = useState<BriefFact>();
  const factEditorRef = useRef<HTMLFormElement | null>(null);
  const conversationRef = useRef<HTMLElement | null>(null);
  const initialPlanningDeadlineRef = useRef<Promise<void> | undefined>(undefined);

  function beginInitialPlanningAnimation(): Promise<void> {
    if (trip) return Promise.resolve();
    if (!initialPlanningDeadlineRef.current) {
      setShowPlanningAnimation(true);
      initialPlanningDeadlineRef.current = minimumPlanningVisibility();
    }
    return initialPlanningDeadlineRef.current;
  }
  const [elapsed, setElapsed] = useState(0);
  const [inventoryReadiness, setInventoryReadiness] =
    useState<InventoryReadiness>("checking");
  const [inventoryBacking, setInventoryBacking] = useState<"snapshot" | "hybrid" | "neon">("snapshot");

  useEffect(() => {
    if (!inventoryPicker) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [inventoryPicker]);
  useEffect(() => {
    if (!editingFact) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (factEditorRef.current && !factEditorRef.current.contains(event.target as Node)) {
        setEditingFact(undefined);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [editingFact]);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    const frame = window.requestAnimationFrame(() => {
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.conversation.length, state.interaction]);
  const tripIdRef = useRef<string | null>(null);
  const inventoryWarmupStartedRef = useRef(false);
  const discovering = state.asyncStatus === "discovering";
  const planning = state.asyncStatus === "planning";
  const interpreting = state.asyncStatus === "interpreting";
  const busy = interpreting || discovering || planning || guidedChangeActive || state.asyncStatus === "modifying" || state.asyncStatus === "explaining" || state.asyncStatus === "applying";

  const warmInventory = useCallback(async () => {
    setInventoryReadiness("checking");
    try {
      const response = await fetch("/api/health/inventory", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => undefined);
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        (body as { status?: unknown }).status !== "ready"
      ) {
        throw new Error("Inventory is unavailable");
      }
      const source = (body as { source?: unknown }).source;
      if (source === "snapshot" || source === "hybrid" || source === "neon") setInventoryBacking(source);
      setInventoryReadiness("ready");
    } catch {
      setInventoryReadiness("unavailable");
    }
  }, []);

  useEffect(() => {
    const projection = projectionState;
    if (!trip || !projection) return;

    for (const selection of trip.selectedStays) {
      const offer = projection.hydratedSelections.find((item) => item.selectionId === selection.id)?.offer;
      if (!offer || !isStay(offer)) continue;
      void cachedInventoryPost<SearchResponse<StayOffer>>("/api/inventory/stays/search", {
        locationId: offer.locationId,
        checkIn: offer.checkIn,
        checkOut: offer.checkOut,
        travellers: trip.request.travellers,
        constraints: trip.request.constraints,
      }).catch(() => undefined);
    }
    for (const day of projection.itinerary) {
      void cachedInventoryPost<SearchResponse<ActivityOffer>>("/api/inventory/activities/search", {
        locationId: day.locationId,
        startDate: day.date,
        endDate: day.date,
        travellers: trip.request.travellers,
        interests: trip.request.preferences.interests ?? [],
        constraints: trip.request.constraints,
      }).catch(() => undefined);
    }
  }, [trip, projectionState]);

  useEffect(() => {
    if (inventoryWarmupStartedRef.current) return;
    inventoryWarmupStartedRef.current = true;
    void warmInventory();
  }, [warmInventory]);

  useEffect(() => {
    if (!interpreting && !discovering && !planning) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [interpreting, discovering, planning]);

  function updateRequest(patch: Partial<TripRequest>) {
    dispatch({
      type: "replace_request",
      request: { ...request, ...patch },
    });
  }

  function setTravellerComposition(type: Traveller["type"], count: number) {
    const grouped = {
      adult: request.travellers.filter((traveller) => traveller.type === "adult").length,
      child: request.travellers.filter((traveller) => traveller.type === "child").length,
      senior: request.travellers.filter((traveller) => traveller.type === "senior").length,
      [type]: count,
    };
    const travellers: Traveller[] = (["adult", "child", "senior"] as const).flatMap((travellerType) =>
      Array.from({ length: grouped[travellerType] }, () => ({ id: "", type: travellerType })),
    ).map((traveller, index) => ({ ...traveller, id: `traveller:${index + 1}` }));
    updateRequest({ travellers });
  }

  function setMaximumBudget(raw: string) {
    const withoutBudget = request.constraints.filter(
      (constraint) => constraint.category !== "budget",
    );
    const amount = Number(raw);
    const constraints: Constraint[] =
      raw && Number.isInteger(amount) && amount > 0
        ? [
            ...withoutBudget,
            {
              id: "constraint:budget:all",
              category: "budget",
              priority: "hard",
              value: { maxTotal: { amount, currency: "INR" } },
            },
          ]
        : withoutBudget;
    updateRequest({ constraints });
  }

  function preparedRequest(): TripRequest {
    return {
      ...request,
      preferences: {
        ...request.preferences,
        interests: interestText
          .split(",")
          .map((value) => value.trim().toLocaleLowerCase("en"))
          .filter(Boolean),
      },
    };
  }

  async function submitNaturalIntake(event?: FormEvent, overrideMessage?: string) {
    event?.preventDefault();
    const message = (overrideMessage ?? composerText).trim();
    if (!message || busy || trip) return;
    void beginInitialPlanningAnimation();
    setElapsed(0);
    dispatch({
      type: "intake_started",
      entry: { id: messageId("user"), role: "user", text: message },
    });
    setComposerText("");

    try {
      const response = await fetch("/api/agent/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "draft", message, currentRequest: preparedRequest() }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const error = body as { code?: unknown; message?: unknown; retryable?: unknown };
        throw {
          code: typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
          message:
            typeof error?.message === "string"
              ? error.message
              : "The trip brief could not be interpreted.",
          retryable: error?.retryable === true,
        };
      }
      const envelope = body as { kind?: unknown; result?: unknown; interaction?: unknown };
      const result = envelope.result;
      if ((body as { kind?: unknown })?.kind !== "intake" || !isNaturalIntakeResponse(result)) {
        throw new Error("Invalid intake response");
      }
      const interaction = interactionPresentationSchema.safeParse(envelope.interaction);

      setOriginLabel(result.resolvedLocations.origin?.label ?? originLabel);
      if (result.request.destination?.kind === "open") {
        setDestinationLabel("");
      } else {
        setDestinationLabel(result.resolvedLocations.destination?.label ?? destinationLabel);
      }
      setInterestText(result.request.preferences.interests?.join(", ") ?? "");
      setComposerText("");
      dispatch({
        type: "intake_received",
        result,
        entry: { id: messageId("assistant"), role: "assistant", text: interaction.success ? interaction.data.message : result.message },
      });
      if (interaction.success) dispatch({ type: "interaction_updated", interaction: interaction.data });

      // A complete brief is already validated by the intake contract. Continue
      // directly into the appropriate grounded workflow; clarification remains
      // the only stopping point for incomplete or ambiguous input.
      if (result.missingRequired.length === 0 && result.issues.length === 0) {
        if (result.request.destination?.kind === "open") {
          await executeDestinationDiscovery(result.request, undefined, false);
        } else {
          await executeSpecifiedPlan(result.request, undefined, false);
        }
      } else {
        await initialPlanningDeadlineRef.current;
        setShowPlanningAnimation(false);
        initialPlanningDeadlineRef.current = undefined;
      }
    } catch (error: unknown) {
      await initialPlanningDeadlineRef.current;
      setShowPlanningAnimation(false);
      initialPlanningDeadlineRef.current = undefined;
      const value = error as { code?: unknown; message?: unknown; retryable?: unknown };
      const workspaceError = {
        code: typeof value?.code === "string" ? value.code : "NETWORK_FAILURE",
        message:
          typeof value?.message === "string"
            ? value.message
            : "The planner is temporarily unreachable. Your current trip brief is unchanged.",
        retryable: value?.retryable !== false,
      };
      dispatch({
        type: "intake_failed",
        error: workspaceError,
        entry: { id: messageId("assistant"), role: "assistant", text: workspaceError.message },
      });
      dispatch({ type: "interaction_updated", interaction: {
        message: workspaceError.message,
        events: [{ id: `${operationId("intake-error")}:event`, type: "constraint_detected", status: "failed", label: workspaceError.message }],
        actions: workspaceError.retryable ? [{ id: operationId("retry"), type: "retry", label: "Try again" }] : [],
      } });
    }
  }

  async function startQuickTrip(item: QuickStart) {
    if (busy) return;
    setOriginLabel(item.originLabel);
    setDestinationLabel(item.destinationLabel);
    setInterestText(item.request.preferences.interests?.join(", ") ?? "");
    setComposerText("");
    dispatch({ type: "replace_request", request: item.request });
    if (item.request.destination?.kind === "open") {
      await executeDestinationDiscovery(item.request, item.prompt);
      return;
    }
    await executeSpecifiedPlan(item.request, item.prompt);
  }

  async function submitConversation(event?: FormEvent) {
    event?.preventDefault();
    const message = composerText.trim();
    if (!message || busy) return;
    if (!trip) {
      await submitNaturalIntake();
      return;
    }

    dispatch({
      type: "conversation_started",
      entry: { id: messageId("user"), role: "user", text: message },
    });
    setComposerText("");
    const turnOperationId = operationId("turn");
    const requestedDay = Number(message.match(/\bday\s+(\d+)\b/i)?.[1]);
    const requestedDate = Number.isInteger(requestedDay) && requestedDay > 0
      ? projectionState?.itinerary[requestedDay - 1]?.date
      : undefined;
    const requestedSelectionId = /\b(?:stay|hotel|room)\b/i.test(message)
      ? trip.selectedStays[0]?.id
      : /\b(?:flight|travel|transfer|route)\b/i.test(message)
        ? trip.selectedTravel[0]?.id
        : /\bactivit(?:y|ies)\b/i.test(message)
          ? trip.selectedActivities.find((selection) => !requestedDate || selection.date === requestedDate)?.id
          : undefined;
    const turnTarget = requestedDate
      ? { type: "day" as const, date: requestedDate }
      : requestedSelectionId
        ? { type: "selection" as const, selectionId: requestedSelectionId }
        : undefined;
    dispatch({ type: "interaction_updated", interaction: {
      message: "I’m interpreting that request against the current itinerary.",
      events: [{ id: `${turnOperationId}:understand`, type: "fact_recognized", status: "active", label: "Understanding the requested change", target: turnTarget }],
      actions: [],
      focus: turnTarget ? { operationId: turnOperationId, target: turnTarget, phase: "understanding" } : undefined,
    } });
    try {
      const response = await fetch("/api/agent/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "committed",
          message,
          trip: trip,
        }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const error = body as { code?: unknown; message?: unknown; retryable?: unknown };
        throw {
          code: typeof error?.code === "string" ? error.code : "CONVERSATION_FAILED",
          message: typeof error?.message === "string" ? error.message : "The assistant could not complete that request.",
          retryable: error?.retryable === true,
        };
      }

      const envelope = body as { kind?: unknown; result?: unknown };
      if (envelope.kind === "explanation" && isExplanationResult(envelope.result)) {
        setComposerText("");
        dispatch({
          type: "explanation_received",
          result: envelope.result,
          entry: { id: messageId("assistant"), role: "assistant", text: envelope.result.message },
        });
        dispatch({ type: "interaction_updated", interaction: {
          message: envelope.result.message,
          events: [{ id: `${turnOperationId}:complete`, type: "operation_completed", status: "completed", label: "Explained from the current validated itinerary", target: turnTarget }],
          actions: [],
        } });
        return;
      }
      if (envelope.kind === "modification" && isModificationResult(envelope.result)) {
        setComposerText("");
        handleModificationResult(envelope.result);
        return;
      }
      throw new Error("Invalid conversation response");
    } catch (error: unknown) {
      reportAsyncError(error, "The assistant is temporarily unavailable. Your current trip is unchanged.");
    }
  }

  function validateBrief(request: TripRequest): string | undefined {
    const missing = [
      !request.origin ? "origin" : undefined,
      !request.destination ? "destination" : undefined,
      !request.startDate || !request.endDate ? "dates" : undefined,
      request.travellers.length === 0 ? "travellers" : undefined,
    ].filter(Boolean);
    if (missing.length > 0) {
      return `Add ${missing.join(", ")} before planning.`;
    }
    if (request.startDate && request.endDate && request.endDate <= request.startDate) {
      return "The trip end date must be after the start date.";
    }
    return undefined;
  }

  async function executeSpecifiedPlan(
    request: TripRequest,
    userText?: string,
    appendUserEntry = true,
  ) {
    const minimumVisibility = beginInitialPlanningAnimation();
    setElapsed(0);
    dispatch({
      type: "planning_started",
      entry: appendUserEntry && userText
        ? { id: messageId("user"), role: "user", text: userText }
        : undefined,
    });
    const activeOperationId = operationId("plan");
    const progress = planningEvents(activeOperationId, request);
    dispatch({
      type: "interaction_updated",
      interaction: {
        message: "I’m checking grounded travel, stay, and activity options for this trip.",
        events: progress,
        actions: [],
      },
    });
    tripIdRef.current ??= `trip:${globalThis.crypto.randomUUID()}`;

    try {
      const response = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: tripIdRef.current,
          request,
          optionalClarificationUsed: state.optionalClarificationUsed,
        }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const error = body as { code?: unknown; message?: unknown; retryable?: unknown };
        throw {
          code: typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
          message:
            typeof error?.message === "string"
              ? error.message
              : "The planner could not complete this request.",
          retryable: error?.retryable === true,
        };
      }
      if (!isPlanResult(body)) throw new Error("Invalid PLAN response");
      await minimumVisibility;
      setShowPlanningAnimation(false);
      dispatch({
        type: "interaction_updated",
        interaction: {
          message: body.message,
          events: completePlanningEvents(progress),
          actions: [],
        },
      });
      if (body.type === "trip_ready") {
        if (trip && projectionState) {
          const proposal: TripProposal = {
            id: `proposal:${globalThis.crypto.randomUUID()}`,
            baseTripVersion: trip.version,
            operations: [{ type: "replace_trip_plan", nextTrip: body.trip }],
          };
          await applyDirectProposal(
            proposal,
            "Updated the itinerary from your trip details. Locked selections were preserved.",
            true,
          );
          return;
        }
        dispatch({
          type: "planning_succeeded",
          result: body,
          entry: { id: messageId("assistant"), role: "assistant", text: body.message },
        });
      } else {
        dispatch({
          type: "outcome_received",
          outcome: body,
          entry: { id: messageId("assistant"), role: "assistant", text: body.message },
        });
        dispatch({ type: "interaction_updated", interaction: {
          message: body.message,
          events: [{ id: `${activeOperationId}:constraint`, type: "constraint_detected", status: "completed", label: body.message }],
          actions: planningRecoveryActions(body),
        } });
      }
    } catch (error: unknown) {
      await minimumVisibility;
      setShowPlanningAnimation(false);
      if (!trip) initialPlanningDeadlineRef.current = undefined;
      const value = error as { code?: unknown; message?: unknown; retryable?: unknown };
      const workspaceError = {
        code: typeof value?.code === "string" ? value.code : "NETWORK_FAILURE",
        message:
          typeof value?.message === "string"
            ? value.message
            : "The planner is temporarily unreachable. Your trip details are safe.",
        retryable: value?.retryable !== false,
      };
      dispatch({
        type: "planning_failed",
        error: workspaceError,
        entry: {
          id: messageId("assistant"),
          role: "assistant",
          text: workspaceError.message,
        },
      });
      dispatch({ type: "interaction_updated", interaction: {
        message: workspaceError.message,
        events: [{ id: `${operationId("plan-error")}:event`, type: "constraint_detected", status: "failed", label: workspaceError.message }],
        actions: workspaceError.retryable ? [{ id: operationId("retry"), type: "retry", label: "Try again" }] : [],
      } });
    }
  }

  async function executeDestinationDiscovery(
    request: TripRequest,
    userText?: string,
    appendUserEntry = true,
  ) {
    const minimumVisibility = beginInitialPlanningAnimation();
    setElapsed(0);
    dispatch({
      type: "discovery_started",
      entry: appendUserEntry ? {
        id: messageId("user"),
        role: "user",
        text: userText ?? `Find grounded destination options from ${originLabel} for ${request.startDate} to ${request.endDate}.`,
      } : undefined,
    });
    const activeOperationId = operationId("discover");
    const progress = planningEvents(activeOperationId, request);
    dispatch({
      type: "interaction_updated",
      interaction: {
        message: "I’m comparing supported destinations against your route, dates, and budget.",
        events: progress,
        actions: [],
      },
    });
    try {
      const response = await fetch("/api/agent/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const error = body as { code?: unknown; message?: unknown; retryable?: unknown };
        throw {
          code: typeof error?.code === "string" ? error.code : "DISCOVERY_FAILED",
          message:
            typeof error?.message === "string"
              ? error.message
              : "Destination comparison could not complete.",
          retryable: error?.retryable === true,
        };
      }
      if (!isDestinationDiscoveryResult(body)) throw new Error("Invalid discovery response");
      await minimumVisibility;
      setShowPlanningAnimation(false);
      dispatch({
        type: "interaction_updated",
        interaction: {
          message: body.message,
          events: completePlanningEvents(progress),
          actions: [],
        },
      });
      dispatch({
        type: "discovery_received",
        result: body,
        entry: { id: messageId("assistant"), role: "assistant", text: body.message },
      });
      if (body.type === "conflict") {
        dispatch({ type: "interaction_updated", interaction: {
          message: body.message,
          events: [{ id: `${activeOperationId}:constraint`, type: "constraint_detected", status: "completed", label: body.message }],
          actions: [{ id: `${activeOperationId}:retry`, type: "retry", label: "Search again" }],
        } });
      }
    } catch (error: unknown) {
      await minimumVisibility;
      setShowPlanningAnimation(false);
      if (!trip) initialPlanningDeadlineRef.current = undefined;
      reportAsyncError(
        error,
        "Destination discovery is temporarily unavailable. Your Trip Brief is unchanged.",
      );
    }
  }

  async function submitPlan(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const request = preparedRequest();
    const problem = validateBrief(request);
    if (problem) {
      const guidance = nextBriefGuidance(request);
      dispatch({
        type: "planning_failed",
        error: {
          code: problem.includes("end date") ? "INVALID_DATES" : "INCOMPLETE_BRIEF",
          message: problem,
          retryable: false,
        },
        entry: { id: messageId("assistant"), role: "assistant", text: guidance?.message ?? problem },
      });
      if (guidance) dispatch({ type: "interaction_updated", interaction: guidance });
      return;
    }

    dispatch({ type: "replace_request", request });
    if (request.destination?.kind === "open") {
      await executeDestinationDiscovery(request);
      return;
    }
    await executeSpecifiedPlan(
      request,
      `Plan ${originLabel} to ${destinationLabel} from ${request.startDate} to ${request.endDate} for ${request.travellers.length} traveller${request.travellers.length === 1 ? "" : "s"}.`,
    );
  }

  function nextBriefGuidance(nextRequest: TripRequest): InteractionPresentation | undefined {
    const nextOperationId = operationId("clarify");
    if (!nextRequest.origin) return {
      message: "Where would you like to begin your journey?",
      events: [{ id: `${nextOperationId}:origin`, type: "fact_missing", status: "active", label: "Starting city needed", target: { type: "trip_field", field: "origin" } }],
      actions: [],
      focus: { operationId: nextOperationId, target: { type: "trip_field", field: "origin" }, phase: "understanding" },
    };
    if (!nextRequest.destination) return {
      message: "Do you have a destination in mind, or should I compare supported places?",
      events: [{ id: `${nextOperationId}:destination`, type: "fact_missing", status: "active", label: "Destination preference needed", target: { type: "trip_field", field: "destination" } }],
      actions: [{ id: `${nextOperationId}:open`, type: "set_open_destination", label: "Help me choose" }],
      focus: { operationId: nextOperationId, target: { type: "trip_field", field: "destination" }, phase: "understanding" },
    };
    if (!nextRequest.startDate || !nextRequest.endDate) return {
      message: "When would you like to travel?",
      events: [{ id: `${nextOperationId}:dates`, type: "fact_missing", status: "active", label: "Travel dates needed", target: { type: "trip_field", field: "dates" } }],
      actions: (state.latestIntake?.suggestedDateRanges ?? []).map((range) => ({ id: `${nextOperationId}:${range.id}`, type: "set_dates" as const, startDate: range.startDate, endDate: range.endDate, label: range.label })),
      focus: { operationId: nextOperationId, target: { type: "trip_field", field: "dates" }, phase: "understanding" },
    };
    if (nextRequest.travellers.length === 0) return {
      message: "Who will be travelling?",
      events: [{ id: `${nextOperationId}:travellers`, type: "fact_missing", status: "active", label: "Traveller count needed", target: { type: "trip_field", field: "travellers" } }],
      actions: [
        { id: `${nextOperationId}:solo`, type: "set_travellers", adults: 1, children: 0, seniors: 0, label: "Just me" },
        { id: `${nextOperationId}:two`, type: "set_travellers", adults: 2, children: 0, seniors: 0, label: "2 adults" },
        { id: `${nextOperationId}:family`, type: "set_travellers", adults: 2, children: 1, seniors: 0, label: "2 adults + 1 child" },
      ],
      focus: { operationId: nextOperationId, target: { type: "trip_field", field: "travellers" }, phase: "understanding" },
    };
    return undefined;
  }

  function planningRecoveryActions(outcome: Exclude<SpecifiedPlanApiResult, { type: "trip_ready" }>): GuidedAction[] {
    if (outcome.type === "clarification") {
      return [{ id: operationId("continue"), type: "submit_plan", label: "Continue with current details" }];
    }
    return (outcome.factBundle?.allowedFollowUpActions ?? []).slice(0, 4).flatMap((action): GuidedAction[] => {
      if (action.type === "retry") return [{ id: action.id, type: "retry", label: action.label }];
      if (action.type === "change_scope") return [{ id: action.id, type: "set_open_destination", label: action.label }];
      if (action.type === "keep_current") return [{ id: action.id, type: "keep_current", label: action.label }];
      if (action.type === "adjust_constraint") {
        const constraintId = action.id.replace(/^action:adjust:/, "");
        const constraint = request.constraints.find((item) => item.id === constraintId);
        if (constraint?.category === "budget" && constraint.value.maxTotal) {
          return [{ id: action.id, type: "set_budget", amount: constraint.value.maxTotal.amount + 5_000, label: action.label }];
        }
        return [{ id: action.id, type: "remove_constraint", constraintId, label: action.label }];
      }
      return [];
    });
  }

  async function handleGuidedAction(action: GuidedAction) {
    if (busy) return;
    if (action.type === "retry" || action.type === "submit_plan") {
      await submitPlan();
      return;
    }
    dispatch({ type: "conversation_entry_added", entry: { id: messageId("user"), role: "user", text: action.label } });
    if (action.type === "keep_current") {
      dispatch({ type: "interaction_cleared" });
      return;
    }
    if (action.type === "apply_proposal") {
      const stored = state.proposals[action.proposalId];
      if (stored) await runGuidedProposal(stored.proposal, stored.projection, stored.message);
      return;
    }
    const nextRequest: TripRequest = { ...request, constraints: [...request.constraints] };
    if (action.type === "set_location") {
      if (action.field === "origin") {
        nextRequest.origin = action.locationId;
        setOriginLabel(action.label);
      } else {
        nextRequest.destination = { kind: "specified", locationId: action.locationId };
        setDestinationLabel(action.label);
      }
    } else if (action.type === "set_open_destination") {
      nextRequest.destination = { kind: "open" };
      setDestinationLabel("");
    } else if (action.type === "set_dates") {
      nextRequest.startDate = action.startDate;
      nextRequest.endDate = action.endDate;
    } else if (action.type === "set_travellers") {
      nextRequest.travellers = [
        ...Array.from({ length: action.adults }, (_, index): Traveller => ({ id: `traveller:adult:${index + 1}`, type: "adult" })),
        ...Array.from({ length: action.children }, (_, index): Traveller => ({ id: `traveller:child:${index + 1}`, type: "child" })),
        ...Array.from({ length: action.seniors }, (_, index): Traveller => ({ id: `traveller:senior:${index + 1}`, type: "senior" })),
      ];
    } else if (action.type === "set_budget") {
      nextRequest.constraints = nextRequest.constraints.filter((constraint) => constraint.category !== "budget");
      nextRequest.constraints.push({ id: "constraint:budget:all", category: "budget", priority: "hard", value: { maxTotal: { amount: action.amount, currency: "INR" } } });
    } else if (action.type === "remove_constraint") {
      nextRequest.constraints = nextRequest.constraints.filter((constraint) => constraint.id !== action.constraintId);
    }
    dispatch({ type: "replace_request", request: nextRequest });
    const guidance = nextBriefGuidance(nextRequest);
    if (guidance) {
      dispatch({ type: "interaction_updated", interaction: guidance });
      dispatch({ type: "conversation_entry_added", entry: { id: messageId("assistant"), role: "assistant", text: guidance.message } });
      return;
    }
    if (nextRequest.destination?.kind === "open") await executeDestinationDiscovery(nextRequest, action.label, false);
    else await executeSpecifiedPlan(nextRequest, action.label, false);
  }

  async function selectDestination(option: DestinationOption) {
    if (busy) return;
    const selectedRequest: TripRequest = {
      ...request,
      destination: { kind: "specified", locationId: option.id },
    };
    setDestinationLabel(option.name);
    dispatch({ type: "destination_selected", request: selectedRequest });
    await executeSpecifiedPlan(
      selectedRequest,
      `Continue with ${option.name} and build the detailed validated trip.`,
    );
  }

  function reportAsyncError(error: unknown, fallback: string) {
    const value = error as { code?: unknown; message?: unknown; retryable?: unknown };
    const workspaceError = {
      code: typeof value?.code === "string" ? value.code : "NETWORK_FAILURE",
      message: typeof value?.message === "string" ? value.message : fallback,
      retryable: value?.retryable !== false,
    };
    dispatch({
      type: "planning_failed",
      error: workspaceError,
      entry: {
        id: messageId("assistant"),
        role: "assistant",
        text: workspaceError.message,
      },
    });
    dispatch({
      type: "interaction_updated",
      interaction: {
        message: workspaceError.message,
        events: [{
          id: `${operationId("recover")}:event`,
          type: "constraint_detected",
          status: "failed",
          label: workspaceError.message,
        }],
        actions: workspaceError.retryable
          ? [{ id: operationId("retry"), type: "retry", label: "Try again" }]
          : [],
      },
    });
  }

  async function runGuidedProposal(
    proposal: TripProposal,
    nextProjection: TripProjection,
    finalMessage: string,
  ) {
    if (!trip) return;
    const activeOperationId = operationId("modify");
    const replacement = proposal.operations.find((operation) => "selectionId" in operation);
    const nextOfferId = proposal.operations.find((operation) => "nextOfferId" in operation);
    const nextOffer = nextOfferId && "nextOfferId" in nextOfferId
      ? nextProjection.hydratedSelections.find((item) => item.offer.id === nextOfferId.nextOfferId)?.offer
      : undefined;
    const targetDate = nextOffer && isActivity(nextOffer)
      ? nextOffer.startsAt.slice(0, 10)
      : nextOffer && isStay(nextOffer)
        ? nextOffer.checkIn
        : undefined;
    const target = replacement && "selectionId" in replacement
      ? { type: "selection" as const, selectionId: replacement.selectionId }
      : targetDate
        ? { type: "day" as const, date: targetDate }
        : { type: "trip_total" as const };
    const category = proposal.operations.some((operation) => operation.type.includes("stay"))
      ? "stay"
      : proposal.operations.some((operation) => operation.type.includes("activity"))
        ? "activity"
        : proposal.operations.some((operation) => operation.type.includes("travel"))
          ? "travel"
          : "itinerary";
    const progress: InteractionEvent[] = [
      { id: `${activeOperationId}:understand`, type: "fact_recognized", status: "completed", label: `Understood the ${category} change`, target },
      { id: `${activeOperationId}:search`, type: "inventory_search_started", status: "active", label: `Checking compatible ${category} options`, target },
      { id: `${activeOperationId}:select`, type: "candidate_selected", status: "pending", label: `Selecting the best validated ${category} option`, target },
      { id: `${activeOperationId}:validate`, type: "trip_validated", status: "pending", label: "Recalculating and validating the itinerary", target: { type: "trip_total" } },
    ];
    setGuidedChangeActive(true);
    dispatch({
      type: "interaction_updated",
      interaction: {
        message: `I’m checking a grounded ${category} change while preserving the rest of your itinerary.`,
        events: progress,
        actions: [],
        focus: { operationId: activeOperationId, target, phase: "searching" },
      },
    });
    if (targetDate) setHighlightedDay(targetDate);
    try {
      await waitForUi(GUIDED_CHANGE_VISIBLE_MS / 2);
      dispatch({ type: "interaction_updated", interaction: {
        message: `I found a compatible ${category} option and I’m validating the updated total.`,
        events: progress.map((item, index) => ({ ...item, status: index < 2 ? "completed" : index === 2 ? "active" : "pending" })),
        actions: [],
        focus: { operationId: activeOperationId, target, phase: "updating" },
      } });
      await waitForUi(GUIDED_CHANGE_VISIBLE_MS / 2);
      await applyDirectProposal(proposal, finalMessage, true);
      dispatch({ type: "interaction_updated", interaction: {
        message: finalMessage,
        events: progress.map((item) => ({ ...item, status: "completed" })),
        actions: [],
        focus: { operationId: activeOperationId, target, phase: "completed" },
      } });
      window.setTimeout(() => setHighlightedDay(undefined), 2_200);
    } finally {
      setGuidedChangeActive(false);
    }
  }

  function handleModificationResult(result: ModificationResult) {
    if (!trip) return;
    if (result.type === "proposal") {
      void runGuidedProposal(result.proposal, result.projection, result.message);
      return;
    }
    if (result.type === "alternatives") {
      const preferredOptionId = result.block.emphasis?.recommendedId;
      const chosen = result.options.find((option) => option.optionId === preferredOptionId)
        ?? result.options[0];
      if (chosen) void runGuidedProposal(chosen.proposal, chosen.projection, chosen.message);
      return;
    }
    dispatch({ type: "modification_conflict", result, entry: { id: messageId("assistant"), role: "assistant", text: result.message } });
    const conflictOperationId = operationId("modify-conflict");
    dispatch({ type: "interaction_updated", interaction: {
      message: result.message,
      events: [{ id: `${conflictOperationId}:constraint`, type: "constraint_detected", status: "completed", label: result.message }],
      actions: [
        ...result.proposals.slice(0, 3).map((option) => ({ id: `${conflictOperationId}:${option.proposal.id}`, type: "apply_proposal" as const, proposalId: option.proposal.id, label: option.message })),
        { id: `${conflictOperationId}:keep`, type: "keep_current" as const, label: "Keep the current trip" },
      ],
    } });
  }

  async function addActivityToDay(date: string) {
    await browseActivities(date);
  }

  async function applyDirectProposal(
    proposal: TripProposal,
    message: string,
    allowWhilePlanning = false,
  ) {
    if (!trip || (busy && !allowWhilePlanning)) return;
    dispatch({ type: "proposal_apply_started" });
    try {
      const response = await fetch("/api/trip/proposals/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trip, proposal }) });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw body;
      const result = body as { trip?: unknown; projection?: unknown };
      if (!result.trip || !result.projection) throw new Error("Invalid proposal application");
      setInventoryPicker(undefined);
      dispatch({ type: "proposal_applied", trip: result.trip as TripState, projection: result.projection as TripProjection, entry: { id: messageId("assistant"), role: "assistant", text: message } });
    } catch (error: unknown) {
      reportAsyncError(error, "This inventory choice could not be selected. Your trip is unchanged.");
    }
  }

  async function browseTravel(selectionId: string) {
    const selected = trip?.selectedTravel.find((item) => item.id === selectionId);
    const current = projectionState?.hydratedSelections.find((item) => item.selectionId === selectionId)?.offer;
    if (!trip || !selected || !current || busy) return;
    setInventoryPicker({ kind: "travel", selectionId, currentOfferId: selected.offerId, offers: [current as TransportOffer | TransferOffer], loading: true });
    try {
      const body = isTransport(current)
        ? await cachedInventoryPost<SearchResponse<TransportOffer>>("/api/inventory/transport/search", { from: current.from, to: current.to, date: current.departureAt.slice(0, 10), travellers: trip.request.travellers, constraints: trip.request.constraints.filter((constraint) => constraint.category === "travel") })
        : isTransfer(current)
          ? await cachedInventoryPost<SearchResponse<TransferOffer>>("/api/inventory/transfers/search", { from: current.from, to: current.to, travellers: trip.request.travellers })
          : undefined;
      if (!body) throw new Error("Travel inventory is unavailable");
      setInventoryPicker({ kind: "travel", selectionId, currentOfferId: selected.offerId, offers: [current as TransportOffer | TransferOffer, ...body.results.filter((offer) => offer.id !== selected.offerId)], loading: false });
    } catch (error: unknown) {
      setInventoryPicker({ kind: "travel", selectionId, currentOfferId: selected.offerId, offers: [current as TransportOffer | TransferOffer], loading: false, error: error instanceof Error ? error.message : "Travel inventory is unavailable" });
    }
  }

  async function browseStay(selectionId: string) {
    const selected = trip?.selectedStays.find((item) => item.id === selectionId);
    const current = projectionState?.hydratedSelections.find((item) => item.selectionId === selectionId)?.offer;
    if (!trip || !selected || !current || !isStay(current) || busy) return;
    setInventoryPicker({ kind: "stay", selectionId, currentOfferId: selected.offerId, offers: [current], loading: true });
    try {
      const body = await cachedInventoryPost<SearchResponse<StayOffer>>("/api/inventory/stays/search", { locationId: current.locationId, checkIn: current.checkIn, checkOut: current.checkOut, travellers: trip.request.travellers, constraints: trip.request.constraints });
      setInventoryPicker({ kind: "stay", selectionId, currentOfferId: selected.offerId, offers: [current, ...body.results.filter((offer) => offer.id !== selected.offerId)], loading: false });
    } catch (error: unknown) {
      setInventoryPicker({ kind: "stay", selectionId, currentOfferId: selected.offerId, offers: [current], loading: false, error: error instanceof Error ? error.message : "Stay inventory is unavailable" });
    }
  }

  async function browseActivities(date: string, selectionId?: string) {
    const day = projectionState?.itinerary.find((item) => item.date === date);
    if (!trip || !day || busy) return;
    const current = selectionId ? projectionState?.hydratedSelections.find((item) => item.selectionId === selectionId)?.offer : undefined;
    const currentActivity = current && isActivity(current) ? current : undefined;
    const currentOfferId = selectionId ? trip.selectedActivities.find((item) => item.id === selectionId)?.offerId : undefined;
    setInventoryPicker({ kind: "activity", date, selectionId, currentOfferId, offers: currentActivity ? [currentActivity] : [], loading: true });
    try {
      const body = await cachedInventoryPost<SearchResponse<ActivityOffer>>("/api/inventory/activities/search", { locationId: day.locationId, startDate: date, endDate: date, travellers: trip.request.travellers, interests: trip.request.preferences.interests ?? [], constraints: trip.request.constraints });
      setInventoryPicker({ kind: "activity", date, selectionId, currentOfferId, offers: [...(currentActivity ? [currentActivity] : []), ...body.results.filter((offer) => offer.id !== currentOfferId)], loading: false });
    } catch (error: unknown) {
      setInventoryPicker({ kind: "activity", date, selectionId, currentOfferId, offers: currentActivity ? [currentActivity] : [], loading: false, error: error instanceof Error ? error.message : "Activity inventory is unavailable" });
    }
  }

  async function selectInventoryOffer(offer: TransportOffer | TransferOffer | StayOffer | ActivityOffer) {
    const picker = inventoryPicker;
    if (!trip || !picker) return;
    if (offer.id === picker.currentOfferId) return;
    const proposal: TripProposal = {
      id: `proposal:${globalThis.crypto.randomUUID()}`,
      baseTripVersion: trip.version,
      operations: picker.kind === "travel"
        ? [{ type: "replace_travel", selectionId: picker.selectionId, nextOfferId: offer.id }]
        : picker.kind === "stay"
        ? [{ type: "replace_stay", selectionId: picker.selectionId, nextOfferId: offer.id }]
        : picker.selectionId
          ? [{ type: "replace_activity", selectionId: picker.selectionId, nextOfferId: offer.id }]
          : [{ type: "add_activity", nextOfferId: offer.id, travellerIds: trip.request.travellers.map((traveller) => traveller.id) }],
    };
    const label = isTransport(offer) ? `${offer.operator} ${offer.mode}` : isTransfer(offer) ? `${offer.mode} transfer` : isStay(offer) ? `${offer.propertyFacts.name} · ${offer.roomFacts.roomLabel}` : offer.activityFacts.name;
    setSelectingOfferId(offer.id);
    try {
      await applyDirectProposal(proposal, `Selected ${label}. The itinerary and trip total are updated.`);
    } finally {
      setSelectingOfferId(undefined);
    }
  }

  async function changeLock(selectionId: string, currentlyLocked: boolean) {
    if (!trip || busy) return;
    const proposal: TripProposal = {
      id: `proposal:${globalThis.crypto.randomUUID()}`,
      baseTripVersion: trip.version,
      operations: [
        { type: "set_selection_lock", selectionId, locked: !currentlyLocked },
      ],
    };
    await applyDirectProposal(proposal, currentlyLocked ? "Unlocked this selection." : "Locked this selection. Future changes will preserve it.");
  }

  const maxBudget = request.constraints.find(
    (constraint) => constraint.category === "budget",
  );
  const maxBudgetAmount =
    maxBudget?.category === "budget" ? maxBudget.value.maxTotal?.amount : undefined;
  const openDestination = request.destination?.kind === "open";
  const briefProblem = validateBrief(preparedRequest());
  const hasPreferences = Boolean(
    request.preferences.pace ||
    request.preferences.interests?.length ||
    maxBudgetAmount,
  );
  const hasBriefFacts = Boolean(
    request.origin ||
    request.destination ||
    request.startDate ||
    request.endDate ||
    request.travellers.length ||
    hasPreferences,
  );
  const originFact = request.origin
    ? originLabel || displayLocation(request.origin)
    : "Select origin";
  const destinationFact = openDestination
    ? "Recommendations"
    : destinationLabel || (request.destination?.kind === "specified"
      ? displayLocation(request.destination.locationId)
      : "Select destination");
  const dateFact = request.startDate && request.endDate
    ? `${formatDate(request.startDate)} – ${formatDate(request.endDate)}`
    : request.startDate
      ? `From ${formatDate(request.startDate)}`
      : request.endDate
        ? `Until ${formatDate(request.endDate)}`
        : "Select dates";
  const guestsFact = request.travellers.length > 0
    ? travellerSummary(request.travellers)
    : "Select guests";
  const activeFocus = state.interaction?.focus?.phase === "completed" ? undefined : state.interaction?.focus;
  const focusedTripField: BriefFact | undefined = activeFocus?.target.type === "trip_field"
    ? activeFocus.target.field === "travellers"
      ? "guests"
      : activeFocus.target.field === "budget" || activeFocus.target.field === "preferences"
        ? "preferences"
        : activeFocus.target.field
    : undefined;
  const focusedSelectionId = activeFocus?.target.type === "selection" ? activeFocus.target.selectionId : undefined;
  const focusedDay = activeFocus?.target.type === "day" ? activeFocus.target.date : highlightedDay;
  function tripFactClass(field: BriefFact, populated: boolean): string {
    return ["trip-fact", populated ? "" : "trip-fact-empty", focusedTripField === field ? "ai-focus" : ""].filter(Boolean).join(" ");
  }
  const preferenceFact = [
    maxBudgetAmount ? formatMoney(maxBudgetAmount) : undefined,
    request.preferences.pace,
    ...(request.preferences.interests ?? []).slice(0, 2),
  ].filter(Boolean).join(" · ") || "Add preferences";
  const initialExperience = state.conversation.length === 0 && !hasBriefFacts && !trip && !interpreting && !discovering && !planning;

  return (
    <main className={initialExperience ? "workspace-shell initial-workspace" : "workspace-shell"}>
      <div className="workspace-layout">
        <aside className="planner-panel">
          <header className="chat-panel-header">
            <Image className="mmt-logo" src="/figma/itinerary/mmt-logo.png" alt="MakeMyTrip" width={169} height={40} priority />
            <button type="button" className={`inventory-readiness inventory-${inventoryReadiness}`} aria-live="polite" disabled={inventoryReadiness === "checking"} onClick={() => void warmInventory()} title={`${inventoryBacking} inventory`}><i /><span className="sr-only">{inventoryReadiness === "ready" ? "Inventory ready" : inventoryReadiness === "checking" ? "Connecting inventory" : "Inventory unavailable, retry"}</span></button>
          </header>
          {initialExperience ? <section className="initial-intake">
            <div className="initial-intake-copy">
              <h1>Turn an Idea<br />into an Itinerary</h1>
              <p>Tell us what you&apos;re looking for: dates, budget, destination, vibe, or who&apos;s traveling</p>
            </div>
            <form className="initial-intake-form" onSubmit={submitConversation}>
              <label htmlFor="initial-trip-message"><SparkIcon /><span className="sr-only">Describe your dream trip</span></label>
              <textarea id="initial-trip-message" value={composerText} placeholder="Describe your dream trip..." onChange={(event) => setComposerText(event.target.value)} />
              <button type="submit" disabled={busy || composerText.trim().length < 2}>{interpreting ? "Planning…" : "Plan"} <span aria-hidden="true">→</span></button>
            </form>
            {interpreting ? <div className="initial-intake-status is-loading" role="status"><i aria-hidden="true" /><div><strong>Understanding your trip</strong><span>Structuring your dates, travellers, budget, and preferences.</span></div></div> : null}
            <p className="quick-start-prompt">Or try one of our quick starts</p>
          </section> : <><section ref={conversationRef} className="conversation" aria-label="Planning conversation">
            {state.conversation.map((entry) => (
              <div className={`message message-${entry.role}`} key={entry.id}>
                <p>{entry.text}</p>
              </div>
            ))}
            {state.interaction ? <InteractionProgress events={state.interaction.events} /> : null}
          </section>
          <div className="conversation-actions" aria-label="Suggested actions">
            {state.interaction?.actions.map((action) => (
              <button type="button" className="guided-action-chip" disabled={busy} key={action.id} onClick={() => void handleGuidedAction(action)}>
                {action.label}
              </button>
            ))}
          </div>

          <form className="conversation-composer" onSubmit={submitConversation}>
            <label htmlFor="conversation-message">Ask anything</label>
            <div>
              <textarea
                id="conversation-message"
                rows={2}
                value={composerText}
                placeholder={trip ? "Ask why, or request a change…" : "Describe the trip you have in mind…"}
                onChange={(event) => setComposerText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitConversation();
                  }
                }}
              />
              <button type="submit" aria-label="Send message" disabled={busy || composerText.trim().length < 2}>
                <Image src="/figma/arrow-up.svg" alt="" width={24} height={24} />
              </button>
            </div>
            <small>{interpreting ? "Understanding your request…" : <>AI-assisted travel service. Check important <span>info</span>.</>}</small>
          </form></>}
        </aside>

        <div className="workspace-stage">
          {hasBriefFacts ? <section className={`trip-brief-bar${editingFact ? ` fact-editing-${editingFact}` : ""}`} aria-label="Current Trip Brief">
            <button type="button" className={tripFactClass("origin", Boolean(request.origin))} onClick={() => setEditingFact(editingFact === "origin" ? undefined : "origin")}><span>From city</span><strong>{originFact}</strong></button>
            <button type="button" className={tripFactClass("destination", Boolean(request.destination))} onClick={() => setEditingFact(editingFact === "destination" ? undefined : "destination")}><span>To city / country</span><strong>{destinationFact}</strong></button>
            <button type="button" className={tripFactClass("dates", Boolean(request.startDate || request.endDate))} onClick={() => setEditingFact(editingFact === "dates" ? undefined : "dates")}><span>Travel dates</span><strong>{dateFact}</strong></button>
            <button type="button" className={tripFactClass("guests", request.travellers.length > 0)} onClick={() => setEditingFact(editingFact === "guests" ? undefined : "guests")}><span>Guests</span><strong>{guestsFact}</strong></button>
            <button type="button" className={tripFactClass("preferences", hasPreferences)} onClick={() => setEditingFact(editingFact === "preferences" ? undefined : "preferences")}><span>Preferences</span><strong>{preferenceFact}</strong></button>
            <button type="button" className="trip-update-button" disabled={busy || Boolean(briefProblem)} onClick={() => void submitPlan()}>Update</button>
            {editingFact ? <form ref={factEditorRef} className="trip-form fact-editor" onSubmit={(event) => { event.preventDefault(); }}>
              {editingFact === "origin" ? <LocationField id="edit-origin" label="From city" placeholder="Search city or airport" selectedId={request.origin} selectedLabel={originLabel} onSelectedLabelChange={setOriginLabel} onSelect={(location) => updateRequest({ origin: location?.id })} /> : null}
              {editingFact === "destination" ? <><LocationField id="edit-destination" label="To city / country" placeholder="Search destination" selectedId={request.destination?.kind === "specified" ? request.destination.locationId : undefined} selectedLabel={openDestination ? "Open to recommendations" : destinationLabel} disabled={openDestination} onSelectedLabelChange={setDestinationLabel} onSelect={(location) => updateRequest({ destination: location ? { kind: "specified", locationId: location.id } : undefined })} /><button className={openDestination ? "open-destination-button active" : "open-destination-button"} type="button" onClick={() => { setDestinationLabel(""); updateRequest({ destination: openDestination ? undefined : { kind: "open" } }); }}>Not sure where? Help me choose</button></> : null}
              {editingFact === "dates" ? <div className="fact-editor-grid"><div className="field"><label htmlFor="edit-start-date">Start</label><input id="edit-start-date" type="date" min="2026-08-28" max="2027-03-30" value={request.startDate ?? ""} onChange={(event) => updateRequest({ startDate: event.target.value || undefined })} /></div><div className="field"><label htmlFor="edit-end-date">End</label><input id="edit-end-date" type="date" min="2026-08-29" max="2027-03-31" value={request.endDate ?? ""} onChange={(event) => updateRequest({ endDate: event.target.value || undefined })} /></div></div> : null}
              {editingFact === "guests" ? <div className="fact-editor-grid guest-grid">{(["adult", "child", "senior"] as const).map((type) => <div className="field" key={type}><label htmlFor={`guest-${type}`}>{type.charAt(0).toUpperCase() + type.slice(1)}s</label><input id={`guest-${type}`} type="number" min="0" max="20" step="1" inputMode="numeric" value={request.travellers.filter((traveller) => traveller.type === type).length} onChange={(event) => setTravellerComposition(type, Math.max(0, Math.min(20, Number(event.target.value) || 0)))} /></div>)}</div> : null}
              {editingFact === "preferences" ? <div className="fact-editor-grid"><div className="field"><label htmlFor="edit-budget">Budget</label><div className="money-input"><span>₹</span><input id="edit-budget" type="number" min="1" value={maxBudgetAmount ?? ""} onChange={(event) => setMaximumBudget(event.target.value)} /></div></div><div className="field"><label htmlFor="edit-pace">Pace</label><select id="edit-pace" value={request.preferences.pace ?? ""} onChange={(event) => updateRequest({ preferences: { ...request.preferences, pace: event.target.value as "relaxed" | "balanced" | "packed" } })}><option value="" disabled>Select pace</option><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="packed">Packed</option></select></div><div className="field"><label htmlFor="edit-interests">Interests</label><input id="edit-interests" value={interestText} placeholder="food, beaches" onChange={(event) => setInterestText(event.target.value)} /></div></div> : null}
            </form> : null}
          </section> : null}

          <section className="workspace-main">
          {showPlanningAnimation ? (
            <PlanningState elapsed={elapsed} mode={discovering ? "discovering" : "planning"} request={request} />
          ) : state.destinationDiscovery?.type === "destination_options" ? (
            <DestinationComparison
              result={state.destinationDiscovery}
              busy={busy}
              onSelect={(option) => void selectDestination(option)}
            />
          ) : trip && projectionState ? (
            <>
              {inventoryPicker ? (
                <InventoryOptionPicker picker={inventoryPicker} busy={busy} selectingOfferId={selectingOfferId} onSelect={(offer) => void selectInventoryOffer(offer)} onClose={() => setInventoryPicker(undefined)} />
              ) : null}
              <TripReview
                trip={trip}
                projection={projectionState}
                busy={busy}
                highlightedDay={focusedDay}
                highlightedSelectionId={focusedSelectionId}
                onToggleLock={(selectionId, locked) =>
                  void changeLock(selectionId, locked)
                }
                onAddActivity={(date) => void addActivityToDay(date)}
                onBrowseTravel={(selectionId) => void browseTravel(selectionId)}
                onBrowseStay={(selectionId) => void browseStay(selectionId)}
                onBrowseActivity={(date, selectionId) => void browseActivities(date, selectionId)}
                onBook={() => dispatch({ type: "conversation_entry_added", entry: { id: messageId("assistant"), role: "assistant", text: "Booking is intentionally disabled in this prototype. The itinerary and grounded price breakdown are ready for a real booking handoff." } })}
                onRequestCallback={() => dispatch({ type: "conversation_entry_added", entry: { id: messageId("assistant"), role: "assistant", text: "Callback scheduling is shown as the next service handoff. This prototype does not collect or transmit contact details." } })}
              />
            </>
          ) : initialExperience ? (
            <QuickStartGrid busy={busy} onSelect={(item) => void startQuickTrip(item)} />
          ) : (
            <EmptyWorkspace />
          )}
          </section>
        </div>
      </div>
    </main>
  );
}
