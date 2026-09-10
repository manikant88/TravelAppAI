import { AppIcon } from './components/app-icon';
import { Button } from './components/primitives';

export function itineraryGridClass(mapVisible: boolean) {
  return `live-content-grid${mapVisible ? '' : ' is-map-hidden'}`;
}

export function MapVisibilityToggle({ visible, onToggle }: { visible: boolean; onToggle(): void }) {
  return <Button className="live-map-toggle" variant="text" size="sm" aria-pressed={visible} onClick={onToggle}>
    <AppIcon name="map-pin" size={15} /> {visible ? 'Hide map' : 'Show map'}
  </Button>;
}
