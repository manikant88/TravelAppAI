import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { itineraryGridClass, MapVisibilityToggle } from '@/ui/map-visibility-toggle';

describe('live itinerary map visibility', () => {
  it('offers to hide the visible map and keeps the regular grid', () => {
    const markup = renderToStaticMarkup(<MapVisibilityToggle visible onToggle={vi.fn()} />);
    expect(markup).toContain('Hide map');
    expect(markup).toContain('aria-pressed="true"');
    expect(itineraryGridClass(true)).toBe('live-content-grid');
  });

  it('offers to restore a hidden map and selects the centered layout', () => {
    const markup = renderToStaticMarkup(<MapVisibilityToggle visible={false} onToggle={vi.fn()} />);
    expect(markup).toContain('Show map');
    expect(markup).toContain('aria-pressed="false"');
    expect(itineraryGridClass(false)).toBe('live-content-grid is-map-hidden');
  });
});
