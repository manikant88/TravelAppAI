import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LiveDay, LivePlace } from '@/live/contracts';
import { DayTimeline } from '@/ui/live-workspace';

const restaurant: LivePlace = {
  id: 'restaurant-a',
  name: 'Jaipur Dining House',
  address: 'Jaipur',
  lat: 26.9,
  lng: 75.8,
  source: 'Google Maps',
  checkedAt: '2026-09-10T00:00:00Z',
  mapsUrl: 'https://maps.google.com/',
  attributions: [],
};

function day(): LiveDay {
  return {
    date: '2027-09-08',
    visits: [],
    meals: [{ type: 'lunch', place: restaurant, durationMinutes: 60, targetStartMinutes: 780, location: 'restaurant', dietaryNote: 'Menu fit needs confirmation.' }],
    legs: [],
  };
}

describe('live meal timeline actions', () => {
  it('renders Lock and Change controls for a selected meal slot', () => {
    const markup = renderToStaticMarkup(<DayTimeline day={day()} dayIndex={0} first={false} last={false} startMinutes={480} hasOutboundTravel={false} hasReturnTravel={false} estimates={{}} busy={false} lockedActivityIds={[]} lockedMealKeys={[]} onEstimate={vi.fn()} onLockActivity={vi.fn()} onChangeActivity={vi.fn()} onLockMeal={vi.fn()} onChangeMeal={vi.fn()} />);
    expect(markup).toContain('Jaipur Dining House');
    expect(markup).toContain('>Lock</button>');
    expect(markup).toContain('>Change</button>');
  });

  it('renders Unlock and disables Change when the meal slot is locked', () => {
    const markup = renderToStaticMarkup(<DayTimeline day={day()} dayIndex={0} first={false} last={false} startMinutes={480} hasOutboundTravel={false} hasReturnTravel={false} estimates={{}} busy={false} lockedActivityIds={[]} lockedMealKeys={['0:lunch']} onEstimate={vi.fn()} onLockActivity={vi.fn()} onChangeActivity={vi.fn()} onLockMeal={vi.fn()} onChangeMeal={vi.fn()} />);
    expect(markup).toContain('>Unlock</button>');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Change<\/button>/);
  });
});
