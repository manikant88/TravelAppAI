import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LiveRoadJourneySegment } from '@/live/contracts';
import { LiveRoadJourneyDay } from '@/ui/live-travel-routes';

describe('road journey day timeline', () => {
  it('shows driving, meal and rest stops for the actual travel day', () => {
    const segment: LiveRoadJourneySegment = {
      dayOffset: 0,
      date: '2026-10-10',
      driveMinutes: 600,
      breakMinutes: 85,
      mealBreaks: ['lunch'],
      departureMinutes: 480,
      arrivalMinutes: 1165,
      overnightRestMinutes: 720,
      breakStops: [
        { type: 'rest', startMinutes: 630, durationMinutes: 20 },
        { type: 'lunch', startMinutes: 780, durationMinutes: 45, routePoint: { lat: 27.1, lng: 78.1 }, place: { id: 'road-restaurant', name: 'Highway Dhaba', address: 'Grand Trunk Road', lat: 27.1, lng: 78.1, source: 'Google Maps', checkedAt: '2026-09-11T00:00:00Z', mapsUrl: 'https://maps.google.com', attributions: [] } },
        { type: 'rest', startMinutes: 975, durationMinutes: 20 },
      ],
      transitStay: { id: 'rest-hotel', name: 'Roadside Inn', address: 'Siliguri', lat: 26.7, lng: 88.4, source: 'Google Maps', checkedAt: '2026-09-11T00:00:00Z', mapsUrl: 'https://maps.google.com', attributions: [] },
    };
    const markup = renderToStaticMarkup(<LiveRoadJourneyDay segment={segment} destination="Darjeeling" direction="outbound" finalDay={false} />);
    expect(markup).toContain('Drive toward Darjeeling');
    expect(markup).toContain('Highway Dhaba');
    expect(markup).toContain('Road rest break');
    expect(markup).toContain('Overnight rest at Roadside Inn');
    expect(markup).toContain('data-focus="road:outbound:0:stop:1"');
    expect(markup).toContain('live-timeline-event');
    expect(markup).not.toContain('Return to stay');
  });
});
