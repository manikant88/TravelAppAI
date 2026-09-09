'use client';
import Image from 'next/image';
import { useId, useState } from 'react';
import type { LivePlace } from '@/live/contracts';
import { Badge, Button, TextInput } from '@/ui/components/primitives';
import { AppIcon } from '@/ui/components/app-icon';
import { PlaceCardFrame } from '@/ui/patterns/place-card-frame';

function money(value: number, currency = 'INR') {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${value}`; }
}
export function LivePlaceCard({ place, kind, heading, subtitle, secondaryDetails = [], selected = false, estimate = '', onEstimate, locked = false, onLock, onChange, onSelect, selectionBusy = false, decisionNote }: {
  place: LivePlace; kind: 'hotel' | 'activity' | 'meal'; heading: string; subtitle?: string;
  secondaryDetails?: string[];
  selected?: boolean; estimate?: string; onEstimate?(value: string): void;
  locked?: boolean; onLock?(): void; onChange?(): void; onSelect?(): void; selectionBusy?: boolean;
  decisionNote?: string;
}) {
  const [failedImage, setFailedImage] = useState<string>();
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const inputId = useId();
  const photo = place.photo;
  const unit = kind === 'hotel' ? 'room / night' : kind === 'meal' ? 'person / meal' : 'person / visit';
  const stayOffer = kind === 'hotel' ? place.stayOffer : undefined;
  const stayNights = stayOffer ? Math.round((Date.parse(`${stayOffer.checkOut}T00:00:00Z`) - Date.parse(`${stayOffer.checkIn}T00:00:00Z`)) / 86_400_000) : 0;
  const price = place.priceGuidance;
  const amenities = place.amenities ?? [];
  const visibleAmenities = showAllAmenities ? amenities : amenities.slice(0, 5);
  const guidance = price && (price.min !== undefined || price.max !== undefined)
    ? price.min !== undefined && price.max !== undefined ? `${money(price.min, price.currency)}–${money(price.max, price.currency)}` : price.min !== undefined ? `From ${money(price.min, price.currency)}` : `Up to ${money(price.max!, price.currency)}`
    : undefined;
  const actions = onLock || onChange || onSelect ? <>{onLock && <Button variant="text" size="sm" aria-pressed={locked} disabled={selectionBusy} onClick={onLock}>{locked ? 'Unlock' : 'Lock'}</Button>}{onLock && (onChange || onSelect) && <span aria-hidden="true">·</span>}{onChange && <Button variant="text" size="sm" onClick={onChange} disabled={selectionBusy || locked}>Change</Button>}{onSelect && <Button size="sm" onClick={onSelect} disabled={selectionBusy}>Select {kind === 'hotel' ? 'stay' : kind}</Button>}</> : undefined;
  return <PlaceCardFrame kind={kind} heading={heading} actions={actions} className={`live-place-card ${selected ? 'is-suggested' : ''}`}>
    <div className={kind === 'hotel' ? 'hotel-card-body' : 'activity-card-body'}>
      <figure className="live-place-media">
        <div className="live-photo">
          {photo && failedImage !== photo.url ? <Image src={photo.url} alt={place.name} width={640} height={400} unoptimized onError={() => setFailedImage(photo.url)} /> : <div className="live-photo-empty"><AppIcon name={kind} size={30} /><span>Photo unavailable</span></div>}
          {selected && <Badge tone="info">{kind === 'hotel' ? 'Suggested stay' : kind === 'meal' ? 'Selected restaurant' : 'Selected activity'}</Badge>}
        </div>
        {photo && failedImage !== photo.url && photo.authors.length > 0 && <figcaption>Photo: {photo.authors.map((a, i) => <span key={`${a.name}-${i}`}>{i > 0 ? ', ' : ''}{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a> : a.name}</span>)}</figcaption>}
      </figure>
      <div className="hotel-details">
        {(place.rating !== undefined || stayOffer?.propertyFacts.starRating !== undefined) && <div className="hotel-rating">
          <strong>{place.rating !== undefined ? place.rating.toFixed(1) : `${stayOffer!.propertyFacts.starRating}★`}</strong>
          <span><AppIcon name="star" size={13} /> {place.rating !== undefined ? 'Guest rating' : 'Hotel classification'}</span>
          {stayOffer?.propertyFacts.starRating !== undefined && place.rating !== undefined && <small>{stayOffer.propertyFacts.starRating}-star hotel</small>}
          {place.reviewCount !== undefined && <small>({place.reviewCount.toLocaleString()} reviews)</small>}
        </div>}
        <h3>{place.name}</h3>
        <p className="live-card-address"><AppIcon name="map-pin" size={14} /> {place.address}</p>
        {subtitle && <p>{subtitle}</p>}
        {!!secondaryDetails.length && <details className="live-card-details"><summary>Timing and visit details</summary><ul>{secondaryDetails.map(detail => <li key={detail}>{detail}</li>)}</ul></details>}
        <div className="card-price">
          <strong>{stayOffer?.totalPrice ? money(stayOffer.totalPrice.amount, stayOffer.totalPrice.currency) : estimate !== '' ? money(Number(estimate)) : guidance ?? 'Price not provided'}</strong>
          <span>{stayOffer?.totalPrice
            ? `Total for ${stayOffer.rooms} room${stayOffer.rooms === 1 ? '' : 's'} · ${stayNights} night${stayNights === 1 ? '' : 's'} · ${money(stayOffer.price.amount)} average per room/night`
            : estimate !== '' ? `/ ${unit} · your estimate` : guidance ? `Google Maps general price range · not a ${kind === 'hotel' ? 'dated room offer' : kind === 'meal' ? 'menu quote' : 'date-specific ticket'}` : kind === 'hotel' ? 'Google Places returned no dated room quote' : kind === 'meal' ? 'Google Places returned no verified meal price' : 'Google Places returned no verified entry fee'}</span>
        </div>
        {stayOffer && <p className="live-price-guidance">{stayOffer.roomFacts.roomLabel} · {stayOffer.roomFacts.mealPlan === 'breakfast' ? 'Breakfast included' : 'Room only'}<small>{stayOffer.cancellationTerms?.summary ?? 'Cancellation terms will be checked before booking.'}</small></p>}
        {!guidance && place.priceLevel && place.priceLevel !== 'PRICE_LEVEL_UNSPECIFIED' && <p className="live-price-guidance">Google price category: {place.priceLevel.replace('PRICE_LEVEL_', '').toLowerCase().replaceAll('_', ' ')}<small>General guidance, not a booking price.</small></p>}
        {!stayOffer && onEstimate && <details className="live-estimate"><summary>{estimate === '' ? 'Add a planning estimate' : 'Edit your planning estimate'}</summary><label htmlFor={inputId}>Your estimate · INR per {unit}</label><TextInput id={inputId} type="number" inputMode="decimal" min="0" max="1000000" step="1" placeholder="Enter amount" value={estimate} onChange={e => { const v = e.target.value; if (v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1000000)) onEstimate(v); }} /><small>For budgeting only. Not a supplier price; excluded from verified totals.</small></details>}
      </div>
    </div>
    {decisionNote && <div className="card-grounding"><i aria-hidden="true"><AppIcon name="sparkles" size={17} /></i><div><span>{decisionNote}</span></div></div>}
    <footer className="live-card-footer">
      {(place.editorialSummary || place.amenities?.length) && <section className="live-place-about" aria-label={`About ${place.name}`}>
        <strong>About this place</strong>
        {place.editorialSummary && <p>{place.editorialSummary}</p>}
        {!!amenities.length && <><ul>{visibleAmenities.map(amenity => <li key={amenity}><AppIcon name="check" size={13} /> {amenity}</li>)}</ul>{amenities.length > 5 && <Button className="live-about-toggle" variant="text" size="sm" aria-expanded={showAllAmenities} onClick={() => setShowAllAmenities(value => !value)}>{showAllAmenities ? 'Show less' : `Show ${amenities.length - 5} more`}</Button>}</>}
      </section>}
      <div className="live-card-meta-row">
        <div className="live-card-source-note">
          <span>{stayOffer ? `${stayOffer.source.evidenceKind === 'sandbox' ? 'Sandbox offer' : 'Dated offer'} · checked ${new Date(stayOffer.source.checkedAt!).toLocaleString()}` : kind === 'hotel' ? 'Stay details are provisional' : kind === 'meal' ? 'Menu and dietary details need confirmation' : 'Visit duration is estimated'} · verify before booking.</span>
          {place.attributions.map(a => <small key={a.name}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a> : a.name}</small>)}
        </div>
        <div className="live-card-links">
          {place.websiteUrl && <a href={place.websiteUrl} target="_blank" rel="noreferrer">Official website</a>}
          <a href={place.mapsUrl} target="_blank" rel="noreferrer">View on Google Maps <AppIcon name="arrow-right" size={13} /></a>
        </div>
      </div>
    </footer>
  </PlaceCardFrame>;
}
