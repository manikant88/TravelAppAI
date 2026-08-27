"use client";

import {
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
  type StoredProposal,
} from "@/state";
import type { TripProposal } from "@/domain/proposals";

type ReviewTab = "travel" | "stays" | "activities";

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

function isProposalEvaluation(
  value: unknown,
): value is Pick<StoredProposal, "preview" | "projection"> {
  if (!value || typeof value !== "object") return false;
  const item = value as { preview?: unknown; projection?: unknown };
  return Boolean(item.preview && item.projection);
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

function BriefSummary({ request }: { request: TripRequest }) {
  return (
    <div className="brief-summary">
      <span>{request.origin ? displayLocation(request.origin) : "Origin"}</span>
      <ArrowIcon />
      <span>
        {request.destination?.kind === "specified"
          ? displayLocation(request.destination.locationId)
          : request.destination?.kind === "open"
            ? "Agent recommendation"
          : "Destination"}
      </span>
      <small>
        {request.startDate && request.endDate
          ? `${formatDate(request.startDate)} – ${formatDate(request.endDate)}`
          : "Add dates"}
        {` · ${request.travellers.length} traveller${request.travellers.length === 1 ? "" : "s"}`}
      </small>
    </div>
  );
}

function PlanningState({ elapsed, mode }: { elapsed: number; mode: "discovering" | "planning" }) {
  const discovering = mode === "discovering";
  return (
    <div className="planning-state" role="status" aria-live="polite">
      <div className="planner-orbit" aria-hidden="true">
        <span />
        <SparkIcon />
      </div>
      <p className="eyebrow">{discovering ? "Comparing supported markets" : "Planning with grounded inventory"}</p>
      <h2>{discovering ? "Finding where this trip fits best" : "Building a trip that connects"}</h2>
      <p>
        {discovering
          ? "Code is checking real route, stay, activity, and budget coverage before the planner recommends among valid destinations."
          : "The planner is gathering valid options, comparing trade-offs, assembling the route, and checking the complete trip before showing it."}
      </p>
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
        <span>You approve changes</span>
      </div>
    </div>
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

function BudgetSummary({ projection }: { projection: TripProjection }) {
  const { budget } = projection;
  const parts = [
    ["Travel", budget.breakdown.travel.amount],
    ["Stays", budget.breakdown.stays.amount],
    ["Activities", budget.breakdown.activities.amount],
  ] as const;
  return (
    <aside className="budget-card">
      <p className="eyebrow">Trip total</p>
      <strong>{formatMoney(budget.total.amount)}</strong>
      <span>Calculated from selected offers</span>
      <div className="budget-breakdown">
        {parts.map(([label, amount]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{formatMoney(amount)}</b>
          </div>
        ))}
      </div>
      {budget.maximum ? (
        <div className={budget.amountOverMaximum ? "budget-limit over" : "budget-limit"}>
          <span>Maximum</span>
          <b>{formatMoney(budget.maximum.amount)}</b>
        </div>
      ) : null}
    </aside>
  );
}

function TravelCard({ item }: { item: HydratedSelection }) {
  const { offer } = item;
  if (isTransport(offer)) {
    return (
      <article className="entity-card">
        <div className="entity-card-head">
          <span className="mode-badge">{offer.mode}</span>
          <span>{offer.stops === 0 ? "Non-stop" : `${offer.stops} stop`}</span>
        </div>
        <h3>{offer.operator}</h3>
        <div className="route-times">
          <div>
            <strong>{offer.departureAt.slice(11, 16)}</strong>
            <span>{displayLocation(offer.from)}</span>
          </div>
          <div className="duration-line">
            <small>{Math.round(offer.durationMinutes / 60)}h {offer.durationMinutes % 60}m</small>
            <i />
          </div>
          <div>
            <strong>{offer.arrivalAt.slice(11, 16)}</strong>
            <span>{displayLocation(offer.to)}</span>
          </div>
        </div>
        <footer>
          <span>{formatDate(offer.departureAt.slice(0, 10))}</span>
          <b>{formatMoney(offer.price.amount)} / traveller</b>
        </footer>
      </article>
    );
  }
  if (isTransfer(offer)) {
    return (
      <article className="entity-card compact-card">
        <span className="mode-badge">{offer.mode} transfer</span>
        <h3>{displayLocation(offer.from)} to {displayLocation(offer.to)}</h3>
        <p>{offer.durationMinutes} min · capacity {offer.capacity}</p>
        <b>{formatMoney(offer.price.amount)} / vehicle</b>
      </article>
    );
  }
  return null;
}

function StayCard({ item }: { item: HydratedSelection }) {
  if (!isStay(item.offer)) return null;
  const offer = item.offer;
  return (
    <article className="entity-card stay-card">
      <div className="card-art stay-art" aria-hidden="true"><span>STAY</span></div>
      <div className="card-content">
        <div className="entity-card-head">
          <span className="rating">★ {offer.propertyFacts.rating.toFixed(1)}</span>
          <span>{offer.roomFacts.refundable ? "Refundable" : "Non-refundable"}</span>
        </div>
        <h3>{offer.propertyFacts.name}</h3>
        <p>{offer.roomFacts.roomLabel} · {offer.roomFacts.mealPlan === "breakfast" ? "Breakfast included" : "Room only"}</p>
        <div className="chip-row">
          {offer.propertyFacts.amenities.slice(0, 3).map((amenity) => <span key={amenity}>{amenity}</span>)}
        </div>
        <footer>
          <span>{formatDate(offer.checkIn)} – {formatDate(offer.checkOut)}</span>
          <b>{formatMoney(offer.price.amount)} / room / night</b>
        </footer>
      </div>
    </article>
  );
}

function ActivityCard({ item }: { item: HydratedSelection }) {
  if (!isActivity(item.offer)) return null;
  const offer = item.offer;
  return (
    <article className="entity-card activity-card">
      <div className="activity-date">
        <strong>{new Date(offer.startsAt).getDate()}</strong>
        <span>{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(offer.startsAt))}</span>
      </div>
      <div>
        <div className="entity-card-head">
          <span>{formatDateTime(offer.startsAt)}</span>
          <span>{offer.activityFacts.mobility} mobility</span>
        </div>
        <h3>{offer.activityFacts.name}</h3>
        <p>{offer.activityFacts.tags.slice(0, 3).join(" · ")}</p>
      </div>
      <b>{formatMoney(offer.price.amount)} / person</b>
    </article>
  );
}

function SelectionActions({
  locked,
  busy,
  onToggleLock,
  onExplain,
}: {
  locked: boolean;
  busy: boolean;
  onToggleLock(): void;
  onExplain(): void;
}) {
  return (
    <div className="selection-actions">
      <span className={locked ? "lock-state locked" : "lock-state"}>
        {locked ? "Locked" : "Flexible"}
      </span>
      <div>
        <button type="button" disabled={busy} onClick={onExplain}>Explain choice</button>
        <button type="button" disabled={busy} onClick={onToggleLock}>
          {locked ? "Propose unlock" : "Propose lock"}
        </button>
      </div>
    </div>
  );
}

function operationLabel(operation: TripProposal["operations"][number]): string {
  switch (operation.type) {
    case "replace_travel":
      return "Replace selected travel";
    case "replace_stay":
      return "Replace selected stay";
    case "replace_activity":
      return "Replace selected activity";
    case "remove_activity":
      return "Remove selected activity";
    case "update_activity_participants":
      return "Update activity participants";
    case "set_selection_lock":
      return operation.locked ? "Lock this selection" : "Unlock this selection";
    case "upsert_constraint":
      return "Update trip constraint";
    case "remove_constraint":
      return "Remove trip constraint";
  }
}

function ChangeProposal({
  stored,
  applying,
  onApprove,
  onDismiss,
}: {
  stored: StoredProposal;
  applying: boolean;
  onApprove(): void;
  onDismiss(): void;
}) {
  const { proposal, preview } = stored;
  return (
    <section className="change-proposal" aria-labelledby="proposal-title">
      <div className="proposal-heading">
        <div>
          <p className="eyebrow">Approval required</p>
          <h2 id="proposal-title">Review proposed change</h2>
        </div>
        <span>Trip v{proposal.baseTripVersion} → v{preview.nextTrip.version}</span>
      </div>
      <p>{stored.message}</p>
      <div className="proposal-operations">
        {proposal.operations.map((operation, index) => (
          <div key={`${operation.type}:${index}`}>
            <span>{index + 1}</span>
            <strong>{operationLabel(operation)}</strong>
          </div>
        ))}
      </div>
      <div className="proposal-facts">
        <div>
          <span>Trip total</span>
          <strong>
            {preview.budgetDelta.amount === 0
              ? "No change"
              : `${preview.budgetDelta.amount > 0 ? "+" : "−"}${formatMoney(Math.abs(preview.budgetDelta.amount))}`}
          </strong>
        </div>
        <div>
          <span>Preserved</span>
          <strong>{preview.preservedSelectionIds.length} selections</strong>
        </div>
        <div>
          <span>Validation</span>
          <strong>{preview.validation.valid ? "Passed" : "Blocked"}</strong>
        </div>
      </div>
      <div className="proposal-buttons">
        <button type="button" className="secondary-button" disabled={applying} onClick={onDismiss}>
          Keep current trip
        </button>
        <button type="button" className="primary-button" disabled={applying} onClick={onApprove}>
          {applying ? "Applying…" : "Approve and apply"}
        </button>
      </div>
    </section>
  );
}

type ModificationAlternatives = Extract<ModificationResult, { type: "alternatives" }>;

function alternativeLabel(stored: StoredProposal): string {
  const changed = new Set(stored.preview.changedSelectionIds);
  const item = stored.projection.hydratedSelections.find((selection) =>
    changed.has(selection.selectionId),
  );
  if (!item) return "Validated alternative";
  if (isTransport(item.offer)) return `${item.offer.operator} · ${item.offer.mode}`;
  if (isTransfer(item.offer)) return `${item.offer.mode} transfer`;
  if (isStay(item.offer)) return item.offer.propertyFacts.name;
  return item.offer.activityFacts.name;
}

function ModificationOptionComparison({
  result,
  proposals,
  busy,
  onSelect,
}: {
  result: ModificationAlternatives;
  proposals: Record<string, StoredProposal>;
  busy: boolean;
  onSelect(proposalId: string): void;
}) {
  const recommendedId = result.block.emphasis?.recommendedId;
  return (
    <section className="modification-comparison" aria-labelledby="modification-options-title">
      <div className="proposal-heading">
        <div>
          <p className="eyebrow">Valid alternatives</p>
          <h2 id="modification-options-title">Compare before proposing</h2>
        </div>
        <span>{result.block.choices.length} validated options</span>
      </div>
      <p>{result.block.emphasis?.summary ?? result.message}</p>
      <div className="alternative-grid">
        {result.block.choices.map((choice) => {
          const stored = choice.proposalId ? proposals[choice.proposalId] : undefined;
          if (!stored || !choice.proposalId) return null;
          const recommended = choice.optionId === recommendedId;
          const delta = stored.preview.budgetDelta.amount;
          return (
            <article className={recommended ? "alternative-card recommended" : "alternative-card"} key={choice.optionId}>
              <div>
                <span>{recommended ? "Recommended" : "Hard-valid"}</span>
                <h3>{alternativeLabel(stored)}</h3>
              </div>
              <dl>
                <div><dt>Trip total</dt><dd>{delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}`}</dd></div>
                <div><dt>Preserved</dt><dd>{stored.preview.preservedSelectionIds.length} selections</dd></div>
                <div><dt>Validation</dt><dd>{stored.preview.validation.valid ? "Passed" : "Blocked"}</dd></div>
              </dl>
              <button type="button" disabled={busy} onClick={() => onSelect(choice.proposalId!)}>
                Review this proposal <ArrowIcon />
              </button>
            </article>
          );
        })}
      </div>
      <small>Opening an option does not change the trip. You will approve its typed proposal separately.</small>
    </section>
  );
}

function Itinerary({ projection }: { projection: TripProjection }) {
  return (
    <section className="itinerary-section" aria-labelledby="itinerary-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Day by day</p>
          <h2 id="itinerary-heading">Connected itinerary</h2>
        </div>
        <span className="validated-badge">✓ Validated</span>
      </div>
      <div className="timeline">
        {projection.itinerary.map((day) => (
          <article className="timeline-day" key={day.date}>
            <div className="day-marker">
              <strong>{day.dayNumber}</strong>
              <i />
            </div>
            <div className="day-content">
              <header>
                <h3>{displayLocation(day.locationId)}</h3>
                <span>{formatDate(day.date)}</span>
              </header>
              <div className="day-events">
                {day.events.map((event) => (
                  <div className={`event-row event-${event.type}`} key={event.id}>
                    <span className="event-type">{event.type.replace("_", " ")}</span>
                    <div>
                      <strong>{event.title}</strong>
                      {event.startAt ? <small>{formatDateTime(event.startAt)}{event.endAt ? ` – ${formatDateTime(event.endAt)}` : ""}</small> : null}
                    </div>
                  </div>
                ))}
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
  activeTab,
  setActiveTab,
  busy,
  onToggleLock,
  onExplain,
}: {
  trip: TripState;
  projection: TripProjection;
  activeTab: ReviewTab;
  setActiveTab(tab: ReviewTab): void;
  busy: boolean;
  onToggleLock(selectionId: string, locked: boolean): void;
  onExplain(selectionId: string, kind: "travel" | "stay" | "activity"): void;
}) {
  const hydrated = new Map(
    projection.hydratedSelections.map((item) => [item.selectionId, item]),
  );
  const tabSelections =
    activeTab === "travel"
      ? trip.selectedTravel
      : activeTab === "stays"
        ? trip.selectedStays
        : trip.selectedActivities;

  return (
    <div className="trip-review">
      <div className="trip-hero">
        <div>
          <span className="plan-status"><i /> Plan ready</span>
          <p className="eyebrow">{trip.route.stops.length > 1 ? "Multi-stop journey" : "Your connected trip"}</p>
          <h1>{displayLocation(trip.request.origin)} <ArrowIcon /> {displayLocation(trip.route.marketId)}</h1>
          <p>{formatDate(trip.request.startDate)} – {formatDate(trip.request.endDate)} · {trip.request.travellers.length} travellers</p>
        </div>
        <div className="hero-stops">
          {trip.route.stops.map((stop, index) => (
            <span key={stop.locationId}>{index + 1}. {displayLocation(stop.locationId)}</span>
          ))}
        </div>
      </div>

      <div className="review-grid">
        <div>
          <nav className="tabs" aria-label="Trip selections">
            {(["travel", "stays", "activities"] as const).map((tab) => {
              const count = tab === "travel" ? trip.selectedTravel.length : tab === "stays" ? trip.selectedStays.length : trip.selectedActivities.length;
              return (
                <button type="button" key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)} <span>{count}</span>
                </button>
              );
            })}
          </nav>
          <div className="entity-list">
            {tabSelections.map((selection) => {
              const item = hydrated.get(selection.id);
              if (!item) return null;
              return (
                <div className="selection-card" key={selection.id}>
                  {activeTab === "travel" ? <TravelCard item={item} /> : null}
                  {activeTab === "stays" ? <StayCard item={item} /> : null}
                  {activeTab === "activities" ? <ActivityCard item={item} /> : null}
                  <SelectionActions
                    locked={selection.locked}
                    busy={busy}
                    onToggleLock={() => onToggleLock(selection.id, selection.locked)}
                    onExplain={() => onExplain(selection.id, selection.kind)}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <BudgetSummary projection={projection} />
      </div>
      <Itinerary projection={projection} />
    </div>
  );
}

function StatusNotice({
  state,
  onRetry,
  onSelectProposal,
  onDismissAdaptiveOutcome,
}: {
  state: typeof initialWorkspaceState;
  onRetry(): void;
  onSelectProposal(proposalId: string): void;
  onDismissAdaptiveOutcome(): void;
}) {
  if (state.error) {
    return (
      <div className="notice notice-error" role="alert">
        <strong>Action paused</strong>
        <p>{state.error.message}</p>
        {state.error.retryable ? <button type="button" onClick={onRetry}>Try again</button> : null}
      </div>
    );
  }
  if (state.latestOutcome?.type === "clarification") {
    return (
      <div className="notice notice-question">
        <span className="notice-icon">?</span>
        <strong>One detail could improve the plan</strong>
        <p>{state.latestOutcome.config.question}</p>
        <small>Update the Trip Brief, or continue without it.</small>
        <button type="button" onClick={onRetry}>Continue planning</button>
      </div>
    );
  }
  if (state.latestOutcome?.type === "conflict") {
    const actions = state.latestOutcome.factBundle?.allowedFollowUpActions ?? [];
    return (
      <div className="notice notice-conflict">
        <strong>Constraints prevent a valid trip</strong>
        <p>{state.latestOutcome.message}</p>
        {state.latestOutcome.validation?.issues.map((issue) => (
          <span key={issue.id}>{issue.message}</span>
        ))}
        {actions.length > 0 ? (
          <div className="conflict-alternatives">
            {actions.slice(0, 3).map((action) => (
              <button
                type="button"
                key={action.id}
                onClick={action.type === "retry" ? onRetry : onDismissAdaptiveOutcome}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
        <small>Your Trip Brief and any previous valid trip are unchanged. Suggested compromises are grounded actions, not automatic changes.</small>
        <button type="button" onClick={onRetry}>Search again</button>
      </div>
    );
  }
  if (state.destinationDiscovery?.type === "conflict") {
    return (
      <div className="notice notice-conflict" role="status">
        <strong>No useful destination comparison yet</strong>
        <p>{state.destinationDiscovery.message}</p>
        <small>
          Valid supported markets found: {state.destinationDiscovery.availableCandidateCount}. Your Trip Brief is unchanged.
        </small>
        <button type="button" onClick={onRetry}>Search again</button>
      </div>
    );
  }
  if (state.modificationConflict) {
    const actions = new Map(
      state.modificationConflict.factBundle.allowedFollowUpActions.map((action) => [action.id, action]),
    );
    return (
      <div className="notice notice-conflict" role="status">
        <strong>Constraints prevent this change</strong>
        <p>{state.modificationConflict.message}</p>
        <div className="conflict-alternatives">
          {state.modificationConflict.block.alternatives.map((alternative) => {
            if (alternative.proposalId) {
              const stored = state.proposals[alternative.proposalId];
              return stored ? (
                <button type="button" key={alternative.id} onClick={() => onSelectProposal(alternative.proposalId!)}>
                  {stored.message}
                </button>
              ) : null;
            }
            const action = alternative.actionId ? actions.get(alternative.actionId) : undefined;
            return action ? (
              <button type="button" key={alternative.id} onClick={onDismissAdaptiveOutcome}>
                {action.label}
              </button>
            ) : null;
          })}
        </div>
        <small>The current trip is unchanged. Any state-changing compromise still requires proposal approval.</small>
      </div>
    );
  }
  return null;
}

export default function TravelWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const [originLabel, setOriginLabel] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [interestText, setInterestText] = useState("");
  const [modificationText, setModificationText] = useState("");
  const [explanationText, setExplanationText] = useState("");
  const [activeTab, setActiveTab] = useState<ReviewTab>("travel");
  const [elapsed, setElapsed] = useState(0);
  const tripIdRef = useRef<string | null>(null);
  const discovering = state.asyncStatus === "discovering";
  const planning = state.asyncStatus === "planning";
  const busy = discovering || planning || state.asyncStatus === "modifying" || state.asyncStatus === "explaining" || state.asyncStatus === "applying";

  useEffect(() => {
    if (!discovering && !planning) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [discovering, planning]);

  function replaceDraft(patch: Partial<TripRequest>) {
    dispatch({
      type: "replace_draft",
      request: { ...state.draftRequest, ...patch },
    });
  }

  function setTravellerCount(count: number) {
    const travellers: Traveller[] = Array.from({ length: count }, (_, index) => ({
      id: `traveller:${index + 1}`,
      type: "adult",
    }));
    replaceDraft({ travellers });
  }

  function setMaximumBudget(raw: string) {
    const withoutBudget = state.draftRequest.constraints.filter(
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
    replaceDraft({ constraints });
  }

  function preparedRequest(): TripRequest {
    return {
      ...state.draftRequest,
      preferences: {
        ...state.draftRequest.preferences,
        interests: interestText
          .split(",")
          .map((value) => value.trim().toLocaleLowerCase("en"))
          .filter(Boolean),
      },
    };
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

  async function executeSpecifiedPlan(request: TripRequest, userText: string) {
    setElapsed(0);
    dispatch({
      type: "planning_started",
      entry: { id: messageId("user"), role: "user", text: userText },
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
      if (body.type === "trip_ready") {
        dispatch({
          type: "planning_succeeded",
          result: body,
          entry: { id: messageId("assistant"), role: "assistant", text: body.message },
        });
        setActiveTab("travel");
      } else {
        dispatch({
          type: "outcome_received",
          outcome: body,
          entry: { id: messageId("assistant"), role: "assistant", text: body.message },
        });
      }
    } catch (error: unknown) {
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
    }
  }

  async function executeDestinationDiscovery(request: TripRequest) {
    setElapsed(0);
    dispatch({
      type: "discovery_started",
      entry: {
        id: messageId("user"),
        role: "user",
        text: `Find grounded destination options from ${originLabel} for ${request.startDate} to ${request.endDate}.`,
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
      dispatch({
        type: "discovery_received",
        result: body,
        entry: { id: messageId("assistant"), role: "assistant", text: body.message },
      });
    } catch (error: unknown) {
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
      dispatch({
        type: "planning_failed",
        error: {
          code: problem.includes("end date") ? "INVALID_DATES" : "INCOMPLETE_BRIEF",
          message: problem,
          retryable: false,
        },
        entry: { id: messageId("assistant"), role: "assistant", text: problem },
      });
      return;
    }

    dispatch({ type: "replace_draft", request });
    if (request.destination?.kind === "open") {
      await executeDestinationDiscovery(request);
      return;
    }
    await executeSpecifiedPlan(
      request,
      `Plan ${originLabel} to ${destinationLabel} from ${request.startDate} to ${request.endDate} for ${request.travellers.length} traveller${request.travellers.length === 1 ? "" : "s"}.`,
    );
  }

  async function selectDestination(option: DestinationOption) {
    if (busy) return;
    const request: TripRequest = {
      ...state.draftRequest,
      destination: { kind: "specified", locationId: option.id },
    };
    setDestinationLabel(option.name);
    dispatch({ type: "destination_selected", request });
    await executeSpecifiedPlan(
      request,
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
  }

  async function submitModification(event?: FormEvent) {
    event?.preventDefault();
    const trip = state.committedTrip;
    const message = modificationText.trim();
    if (!trip || !message || busy) return;
    dispatch({
      type: "modification_started",
      entry: { id: messageId("user"), role: "user", text: message },
    });
    try {
      const response = await fetch("/api/agent/modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, trip }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const error = body as { code?: unknown; message?: unknown; retryable?: unknown };
        throw {
          code: typeof error?.code === "string" ? error.code : "MODIFICATION_FAILED",
          message: typeof error?.message === "string" ? error.message : "The change could not be prepared.",
          retryable: error?.retryable === true,
        };
      }
      if (!isModificationResult(body)) throw new Error("Invalid MODIFY response");
      setModificationText("");
      if (body.type === "proposal") {
        dispatch({
          type: "proposal_received",
          result: body,
          entry: { id: messageId("assistant"), role: "assistant", text: body.message },
        });
      } else if (body.type === "alternatives") {
        dispatch({
          type: "alternatives_received",
          result: body,
          entry: { id: messageId("assistant"), role: "assistant", text: body.message },
        });
      } else {
        dispatch({
          type: "modification_conflict",
          result: body,
          entry: { id: messageId("assistant"), role: "assistant", text: body.message },
        });
      }
    } catch (error: unknown) {
      reportAsyncError(error, "The planner is temporarily unable to prepare this change. Your trip is unchanged.");
    }
  }

  async function submitExplanation(
    eventOrQuestion?: FormEvent | string,
    selectionId?: string,
  ) {
    if (typeof eventOrQuestion !== "string") eventOrQuestion?.preventDefault();
    const trip = state.committedTrip;
    const question =
      typeof eventOrQuestion === "string" ? eventOrQuestion.trim() : explanationText.trim();
    if (!trip || !question || busy) return;
    dispatch({
      type: "explanation_started",
      entry: { id: messageId("user"), role: "user", text: question },
    });
    try {
      const response = await fetch("/api/agent/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, trip, selectionId }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const error = body as { code?: unknown; message?: unknown; retryable?: unknown };
        throw {
          code: typeof error?.code === "string" ? error.code : "EXPLANATION_FAILED",
          message: typeof error?.message === "string" ? error.message : "The trip could not be explained.",
          retryable: error?.retryable === true,
        };
      }
      if (!isExplanationResult(body)) throw new Error("Invalid EXPLAIN response");
      setExplanationText("");
      dispatch({
        type: "explanation_received",
        result: body,
        entry: { id: messageId("assistant"), role: "assistant", text: body.message },
      });
    } catch (error: unknown) {
      reportAsyncError(error, "The planner cannot explain this trip right now. Your trip is unchanged.");
    }
  }

  async function previewLockChange(selectionId: string, currentlyLocked: boolean) {
    const trip = state.committedTrip;
    if (!trip || busy) return;
    const proposal: TripProposal = {
      id: `proposal:${globalThis.crypto.randomUUID()}`,
      baseTripVersion: trip.version,
      operations: [
        { type: "set_selection_lock", selectionId, locked: !currentlyLocked },
      ],
    };
    dispatch({ type: "proposal_preview_started" });
    try {
      const response = await fetch("/api/trip/proposals/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip, proposal }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw body;
      if (!isProposalEvaluation(body)) throw new Error("Invalid proposal preview");
      const message = currentlyLocked
        ? "This proposal unlocks one approved selection. The inventory choice itself remains unchanged."
        : "This proposal locks one selection so later modifications must preserve it.";
      dispatch({
        type: "proposal_previewed",
        stored: { proposal, preview: body.preview, projection: body.projection, message },
        entry: { id: messageId("assistant"), role: "assistant", text: message },
      });
    } catch (error: unknown) {
      reportAsyncError(error, "The lock change could not be previewed. Your trip is unchanged.");
    }
  }

  async function approveProposal(stored: StoredProposal) {
    const trip = state.committedTrip;
    if (!trip || busy) return;
    dispatch({ type: "proposal_apply_started" });
    try {
      const response = await fetch("/api/trip/proposals/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip, proposal: stored.proposal }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw body;
      const result = body as { trip?: unknown; projection?: unknown };
      if (!result.trip || !result.projection) throw new Error("Invalid proposal application");
      dispatch({
        type: "proposal_applied",
        trip: result.trip as TripState,
        projection: result.projection as TripProjection,
        entry: {
          id: messageId("assistant"),
          role: "assistant",
          text: `Applied the approved change. Trip version ${stored.proposal.baseTripVersion + 1} is now current.`,
        },
      });
    } catch (error: unknown) {
      reportAsyncError(error, "The proposal could not be applied. Your current trip is unchanged.");
    }
  }

  const maxBudget = state.draftRequest.constraints.find(
    (constraint) => constraint.category === "budget",
  );
  const maxBudgetAmount =
    maxBudget?.category === "budget" ? maxBudget.value.maxTotal?.amount : undefined;
  const activeProposal = state.activeProposalId
    ? state.proposals[state.activeProposalId]
    : undefined;
  const openDestination = state.draftRequest.destination?.kind === "open";

  return (
    <main className="workspace-shell">
      <header className="app-header">
        <div className="brand-mark"><SparkIcon /></div>
        <div className="brand-copy">
          <strong>wayfinder</strong>
          <span>AI trip workspace</span>
        </div>
        <div className="header-trust">
          <span className="synthetic-badge">Synthetic inventory</span>
          <span className="session-status"><i /> Session workspace</span>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="planner-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Trip brief</p>
              <h1>Where should we go?</h1>
            </div>
            <span className="step-pill">01</span>
          </div>

          <form className="trip-form" onSubmit={submitPlan}>
            <div className="location-pair">
              <LocationField
                id="trip-origin"
                label="From"
                placeholder="Search a city or airport"
                selectedId={state.draftRequest.origin}
                selectedLabel={originLabel}
                onSelectedLabelChange={setOriginLabel}
                onSelect={(location) => replaceDraft({ origin: location?.id })}
              />
              <div className="pair-line"><span /></div>
              <LocationField
                id="trip-destination"
                label="To"
                placeholder="Search a destination"
                selectedId={
                  state.draftRequest.destination?.kind === "specified"
                    ? state.draftRequest.destination.locationId
                    : undefined
                }
                selectedLabel={openDestination ? "Open to recommendations" : destinationLabel}
                disabled={openDestination}
                onSelectedLabelChange={setDestinationLabel}
                onSelect={(location) =>
                  replaceDraft({
                    destination: location
                      ? { kind: "specified", locationId: location.id }
                      : undefined,
                  })
                }
              />
            </div>
            <button
              className={openDestination ? "open-destination-button active" : "open-destination-button"}
              type="button"
              onClick={() => {
                setDestinationLabel("");
                replaceDraft({ destination: openDestination ? undefined : { kind: "open" } });
              }}
            >
              <SparkIcon />
              {openDestination ? "Agent will compare supported destinations" : "Not sure where? Help me choose"}
            </button>

            <div className="form-grid two-col">
              <div className="field">
                <label htmlFor="start-date">Start</label>
                <input id="start-date" type="date" min="2026-09-01" max="2027-03-30" value={state.draftRequest.startDate ?? ""} onChange={(event) => replaceDraft({ startDate: event.target.value || undefined })} />
              </div>
              <div className="field">
                <label htmlFor="end-date">End</label>
                <input id="end-date" type="date" min="2026-09-02" max="2027-03-31" value={state.draftRequest.endDate ?? ""} onChange={(event) => replaceDraft({ endDate: event.target.value || undefined })} />
              </div>
            </div>

            <div className="form-grid two-col">
              <div className="field">
                <label htmlFor="travellers">Travellers</label>
                <select id="travellers" value={state.draftRequest.travellers.length} onChange={(event) => setTravellerCount(Number(event.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} adult{count === 1 ? "" : "s"}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pace">Pace</label>
                <select id="pace" value={state.draftRequest.preferences.pace ?? "balanced"} onChange={(event) => replaceDraft({ preferences: { ...state.draftRequest.preferences, pace: event.target.value as "relaxed" | "balanced" | "packed" } })}>
                  <option value="relaxed">Relaxed</option>
                  <option value="balanced">Balanced</option>
                  <option value="packed">Packed</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="interests">Interests <span>optional</span></label>
              <input id="interests" value={interestText} placeholder="heritage, food, outdoors" onChange={(event) => setInterestText(event.target.value)} />
              <small>Separate interests with commas</small>
            </div>

            <div className="field">
              <label htmlFor="budget">Maximum budget <span>optional</span></label>
              <div className="money-input"><span>₹</span><input id="budget" type="number" min="1" step="1" value={maxBudgetAmount ?? ""} placeholder="e.g. 60000" onChange={(event) => setMaximumBudget(event.target.value)} /></div>
            </div>

            <BriefSummary request={state.draftRequest} />
            <button className="primary-button" type="submit" disabled={busy}>
              <SparkIcon />
              {discovering
                ? "Comparing destinations…"
                : planning
                  ? "Planning your trip…"
                  : openDestination
                    ? "Find destination options"
                    : state.committedTrip
                      ? "Plan again"
                      : "Build my trip"}
              <ArrowIcon />
            </button>
            <p className="form-disclosure">Uses seeded, synthetic inventory. No booking or payment.</p>
          </form>

          {state.committedTrip ? (
            <form className="modify-form explain-form" onSubmit={submitExplanation}>
              <div className="modify-heading">
                <div>
                  <p className="eyebrow">Understand this trip</p>
                  <h2>Ask for grounded context</h2>
                </div>
                <span>?</span>
              </div>
              <label htmlFor="explanation-request">What would you like explained?</label>
              <textarea
                id="explanation-request"
                rows={2}
                value={explanationText}
                placeholder="Why does this route split the nights this way?"
                onChange={(event) => setExplanationText(event.target.value)}
              />
              <button type="submit" disabled={busy || explanationText.trim().length === 0}>
                <SparkIcon />
                {state.asyncStatus === "explaining" ? "Checking grounded facts…" : "Explain this trip"}
              </button>
              <small>Uses current trip facts only. Explanation never changes your trip.</small>
            </form>
          ) : null}

          {state.committedTrip ? (
            <form className="modify-form" onSubmit={submitModification}>
              <div className="modify-heading">
                <div>
                  <p className="eyebrow">Modify this trip</p>
                  <h2>Ask for a scoped change</h2>
                </div>
                <span>AI</span>
              </div>
              <label htmlFor="modification-request">What should change?</label>
              <textarea
                id="modification-request"
                rows={3}
                value={modificationText}
                placeholder="Find a cheaper stay, but preserve my flights"
                onChange={(event) => setModificationText(event.target.value)}
              />
              <button type="submit" disabled={busy || modificationText.trim().length === 0}>
                <SparkIcon />
                {state.asyncStatus === "modifying" ? "Preparing proposal…" : "Propose change"}
              </button>
              <small>The agent proposes. You approve before canonical state changes.</small>
            </form>
          ) : null}

          <StatusNotice
            state={state}
            onSelectProposal={(proposalId) =>
              dispatch({ type: "alternative_selected", proposalId })
            }
            onDismissAdaptiveOutcome={() =>
              dispatch({ type: "adaptive_outcome_dismissed" })
            }
            onRetry={() =>
              void (activeProposal
                ? approveProposal(activeProposal)
                : state.committedTrip && modificationText.trim()
                  ? submitModification()
                  : submitPlan())
            }
          />

          <section className="conversation" aria-label="Planning conversation">
            <div className="conversation-title"><span>Planning log</span><small>{state.conversation.length} messages</small></div>
            {state.conversation.slice(-4).map((entry) => (
              <div className={`message message-${entry.role}`} key={entry.id}>
                {entry.role === "assistant" ? <span className="message-avatar"><SparkIcon /></span> : null}
                <p>{entry.text}</p>
              </div>
            ))}
          </section>
        </aside>

        <section className="workspace-main">
          {discovering || planning ? (
            <PlanningState elapsed={elapsed} mode={discovering ? "discovering" : "planning"} />
          ) : state.destinationDiscovery?.type === "destination_options" ? (
            <DestinationComparison
              result={state.destinationDiscovery}
              busy={busy}
              onSelect={(option) => void selectDestination(option)}
            />
          ) : state.committedTrip && state.projection ? (
            <>
              {state.modificationAlternatives ? (
                <ModificationOptionComparison
                  result={state.modificationAlternatives}
                  proposals={state.proposals}
                  busy={busy}
                  onSelect={(proposalId) =>
                    dispatch({ type: "alternative_selected", proposalId })
                  }
                />
              ) : null}
              {activeProposal ? (
                <ChangeProposal
                  stored={activeProposal}
                  applying={state.asyncStatus === "applying"}
                  onApprove={() => void approveProposal(activeProposal)}
                  onDismiss={() =>
                    dispatch({
                      type: "proposal_dismissed",
                      proposalId: activeProposal.proposal.id,
                    })
                  }
                />
              ) : null}
              <TripReview
                trip={state.committedTrip}
                projection={state.projection}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                busy={busy}
                onToggleLock={(selectionId, locked) =>
                  void previewLockChange(selectionId, locked)
                }
                onExplain={(selectionId, kind) =>
                  void submitExplanation(
                    `Why was this ${kind} selection included, and how does it fit the current trip?`,
                    selectionId,
                  )
                }
              />
            </>
          ) : (
            <EmptyWorkspace />
          )}
        </section>
      </div>
    </main>
  );
}
