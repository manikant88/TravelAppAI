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
  type ConversationEntry,
} from "@/state";

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

interface LocationFieldProps {
  id: string;
  label: string;
  placeholder: string;
  selectedId?: string;
  selectedLabel: string;
  onSelectedLabelChange(value: string): void;
  onSelect(location?: LocationSearchResult): void;
}

function LocationField({
  id,
  label,
  placeholder,
  selectedId,
  selectedLabel,
  onSelectedLabelChange,
  onSelect,
}: LocationFieldProps) {
  const [options, setOptions] = useState<LocationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = selectedLabel.trim();
    if (selectedId || query.length < 2) return;
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
  }, [selectedId, selectedLabel]);

  return (
    <div className="field location-field">
      <label>{label}</label>
      <div className="location-input-wrap">
        <span className="field-icon" aria-hidden="true">
          <PinIcon />
        </span>
        <input
          id={id}
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

function PlanningState({ elapsed }: { elapsed: number }) {
  return (
    <div className="planning-state" role="status" aria-live="polite">
      <div className="planner-orbit" aria-hidden="true">
        <span />
        <SparkIcon />
      </div>
      <p className="eyebrow">Planning with grounded inventory</p>
      <h2>Building a trip that connects</h2>
      <p>
        The planner is gathering valid options, comparing trade-offs, assembling the route, and
        checking the complete trip before showing it.
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
}: {
  trip: TripState;
  projection: TripProjection;
  activeTab: ReviewTab;
  setActiveTab(tab: ReviewTab): void;
}) {
  const hydrated = new Map(
    projection.hydratedSelections.map((item) => [item.selectionId, item]),
  );
  const tabItems =
    activeTab === "travel"
      ? trip.selectedTravel.map((selection) => hydrated.get(selection.id)).filter(Boolean)
      : activeTab === "stays"
        ? trip.selectedStays.map((selection) => hydrated.get(selection.id)).filter(Boolean)
        : trip.selectedActivities.map((selection) => hydrated.get(selection.id)).filter(Boolean);

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
            {tabItems.map((item) => {
              if (!item) return null;
              if (activeTab === "travel") return <TravelCard key={item.selectionId} item={item} />;
              if (activeTab === "stays") return <StayCard key={item.selectionId} item={item} />;
              return <ActivityCard key={item.selectionId} item={item} />;
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
}: {
  state: typeof initialWorkspaceState;
  onRetry(): void;
}) {
  if (state.error) {
    return (
      <div className="notice notice-error" role="alert">
        <strong>Planning paused</strong>
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
    return (
      <div className="notice notice-conflict">
        <strong>No valid trip yet</strong>
        <p>{state.latestOutcome.message}</p>
        {state.latestOutcome.validation?.issues.map((issue) => (
          <span key={issue.id}>{issue.message}</span>
        ))}
        <small>Your Trip Brief and any previous valid trip are unchanged.</small>
        <button type="button" onClick={onRetry}>Search again</button>
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
  const [activeTab, setActiveTab] = useState<ReviewTab>("travel");
  const [elapsed, setElapsed] = useState(0);
  const tripIdRef = useRef<string | null>(null);
  const planning = state.asyncStatus === "planning";

  useEffect(() => {
    if (!planning) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [planning]);

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

  async function submitPlan(event?: FormEvent) {
    event?.preventDefault();
    if (planning) return;
    const request = {
      ...state.draftRequest,
      preferences: {
        ...state.draftRequest.preferences,
        interests: interestText
          .split(",")
          .map((value) => value.trim().toLocaleLowerCase("en"))
          .filter(Boolean),
      },
    };
    const missing = [
      !request.origin ? "origin" : undefined,
      !request.destination ? "destination" : undefined,
      !request.startDate || !request.endDate ? "dates" : undefined,
      request.travellers.length === 0 ? "travellers" : undefined,
    ].filter(Boolean);
    if (missing.length > 0) {
      const text = `Add ${missing.join(", ")} before planning.`;
      dispatch({
        type: "planning_failed",
        error: { code: "INCOMPLETE_BRIEF", message: text, retryable: false },
        entry: { id: messageId("assistant"), role: "assistant", text },
      });
      return;
    }
    if (request.startDate && request.endDate && request.endDate <= request.startDate) {
      const text = "The trip end date must be after the start date.";
      dispatch({
        type: "planning_failed",
        error: { code: "INVALID_DATES", message: text, retryable: false },
        entry: { id: messageId("assistant"), role: "assistant", text },
      });
      return;
    }

    setElapsed(0);
    dispatch({ type: "replace_draft", request });
    const userEntry: ConversationEntry = {
      id: messageId("user"),
      role: "user",
      text: `Plan ${originLabel} to ${destinationLabel} from ${request.startDate} to ${request.endDate} for ${request.travellers.length} traveller${request.travellers.length === 1 ? "" : "s"}.`,
    };
    dispatch({ type: "planning_started", entry: userEntry });
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

  const maxBudget = state.draftRequest.constraints.find(
    (constraint) => constraint.category === "budget",
  );
  const maxBudgetAmount =
    maxBudget?.category === "budget" ? maxBudget.value.maxTotal?.amount : undefined;

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
                selectedLabel={destinationLabel}
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
            <button className="primary-button" type="submit" disabled={planning}>
              <SparkIcon />
              {planning ? "Planning your trip…" : state.committedTrip ? "Plan again" : "Build my trip"}
              <ArrowIcon />
            </button>
            <p className="form-disclosure">Uses seeded, synthetic inventory. No booking or payment.</p>
          </form>

          <StatusNotice state={state} onRetry={() => void submitPlan()} />

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
          {planning ? (
            <PlanningState elapsed={elapsed} />
          ) : state.committedTrip && state.projection ? (
            <TripReview trip={state.committedTrip} projection={state.projection} activeTab={activeTab} setActiveTab={setActiveTab} />
          ) : (
            <EmptyWorkspace />
          )}
        </section>
      </div>
    </main>
  );
}
