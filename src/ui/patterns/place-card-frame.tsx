import type { ReactNode } from 'react';
import { Card } from '@/ui/components/primitives';
import { AppIcon } from '@/ui/components/app-icon';

/** Shared visual frame for both inventory offers and live place observations. */
export function PlaceCardFrame({ kind, heading, actions, children, className = '' }: {
  kind: 'hotel' | 'activity' | 'meal'; heading: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return <Card className={`itinerary-card itinerary-${kind}-card ${className}`}>
    <header className="itinerary-card-header"><span className="card-kind-icon" aria-hidden="true"><AppIcon name={kind} /></span><strong>{heading}</strong>{actions && <div className="live-card-actions">{actions}</div>}</header>
    {children}
  </Card>;
}
