"use client";

import Image from "next/image";
import Link from "next/link";
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
import { Badge, Button, Card, Chip, IconButton } from "@/ui/components/primitives";
import { PriceSummary } from "@/ui/patterns/price-summary";
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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function locationCode(id: string): string {
  return (id.split(":").at(-1) ?? id).toUpperCase();
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

function activitiesOverlap(left: ActivityOffer, right: ActivityOffer): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt)
    && Date.parse(right.startsAt) < Date.parse(left.endsAt);
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

function BriefSetupWorkspace({ request, onEdit }: { request: TripRequest; onEdit(field: BriefFact): void }) {
  const essentials = [
    { field: "origin" as const, label: "Starting city", complete: Boolean(request.origin) },
    { field: "destination" as const, label: "Destination or recommendations", complete: Boolean(request.destination) },
    { field: "dates" as const, label: "Travel dates", complete: Boolean(request.startDate && request.endDate) },
    { field: "guests" as const, label: "Traveller details", complete: request.travellers.length > 0 },
  ];
  const remaining = essentials.filter((item) => !item.complete).length;
  const readyButUnplanned = remaining === 0;
  return (
    <div className="brief-setup-workspace" role="status" aria-live="polite">
      <div className="brief-setup-icon" aria-hidden="true">{readyButUnplanned ? "!" : remaining}</div>
      <p className="eyebrow">Trip essentials</p>
      <h2>{remaining > 0 ? `Complete ${remaining} detail${remaining === 1 ? "" : "s"} to start planning` : "I couldn't build this trip yet"}</h2>
      <p>{readyButUnplanned ? "Your trip details are complete, but the available inventory could not form a connected itinerary for these dates and constraints. Try a suggested adjustment in the conversation or change the dates, budget, or destination." : "The highlighted fields in the Trip Brief are required. Add them in any order; this checklist updates immediately."}</p>
      <div className="brief-setup-list">
        {essentials.map((item) => (
          <button type="button" className={item.complete ? "is-complete" : "is-missing"} key={item.field} onClick={() => onEdit(item.field)}>
            <i aria-hidden="true">{item.complete ? "✓" : ""}</i>
            <span>{item.label}</span>
            <strong>{item.complete ? "Added" : "Add now"}</strong>
          </button>
        ))}
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

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function destinationRecoveryActions(request: TripRequest, operationId: string): GuidedAction[] {
  const actions: GuidedAction[] = [];
  const budget = request.constraints.find((constraint) => constraint.category === "budget");
  if (budget?.category === "budget" && budget.value.maxTotal) {
    const amount = budget.value.maxTotal.amount + 10_000;
    actions.push({
      id: `${operationId}:increase-budget`,
      type: "set_budget",
      amount,
      label: `Increase budget by ${formatMoney(10_000)}`,
    });
    actions.push({
      id: `${operationId}:remove-budget`,
      type: "remove_constraint",
      constraintId: budget.id,
      label: "Remove the budget cap",
    });
  }
  if (request.startDate && request.endDate) {
    actions.push({
      id: `${operationId}:extend-dates`,
      type: "set_dates",
      startDate: request.startDate,
      endDate: addDays(request.endDate, 1),
      label: "Extend the trip by one day",
    });
    actions.push({
      id: `${operationId}:next-week`,
      type: "set_dates",
      startDate: addDays(request.startDate, 7),
      endDate: addDays(request.endDate, 7),
      label: "Try the following weekend",
    });
  }
  return actions.slice(0, 4);
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
      endDate: "2026-08-31",
      travellers: presetTravellers(["adult", "adult"]),
      preferences: { pace: "relaxed", interests: ["food", "relaxation"] },
      constraints: [maximumBudget(45_000)],
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
        <Card className="quick-start-card" key={item.id}>
          <Image src={item.image} alt="" width={840} height={420} sizes="(max-width: 820px) 100vw, 40vw" loading="eager" />
          <div>
            <h2>{item.title}</h2>
            <p>{item.prompt}</p>
            <Button variant="text" size="sm" disabled={busy} onClick={() => onSelect(item)}>Try this <span aria-hidden="true">→</span></Button>
          </div>
        </Card>
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

const destinationArtwork: Record<string, string> = {
  "city:goa": "/figma/destination-goa.png",
  "city:kochi": "/figma/destination-kochi.png",
  "city:puducherry": "/figma/destination-puducherry.png",
  "region:thailand-andaman": "/figma/destination-thailand.png",
  "city:manali": "https://images.pexels.com/photos/38884319/pexels-photo-38884319.jpeg?auto=compress&cs=tinysrgb&w=1200",
  "city:rishikesh": "https://images.pexels.com/photos/35185649/pexels-photo-35185649.png?auto=compress&cs=tinysrgb&w=1200",
  "city:darjeeling": "https://images.pexels.com/photos/12100892/pexels-photo-12100892.jpeg?auto=compress&cs=tinysrgb&w=1200",
  "city:srinagar": "https://images.pexels.com/photos/15963212/pexels-photo-15963212.jpeg?auto=compress&cs=tinysrgb&w=1200",
  "city:munnar": "https://images.pexels.com/photos/36982207/pexels-photo-36982207.jpeg?auto=compress&cs=tinysrgb&w=1200",
  "city:puri": "https://images.pexels.com/photos/37121962/pexels-photo-37121962.jpeg?auto=compress&cs=tinysrgb&w=1200",
};

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
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState<"fit" | "price" | "travel">("fit");
  const factsByMarket = new Map<string, typeof result.factBundle.facts>();
  for (const fact of result.factBundle.facts) {
    factsByMarket.set(fact.subjectId, [...(factsByMarket.get(fact.subjectId) ?? []), fact]);
  }
  const preferredDimensions = (result.block.emphasis?.comparisonDimensions ?? []).flatMap(
    (dimension) =>
      comparisonFactDimensions[dimension as keyof typeof comparisonFactDimensions] ?? [],
  );
  const supportingFacts = new Set(result.block.emphasis?.supportingFactIds ?? []);
  const numericFact = (optionId: string, dimension: string) => {
    const value = factsByMarket.get(optionId)?.find((fact) => fact.dimension === dimension)?.value;
    return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
  };
  const orderedOptions = [...result.options].sort((left, right) => {
    if (sortBy === "price") return numericFact(left.id, "price_floor") - numericFact(right.id, "price_floor");
    if (sortBy === "travel") return numericFact(left.id, "travel_minutes") - numericFact(right.id, "travel_minutes");
    return result.options.indexOf(left) - result.options.indexOf(right);
  });

  return (
    <section className="destination-comparison" aria-labelledby="destination-options-title">
      <header className="destination-comparison-heading">
        <div>
          <h2 id="destination-options-title">Choose where to continue</h2>
          {/* <p>{result.message}</p> */}
        </div>
        <Badge tone="success">◉ {result.shortlistedDestinationCount ?? result.block.choices.length} shortlisted from {result.matchingDestinationCount ?? result.options.length} matches</Badge>
      </header>
      <div className="destination-sort-controls" aria-label="Sort destination matches">
        <span>Sort by</span>
        <Chip aria-pressed={sortBy === "fit"} onClick={() => setSortBy("fit")}>Best fit</Chip>
        <Chip aria-pressed={sortBy === "price"} onClick={() => setSortBy("price")}>Lowest cost</Chip>
        <Chip aria-pressed={sortBy === "travel"} onClick={() => setSortBy("travel")}>Least travel</Chip>
      </div>
      <div className="destination-option-grid">
        {orderedOptions.slice(0, showAll ? orderedOptions.length : 3).map((option) => {
          const recommended = option.id === result.block.emphasis?.recommendedId;
          const allFacts = factsByMarket.get(option.id) ?? [];
          const facts = preferredDimensions
            .map((dimension) => allFacts.find((fact) => fact.dimension === dimension))
            .filter((fact): fact is (typeof allFacts)[number] => Boolean(fact))
            .filter((fact, index, items) => items.findIndex((item) => item.id === fact.id) === index)
            .slice(0, 3);
          const priceFact = facts.find((fact) => fact.dimension === "price_floor")
            ?? allFacts.find((fact) => fact.dimension === "price_floor");
          const artwork = option.imageUrl ?? destinationArtwork[option.id];
          return (
            <article className={recommended ? "destination-option recommended" : "destination-option"} key={option.id}>
              <div className="destination-option-art">
                {artwork ? <Image src={artwork} alt={option.imageAltText ?? `${option.name} destination`} fill sizes="(max-width: 820px) 100vw, 40vw" /> : <span>{option.countryCode}</span>}
                {recommended ? <Badge tone="info">Recommended</Badge> : null}
              </div>
              <div className="destination-option-body">
                <div className="destination-option-title-row">
                  <div>
                    <h3>{option.name.replace(" — Phuket & Krabi", "")}</h3>
                    <span>{option.region}</span>
                  </div>
                  {priceFact ? <div className="destination-floor"><small>Conservative floor</small><strong>{formatDestinationFact(priceFact.dimension, priceFact.value)}</strong></div> : null}
                </div>
                <div className="chip-row">
                  {option.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                {facts.some((fact) => supportingFacts.has(fact.id)) ? <span className="sr-only">Recommendation grounded in current inventory</span> : null}
                <Button variant={recommended ? "primary" : "secondary"} size="lg" disabled={busy} onClick={() => onSelect(option)}>
                  Continue with {option.name.replace(" — Phuket & Krabi", "")}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {result.options.length > 3 ? <Button variant="secondary" className="show-more-destinations" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show shortlist only" : `Show ${result.options.length - 3} more matching destinations`}</Button> : null}
      <p className="comparison-disclosure">Prices are conservative floors from currently available offers, not booking quotes.</p>
    </section>
  );
}

function DiscoveryRecovery({
  result,
  actions,
  busy,
  onAction,
}: {
  result: Extract<DestinationDiscoveryApiResult, { type: "conflict" }>;
  actions: GuidedAction[];
  busy: boolean;
  onAction(action: GuidedAction): void;
}) {
  return (
    <section className="discovery-recovery" aria-labelledby="discovery-recovery-title">
      <div className="recovery-visual" aria-hidden="true"><span>!</span></div>
      <p className="eyebrow">Let&apos;s adjust the trip</p>
      <h2 id="discovery-recovery-title">We couldn&apos;t find a complete match yet</h2>
      <p>{result.message} Changing one detail—usually the dates or budget—can open more supported options.</p>
      <div className="recovery-actions" aria-label="Ways to adjust this trip">
        {actions.map((action) => <Chip key={action.id} disabled={busy} onClick={() => onAction(action)}>{action.label}</Chip>)}
      </div>
      <small>Your current trip brief is preserved until you choose an adjustment.</small>
    </section>
  );
}

function airlineLogo(operator: string): string | undefined {
  if (/air india/i.test(operator)) return "/figma/airlines/air-india-connect.svg";
  if (/indigo/i.test(operator)) return "/figma/airlines/indigo-connect.svg";
  return undefined;
}

function TravelCard({ item }: { item: HydratedSelection }) {
  const { offer } = item;
  if (isTransport(offer)) {
    const logo = airlineLogo(offer.operator);
    const serviceNumber = offer.segments[0]?.number;
    const stopDescription = offer.stops === 0 ? "non-stop" : `${offer.stops} stop${offer.stops === 1 ? "" : "s"}`;
    return (
      <article className="itinerary-card itinerary-flight-card">
        <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true">✈</span><strong>{offer.mode} · {displayLocation(offer.from)} to {displayLocation(offer.to)} · {durationLabel(offer.durationMinutes)}</strong></header>
        <div className="flight-card-body">
          <div className="airline-mark">{logo ? <Image src={logo} alt={`${offer.operator} logo`} width={48} height={48} /> : <span aria-hidden="true">✈</span>}</div>
          <div className="flight-stop"><strong>{formatTime(offer.departureAt)}</strong><span>{formatCompactDateTime(offer.departureAt)}</span><small>{displayLocation(offer.from)}</small></div>
          <div className="flight-line"><i /><span>✈</span></div>
          <div className="flight-stop"><strong>{formatTime(offer.arrivalAt)}</strong><span>{formatCompactDateTime(offer.arrivalAt)}</span><small>{displayLocation(offer.to)}</small></div>
          <dl className="flight-facts"><div><dt>Operator</dt><dd>{offer.operator}</dd></div>{serviceNumber ? <div><dt>Flight</dt><dd>{serviceNumber}</dd></div> : null}<div><dt>Stops</dt><dd>{offer.stops === 0 ? "Non-stop" : `${offer.stops} stop${offer.stops === 1 ? "" : "s"}`}</dd></div></dl>
          <div className="card-price"><strong>{formatMoney(offer.price.amount)}</strong><span>/ traveller</span></div>
        </div>
        <div className="card-grounding"><i aria-hidden="true">✓</i><span>{offer.operator} was selected for this dated route: it departs at {formatTime(offer.departureAt)}, arrives at {formatTime(offer.arrivalAt)}, and is {stopDescription}.</span></div>
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
        <div className="card-grounding"><i aria-hidden="true">✓</i><span>This {offer.mode} transfer directly connects {displayLocation(offer.from)} to {displayLocation(offer.to)} in {durationLabel(offer.durationMinutes)} and fits the validated route.</span></div>
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
          <Button variant="text" size="sm" className="inline-card-action" onClick={onModify}>Modify room</Button>
        </div>
      </div>
      <div className="card-grounding"><i aria-hidden="true">✓</i><span>This stay covers all {nights} night{nights === 1 ? "" : "s"} for {offer.rooms} room{offer.rooms === 1 ? "" : "s"}. It is rated {offer.propertyFacts.rating.toFixed(1)} from {offer.propertyFacts.reviewCount} reviews and includes {offer.propertyFacts.amenities.slice(0, 2).join(" and ")}.</span></div>
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
        <div><h3>{offer.activityFacts.name}</h3><p>{formatDateTime(offer.startsAt)} – {formatDateTime(offer.endsAt)}</p><div className="card-price"><strong>{formatMoney(offer.price.amount)}</strong><span>/ per person</span></div><ul><li>Duration {durationLabel(durationMinutes)}</li><li>{offer.activityFacts.mobility} mobility</li><li>Capacity {offer.capacity}</li></ul><Button variant="text" size="sm" className="inline-card-action" onClick={onModify}>Modify activity</Button></div>
      </div>
      <div className="card-grounding"><i aria-hidden="true">✓</i><span>This {offer.activityFacts.mobility}-mobility experience fits the available time on this day without overlapping travel. It supports {offer.activityFacts.tags.slice(0, 3).join(", ")} interests.</span></div>
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
      <Button variant="text" size="sm" disabled={busy} onClick={onToggleLock}>{locked ? "Unlock" : "Lock"}</Button><span>·</span>
      {onBrowseAlternatives ? <Button variant="text" size="sm" disabled={busy} onClick={onBrowseAlternatives}>{alternativeLabel ?? "Change"}</Button> : null}
    </div>
  );
}

function AiFocusStatus({ message }: { message: string }) {
  return (
    <div className="ai-focus-status" role="status" aria-live="polite">
      <i aria-hidden="true" />
      <span>{message}</span>
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
          <IconButton aria-label="Close drawer" onClick={onClose}>×</IconButton>
        </header>
        <div className="inventory-drawer-filter">Showing {visibleOffers.length} valid {noun} <span>· Sorted by best fit</span></div>
        <div className="inventory-drawer-list">
          {picker.loading ? <p className="inventory-picker-status">Checking dated availability…</p> : null}
          {picker.error ? <p className="inventory-picker-status error">{picker.error}</p> : null}
          {!picker.loading && !picker.error && visibleOffers.length === 0 ? <p className="inventory-picker-status">{picker.kind === "activity" ? "No non-overlapping activities are available for this day." : "No matching valid inventory is available."}</p> : null}
          {visibleOffers.map((offer) => {
            const selected = offer.id === picker.currentOfferId;
            const selecting = offer.id === selectingOfferId;
            const priceDelta = currentPrice === undefined ? offer.price.amount : offer.price.amount - currentPrice;
            return <article className={selected ? "drawer-option selected" : "drawer-option"} key={offer.id}>
              <div className="drawer-option-media">
                {isStay(offer) ? <SkeletonImage src={stayImage(offer)} alt={offer.propertyFacts.imageAltText ?? offer.propertyFacts.name} fill sizes="220px" /> : isActivity(offer) ? <SkeletonImage src={activityImage(offer)} alt={offer.activityFacts.imageAltText ?? offer.activityFacts.name} fill sizes="220px" /> : <Image src={isTransfer(offer) ? "/figma/itinerary/private-transfer.png" : "/figma/flight-option.svg"} alt="" fill sizes="220px" />}
                {selected ? <b>Selected</b> : null}
              </div>
              <div className="drawer-option-content">
                {isTransport(offer) ? <><h3>{offer.operator} · {offer.mode}</h3><p className="drawer-flight-times"><strong>{formatTime(offer.departureAt)}</strong><span>{locationCode(offer.from)}</span><i aria-hidden="true">→</i><strong>{formatTime(offer.arrivalAt)}</strong><span>{locationCode(offer.to)}</span></p><small>{formatCompactDateTime(offer.departureAt)} · {durationLabel(offer.durationMinutes)} · {offer.stops === 0 ? "Non-stop" : `${offer.stops} stop${offer.stops === 1 ? "" : "s"}`}</small></> : null}
                {isTransfer(offer) ? <><h3>{offer.mode === "shared" ? "Shared transfer" : "Private transfer"}</h3><p>{displayLocation(offer.from)} → {displayLocation(offer.to)}</p><small>{durationLabel(offer.durationMinutes)} · capacity {offer.capacity}</small></> : null}
                {isStay(offer) ? <><h3>{offer.propertyFacts.name}</h3><p>★ {offer.propertyFacts.rating.toFixed(1)} · {offer.propertyFacts.reviewCount} reviews</p><small>{offer.roomFacts.roomLabel} · {offer.roomFacts.mealPlan === "breakfast" ? "Includes breakfast" : "Room only"} · {offer.roomFacts.refundable ? "Refundable" : "Non-refundable"}</small></> : null}
                {isActivity(offer) ? <><h3>{offer.activityFacts.name}</h3><p>{formatDateTime(offer.startsAt)} · {offer.activityFacts.mobility} mobility</p><small>{offer.activityFacts.tags.slice(0, 3).join(" · ")}</small></> : null}
              </div>
              <div className="drawer-option-action">
                <strong>{selected ? "Current" : priceDelta === 0 ? "No price change" : `${priceDelta > 0 ? "+ " : "− "}${formatMoney(Math.abs(priceDelta))}`}</strong>
                <small>{isStay(offer) ? "per room / night" : isTransfer(offer) ? "per vehicle" : "per person"}</small>
                {selected ? <Badge tone="info">Selected</Badge> : <Button size="sm" disabled={busy || Boolean(selectingOfferId)} onClick={() => onSelect(offer)}>{selecting ? "Selecting…" : "Select"}</Button>}
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
  focusMessage,
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
  focusMessage?: string;
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
            {highlightedDay === day.date ? <AiFocusStatus message={focusMessage ?? "Updating this day in your itinerary"} /> : null}
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
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => onAddActivity(day.date)}>
                  + Add activity
                </Button>
              </header>
              <div className="day-events">
                {day.events.map((event) => {
                  if (event.type === "free_time") {
                    return <div className="free-time-card" key={event.id}><span aria-hidden="true">◉</span><strong>{event.title}</strong><Button variant="text" size="sm" disabled={busy} onClick={() => onAddActivity(day.date)}>+ Add activity</Button></div>;
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
                      {highlightedSelectionId === selection.id ? <AiFocusStatus message={focusMessage ?? `Updating this ${selection.kind} option`} /> : null}
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
  focusMessage,
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
  focusMessage?: string;
}) {
  const [activeDay, setActiveDay] = useState(projection.itinerary[0]?.date ?? "");
  const travellerCount = trip.request.travellers.length;
  const perPersonCost = (amount: number) => formatMoney(Math.round(amount / travellerCount));

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
        <Badge tone="success" className="trip-generated-badge">◉ Trip generated</Badge>
      </header>
      <nav className="day-navigation" aria-label="Jump to itinerary day">
        {projection.itinerary.map((day) => <a className={activeDay === day.date ? "is-active" : undefined} key={day.date} href={`#${dayAnchor(day.date)}`} onClick={() => setActiveDay(day.date)}>Day {day.dayNumber}</a>)}
      </nav>
      <Itinerary trip={trip} projection={projection} busy={busy} onToggleLock={onToggleLock} onAddActivity={onAddActivity} onBrowseTravel={onBrowseTravel} onBrowseStay={onBrowseStay} onBrowseActivity={onBrowseActivity} highlightedDay={highlightedDay} highlightedSelectionId={highlightedSelectionId} focusMessage={focusMessage} />
      <PriceSummary
        metrics={[
          { label: "Trip total", amount: formatMoney(projection.budget.total.amount), detail: `${perPersonCost(projection.budget.total.amount)} per person` },
          { label: "Travel total", amount: formatMoney(projection.budget.breakdown.travel.amount), detail: `${perPersonCost(projection.budget.breakdown.travel.amount)} per person` },
          { label: "Stays total", amount: formatMoney(projection.budget.breakdown.stays.amount), detail: `${perPersonCost(projection.budget.breakdown.stays.amount)} per person` },
          { label: "Activities total", amount: formatMoney(projection.budget.breakdown.activities.amount), detail: `${perPersonCost(projection.budget.breakdown.activities.amount)} per person` },
        ]}
        actions={<div className="checkout-actions"><Button onClick={onBook}>Book now</Button><Button variant="text" size="sm" onClick={onRequestCallback}>Request callback</Button></div>}
      />
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

export default function TravelWorkspace({ initialPrompt = "", autoSubmitInitialPrompt = false }: { initialPrompt?: string; autoSubmitInitialPrompt?: boolean }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const request = state.itinerary.request;
  const trip = state.itinerary.trip;
  const projectionState = state.itinerary.projection;
  const [originLabel, setOriginLabel] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [interestText, setInterestText] = useState("");
  const [composerText, setComposerText] = useState(initialPrompt);
  const [inventoryPicker, setInventoryPicker] = useState<InventoryPicker>();
  const [selectingOfferId, setSelectingOfferId] = useState<string>();
  const [guidedChangeActive, setGuidedChangeActive] = useState(false);
  const [highlightedDay, setHighlightedDay] = useState<string>();
  const [showPlanningAnimation, setShowPlanningAnimation] = useState(false);
  const [editingFact, setEditingFact] = useState<BriefFact>();
  const factEditorRef = useRef<HTMLFormElement | null>(null);
  const conversationRef = useRef<HTMLElement | null>(null);
  const initialPlanningDeadlineRef = useRef<Promise<void> | undefined>(undefined);
  const initialPromptConsumedRef = useRef(false);

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
    const nextRequest = { ...request, ...patch };
    dispatch({
      type: "replace_request",
      request: nextRequest,
    });
    if (!trip) {
      const guidance = nextBriefGuidance(nextRequest);
      if (guidance) dispatch({ type: "interaction_updated", interaction: guidance });
      else dispatch({ type: "interaction_cleared" });
    }
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

  useEffect(() => {
    if (!autoSubmitInitialPrompt || !initialPrompt.trim() || initialPromptConsumedRef.current) return;
    initialPromptConsumedRef.current = true;
    void submitNaturalIntake(undefined, initialPrompt);
  }, [autoSubmitInitialPrompt, initialPrompt]);

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

    const responseDeadline = new Promise<void>((resolve) => window.setTimeout(resolve, 3_500));

    dispatch({
      type: "conversation_started",
      entry: { id: messageId("user"), role: "user", text: message },
    });
    setComposerText("");

    // Handle whole-trip date changes deterministically before selection-level
    // modification routing. These requests change the planning scope rather
    // than targeting a particular itinerary card.
    const extendMatch = message.match(/\b(?:add|extend|include)\s+(?:one|1|an?)\s+(?:more\s+)?day\b/i);
    if (extendMatch && trip.request.endDate) {
      const nextEndDate = addDays(trip.request.endDate, 1);
      const nextRequest: TripRequest = { ...trip.request, endDate: nextEndDate };
      dispatch({ type: "replace_request", request: nextRequest });
      dispatch({ type: "conversation_entry_added", entry: { id: messageId("assistant"), role: "assistant", text: `I’ll extend the trip through ${formatDate(nextEndDate)} and rebuild the connected itinerary.` } });
      await executeSpecifiedPlan(nextRequest, undefined, false);
      return;
    }

    // If the user asks for activities without naming a day, guide them with
    // the actual days in this itinerary instead of returning an opaque target
    // disambiguation error.
    if (/\b(?:add|include|schedule|plan)\b.*\bactivit(?:y|ies)\b/i.test(message) && !/\bday\s*\d+\b/i.test(message)) {
      const guideId = operationId("activity-guide");
      const days = projectionState?.itinerary ?? [];
      const actions: GuidedAction[] = days.slice(0, 6).map((day) => ({
        id: `${guideId}:${day.date}`,
        type: "select_activity_day",
        date: day.date,
        label: `Explore activities on Day ${day.dayNumber}`,
      }));
      const guidance = `Sure — which day would you like to add activities to? I found ${days.length} days in this trip.`;
      dispatch({ type: "conversation_reply_received", entry: { id: messageId("assistant"), role: "assistant", text: guidance } });
      dispatch({ type: "interaction_updated", interaction: {
        message: guidance,
        events: [{ id: `${guideId}:event`, type: "fact_recognized", status: "completed", label: "Ready to add activities to a selected day" }],
        actions,
      } });
      return;
    }
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
          conversationHistory: state.conversation.slice(-8).map(({ role, text }) => ({ role, text })),
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

      await responseDeadline;

      const envelope = body as { kind?: unknown; result?: unknown; message?: unknown };
      if (envelope.kind === "reply" && typeof envelope.message === "string") {
        dispatch({ type: "conversation_reply_received", entry: { id: messageId("assistant"), role: "assistant", text: envelope.message } });
        dispatch({ type: "interaction_updated", interaction: {
          message: envelope.message,
          events: [{ id: `${turnOperationId}:complete`, type: "operation_completed", status: "completed", label: "Answered from the current trip context" }],
          actions: [],
        } });
        return;
      }
      if (envelope.kind === "suggestion" && isModificationResult(envelope.result)) {
        handleSuggestionResult(envelope.result);
        return;
      }
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
      if (!trip) initialPlanningDeadlineRef.current = undefined;
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
      if (!trip) initialPlanningDeadlineRef.current = undefined;
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
        entry: { id: messageId("assistant"), role: "assistant", text: body.type === "destination_options" && body.recommendationExplanation ? `${body.message} ${body.recommendationExplanation}` : body.message },
      });
      if (body.type === "conflict") {
        const recoveryActions = destinationRecoveryActions(request, activeOperationId);
        dispatch({ type: "interaction_updated", interaction: {
          message: "I couldn't find a fully supported match for those exact details. Choose an adjustment below to widen the available options.",
          events: [{ id: `${activeOperationId}:constraint`, type: "constraint_detected", status: "completed", label: "Dates or budget need a small adjustment" }],
          actions: recoveryActions,
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
    const essentials = [
      { missing: !nextRequest.origin, field: "origin" as const, label: "Starting city" },
      { missing: !nextRequest.destination, field: "destination" as const, label: "Destination or recommendations" },
      { missing: !nextRequest.startDate || !nextRequest.endDate, field: "dates" as const, label: "Travel dates" },
      { missing: nextRequest.travellers.length === 0, field: "travellers" as const, label: "Traveller details" },
    ];
    const missing = essentials.filter((item) => item.missing);
    if (missing.length === 0) return undefined;
    const actions: GuidedAction[] = [];
    if (!nextRequest.destination) actions.push({ id: `${nextOperationId}:open`, type: "set_open_destination", label: "Help me choose" });
    if (!nextRequest.startDate || !nextRequest.endDate) actions.push(
      ...(state.latestIntake?.suggestedDateRanges ?? []).map((range) => ({ id: `${nextOperationId}:${range.id}`, type: "set_dates" as const, startDate: range.startDate, endDate: range.endDate, label: range.label })),
    );
    if (nextRequest.travellers.length === 0) actions.push(
        { id: `${nextOperationId}:solo`, type: "set_travellers", adults: 1, children: 0, seniors: 0, label: "Just me" },
        { id: `${nextOperationId}:two`, type: "set_travellers", adults: 2, children: 0, seniors: 0, label: "2 adults" },
        { id: `${nextOperationId}:family`, type: "set_travellers", adults: 2, children: 1, seniors: 0, label: "2 adults + 1 child" },
    );
    const firstMissing = missing[0]!;
    return {
      message: `Complete ${missing.map((item) => item.label.toLocaleLowerCase("en")).join(", ")} to start planning. The checklist and highlighted Trip Brief fields update as you add them.`,
      events: essentials.map((item): InteractionEvent => ({
        id: `${nextOperationId}:essential:${item.field}`,
        type: item.missing ? "fact_missing" : "fact_recognized",
        status: item.missing ? (item.field === firstMissing.field ? "active" : "pending") : "completed",
        label: `${item.label} ${item.missing ? "needed" : "added"}`,
        target: { type: "trip_field", field: item.field },
      })),
      actions: actions.slice(0, 8),
      focus: { operationId: nextOperationId, target: { type: "trip_field", field: firstMissing.field }, phase: "understanding" },
    };
  }

  function planningRecoveryActions(outcome: Exclude<SpecifiedPlanApiResult, { type: "trip_ready" }>): GuidedAction[] {
    if (outcome.type === "clarification") {
      return [{ id: operationId("continue"), type: "submit_plan", label: "Continue with current details" }];
    }
    const groundedActions = (outcome.factBundle?.allowedFollowUpActions ?? []).flatMap((action): GuidedAction[] => {
      if (action.type === "retry") return [];
      if (action.type === "change_scope") return [{ id: action.id, type: "set_open_destination", label: "Compare other destinations" }];
      if (action.type === "keep_current") return [{ id: action.id, type: "keep_current", label: action.label }];
      if (action.type === "adjust_constraint") {
        const constraintId = action.id.replace(/^action:adjust:/, "");
        const constraint = request.constraints.find((item) => item.id === constraintId);
        if (constraint?.category === "budget" && constraint.value.maxTotal) {
          return [{ id: action.id, type: "set_budget", amount: constraint.value.maxTotal.amount + 10_000, label: `Increase budget by ${formatMoney(10_000)}` }];
        }
        return [{ id: action.id, type: "remove_constraint", constraintId, label: action.label }];
      }
      return [];
    });
    const fallbacks = destinationRecoveryActions(request, operationId("plan-recovery"));
    const candidates = [...groundedActions, ...fallbacks];
    const unique = new Map<string, GuidedAction>();
    for (const action of candidates) {
      const key = action.type === "set_budget" || action.type === "remove_constraint"
        ? "budget"
        : action.type === "set_dates"
          ? action.id.endsWith(":next-week") ? "next-week" : "extend-dates"
          : action.type;
      if (!unique.has(key)) unique.set(key, action);
    }
    return [...unique.values()].slice(0, 4);
  }

  async function handleGuidedAction(action: GuidedAction) {
    if (busy) return;
    if (action.type === "retry" || action.type === "submit_plan") {
      await submitPlan();
      return;
    }
    if (!trip && (action.type === "select_activity_day" || action.type === "select_modification_target" || action.type === "apply_proposal" || action.type === "keep_current")) return;
    dispatch({ type: "conversation_entry_added", entry: { id: messageId("user"), role: "user", text: action.label } });
    if (action.type === "select_activity_day") {
      await addActivityToDay(action.date);
      return;
    }
    if (action.type === "select_modification_target") {
      const currentTrip = trip;
      const selection = action.target === "stay" ? currentTrip?.selectedStays[0] : action.target === "travel" ? currentTrip?.selectedTravel[0] : currentTrip?.selectedActivities[0];
      if (selection) {
        if (action.target === "stay") await browseStay(selection.id);
        else if (action.target === "travel") await browseTravel(selection.id);
        else if (currentTrip?.selectedActivities[0]) await browseActivities(currentTrip.selectedActivities[0].date);
      }
      return;
    }
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
    const rawMessage = typeof value?.message === "string" ? value.message.trim() : "";
    const message = /overlap/i.test(rawMessage)
      ? "That activity overlaps with something already scheduled. Choose another time."
      : /(?:selection|offer|session):/i.test(rawMessage) || rawMessage.length > 220
        ? fallback
        : rawMessage || fallback;
    const workspaceError = {
      code: typeof value?.code === "string" ? value.code : "NETWORK_FAILURE",
      message,
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
        ...(result.proposals.length === 0 ? [
          { id: `${conflictOperationId}:stay`, type: "select_modification_target" as const, target: "stay" as const, label: "Make my stay cheaper" },
          { id: `${conflictOperationId}:activity`, type: "select_modification_target" as const, target: "activity" as const, label: "Reduce an activity cost" },
          { id: `${conflictOperationId}:travel`, type: "select_modification_target" as const, target: "travel" as const, label: "Change my travel" },
        ] : []),
        { id: `${conflictOperationId}:keep`, type: "keep_current" as const, label: "Keep the current trip" },
      ],
    } });
  }

  function handleSuggestionResult(result: ModificationResult) {
    if (result.type === "conflict") {
      handleModificationResult(result);
      return;
    }
    const options = result.type === "alternatives"
      ? result.options
      : [{
          proposal: result.proposal,
          preview: result.preview,
          projection: result.projection,
          message: result.message,
        }];
    const assistantMessage = result.type === "alternatives"
      ? result.message
      : "I found one schedule-valid activity near the stay. Select it below if you want to add it.";
    dispatch({
      type: "modification_options_received",
      result,
      entry: { id: messageId("assistant"), role: "assistant", text: assistantMessage },
    });
    const suggestionOperationId = operationId("suggest");
    dispatch({ type: "interaction_updated", interaction: {
      message: assistantMessage,
      events: [{ id: `${suggestionOperationId}:complete`, type: "inventory_search_completed", status: "completed", label: "Found activities that preserve the current schedule" }],
      actions: options.slice(0, 4).map((option) => ({
        id: `${suggestionOperationId}:${option.proposal.id}`,
        type: "apply_proposal" as const,
        proposalId: option.proposal.id,
        label: option.message.replace(/\s+on\s+\d{4}-\d{2}-\d{2}\.?$/, ""),
      })),
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
      const scheduledActivities = projectionState?.hydratedSelections
        .filter((item) => item.selectionId !== selectionId && isActivity(item.offer) && item.offer.startsAt.slice(0, 10) === date)
        .map((item) => item.offer as ActivityOffer) ?? [];
      const scheduleValidOffers = body.results.filter((offer) =>
        offer.id !== currentOfferId
        && scheduledActivities.every((scheduled) => !activitiesOverlap(offer, scheduled)),
      );
      setInventoryPicker({ kind: "activity", date, selectionId, currentOfferId, offers: [...(currentActivity ? [currentActivity] : []), ...scheduleValidOffers], loading: false });
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
  const focusMessage = state.interaction?.events.find((event) => event.status === "active")?.label
    ?? state.interaction?.message;
  function tripFactClass(field: BriefFact, populated: boolean): string {
    const essential = field !== "preferences";
    return ["trip-fact", populated ? "" : "trip-fact-empty", !trip && hasBriefFacts && essential && !populated ? "essential-missing" : "", focusedTripField === field ? "ai-focus" : ""].filter(Boolean).join(" ");
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
            <Link className="mmt-logo-link" href="/" aria-label="Go to MakeMyTrip trip planner home">
              <Image className="mmt-logo" src="/figma/itinerary/mmt-logo.png" alt="MakeMyTrip" width={169} height={40} priority />
            </Link>
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
              <Button type="submit" disabled={busy || composerText.trim().length < 2}>{interpreting ? "Planning…" : "Plan"} <span aria-hidden="true">→</span></Button>
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
              <Chip type="button" className="guided-action-chip" disabled={busy} key={action.id} onClick={() => void handleGuidedAction(action)}>
                {action.label}
              </Chip>
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
              <IconButton type="submit" aria-label="Send message" disabled={busy || composerText.trim().length < 2}>
                <Image src="/figma/arrow-up.svg" alt="" width={24} height={24} />
              </IconButton>
            </div>
            <small>{interpreting ? "Understanding your request…" : <>AI-assisted travel service. Check important <span>info</span>.</>}</small>
          </form></>}
        </aside>

        <div className="workspace-stage">
          {hasBriefFacts ? <section className={`trip-brief-bar${editingFact ? ` fact-editing-${editingFact}` : ""}`} aria-label="Current Trip Brief">
            <button type="button" className={tripFactClass("origin", Boolean(request.origin))} onClick={() => setEditingFact(editingFact === "origin" ? undefined : "origin")}><span>From city</span><strong>{originFact}</strong></button>
            <button type="button" className={tripFactClass("destination", Boolean(request.destination))} onClick={() => setEditingFact(editingFact === "destination" ? undefined : "destination")}><span>To city / country</span><strong>{destinationFact}</strong></button>
            <button type="button" className={tripFactClass("dates", Boolean(request.startDate && request.endDate))} onClick={() => setEditingFact(editingFact === "dates" ? undefined : "dates")}><span>Travel dates</span><strong>{dateFact}</strong></button>
            <button type="button" className={tripFactClass("guests", request.travellers.length > 0)} onClick={() => setEditingFact(editingFact === "guests" ? undefined : "guests")}><span>Guests</span><strong>{guestsFact}</strong></button>
            <button type="button" className={tripFactClass("preferences", hasPreferences)} onClick={() => setEditingFact(editingFact === "preferences" ? undefined : "preferences")}><span>Preferences</span><strong>{preferenceFact}</strong></button>
            <Button className="trip-update-button" disabled={busy || Boolean(briefProblem)} onClick={() => void submitPlan()}>Update</Button>
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
          ) : state.destinationDiscovery?.type === "conflict" ? (
            <DiscoveryRecovery
              result={state.destinationDiscovery}
              actions={state.interaction?.actions ?? []}
              busy={busy}
              onAction={(action) => void handleGuidedAction(action)}
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
                focusMessage={focusMessage}
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
            <BriefSetupWorkspace request={request} onEdit={setEditingFact} />
          )}
          </section>
        </div>
      </div>
    </main>
  );
}
