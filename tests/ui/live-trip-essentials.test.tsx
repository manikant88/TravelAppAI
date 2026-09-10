import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyLiveBrief, type LiveBrief } from '@/live/contracts';
import { LiveTripBriefBar, LiveTripEssentials } from '@/ui/live-trip-essentials';

const waitingForTravel: LiveBrief = {
  ...emptyLiveBrief,
  origin: 'Delhi',
  destination: 'Darjeeling',
  startDate: '2026-10-10',
  days: 4,
  travellers: 2,
  nightsConfirmed: true,
  pace: 'relaxed',
  preferences: 'hills, tea, heritage',
};

describe('live Trip Essentials', () => {
  it('renders only pending requirements', () => {
    const markup = renderToStaticMarkup(<LiveTripEssentials brief={waitingForTravel} busy={false} onEdit={vi.fn()} onSubmit={vi.fn()} />);
    expect(markup).toContain('Travel preference');
    expect(markup).not.toContain('Starting city');
    expect(markup).not.toContain('Destination or recommendations');
    expect(markup).not.toContain('Travel dates and hotel nights');
    expect(markup).not.toContain('Traveller details');
  });

  it('highlights Preferences when travel is still pending', () => {
    const markup = renderToStaticMarkup(<LiveTripBriefBar brief={waitingForTravel} busy={false} onEditingChange={vi.fn()} onSubmit={vi.fn()} onPrefill={vi.fn()} />);
    expect(markup).toMatch(/class="trip-fact trip-fact-empty essential-missing"[^>]*><span>Preferences<\/span>/);
    expect(markup).not.toMatch(/essential-missing[^>]*><span>From city<\/span>/);
  });

  it('keeps Preferences highlighted when a cab pickup point is pending', () => {
    const markup = renderToStaticMarkup(<LiveTripBriefBar brief={{ ...waitingForTravel, travelMode: 'cab' }} busy={false} onEditingChange={vi.fn()} onSubmit={vi.fn()} onPrefill={vi.fn()} />);
    expect(markup).toMatch(/class="trip-fact trip-fact-empty essential-missing"[^>]*><span>Preferences<\/span>/);
  });
});
