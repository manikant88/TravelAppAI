'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveDay, LiveFlightJourney, LivePlace, LiveTravel, LiveTravelOption } from '@/live/contracts';
import { dayStops } from '@/live/timeline';
type Point = { lat: number; lng: number };
type MapInstance = { fitBounds(bounds: unknown): void; setCenter(point: Point): void; getCenter(): { lat(): number; lng(): number } | undefined };
type MarkerInstance = { map: MapInstance | null };
type LineInstance = { setMap(map: MapInstance | null): void; setOptions(options: object): void };
type GoogleMaps = { Map: new (element: HTMLElement, options: object) => MapInstance; LatLngBounds: new () => { extend(point: Point): void }; Polyline: new (options: object) => LineInstance; marker: { AdvancedMarkerElement: new (options: object) => MarkerInstance } };
declare global { interface Window { google?: { maps: GoogleMaps }; initTravelMap?: () => void; gm_authFailure?: () => void } }
let loading: Promise<GoogleMaps> | undefined;
function loadMaps() {
  if (window.google?.maps.marker) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) { reject(new Error('Browser map key is missing.')); return; }
    const timer = setTimeout(() => reject(new Error('Map loading timed out. Check your browser key and website restriction.')), 20000);
    window.initTravelMap = () => { clearTimeout(timer); if (window.google) resolve(window.google.maps); };
    window.gm_authFailure = () => { window.dispatchEvent(new Event('travel-map-auth-error')); clearTimeout(timer); reject(new Error('Google rejected the browser key. Check Maps JavaScript API and localhost restrictions.')); };
    const script = document.createElement('script'); script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=marker&callback=initTravelMap&v=weekly`; script.async = true;
    script.onerror = () => { clearTimeout(timer); reject(new Error('Google map could not load.')); }; document.head.appendChild(script);
  });
  return loading;
}
function suggested(travel: LiveTravel | undefined, direction: 'outbound' | 'return') {
  if (!travel) return undefined; const id = direction === 'outbound' ? travel.suggestedOutboundId : travel.suggestedReturnId;
  return (direction === 'outbound' ? travel.outbound : travel.return).find(option => option.id === id);
}
type FocusView = { places: LivePlace[]; route?: LiveTravelOption; line?: Point[]; caption: string; activeId?: string };
function getFlightView(flight: LiveFlightJourney | undefined, focus: string): FocusView | undefined {
  if (!flight) return undefined; const outbound = focus.startsWith('flight:outbound'); const returning = focus.startsWith('flight:return');
  if (!outbound && !returning) return undefined;
  if (focus.endsWith('-first')) {
    const places = outbound ? [flight.origin, flight.originAirport] : [flight.destination, flight.destinationAirport]; const route = outbound ? flight.outboundFirstMile : flight.returnFirstMile;
    return { places, route, caption: `${places[0].name} to ${places[1].name}${route ? ` · ${route.minutes} min drive` : ''}`, activeId: places[1].id };
  }
  if (focus.endsWith('-last')) {
    const places = outbound ? [flight.destinationAirport, flight.destination] : [flight.originAirport, flight.origin]; const route = outbound ? flight.outboundLastMile : flight.returnLastMile;
    return { places, route, caption: `${places[0].name} to ${places[1].name}${route ? ` · ${route.minutes} min drive` : ''}`, activeId: places[1].id };
  }
  const places = outbound ? [flight.originAirport, flight.destinationAirport] : [flight.destinationAirport, flight.originAirport];
  return { places, line: places.map(({ lat, lng }) => ({ lat, lng })), caption: `${places[0].airportCode} to ${places[1].airportCode} · flight`, activeId: places[1].id };
}
export function LiveMap({ hotel, day, travel, flight, focus = 'hotel', follow = true }: { hotel?: LivePlace; day?: LiveDay; travel?: LiveTravel; flight?: LiveFlightJourney; focus?: string; follow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const [error, setError] = useState(''); const [runtime, setRuntime] = useState<{ maps: GoogleMaps; map: MapInstance }>();
  const overlays = useRef<{ lines: { line: LineInstance; id: string }[]; pins: { element: HTMLElement; id: string }[] }>({ lines: [], pins: [] });
  const travelDirection = focus === 'travel:outbound' ? 'outbound' : focus === 'travel:return' ? 'return' : undefined;
  const flightView = useMemo(() => getFlightView(flight, focus), [flight, focus]);
  useEffect(() => {
    const authError = () => setError('Google rejected the browser key. Check Maps JavaScript API and localhost restrictions.'); window.addEventListener('travel-map-auth-error', authError); let cancelled = false;
    loadMaps().then(maps => { if (!cancelled && ref.current) setRuntime({ maps, map: new maps.Map(ref.current, { center: { lat: 20, lng: 78 }, zoom: 12, mapId: 'DEMO_MAP_ID', streetViewControl: false, mapTypeControl: false }) }); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; window.removeEventListener('travel-map-auth-error', authError); };
  }, []);
  useEffect(() => {
    if (!runtime) return; const { maps, map } = runtime; const markers: MarkerInstance[] = []; const route = travelDirection ? suggested(travel, travelDirection) : undefined;
    const from = travelDirection === 'return' ? travel?.destination : travel?.origin; const to = travelDirection === 'return' ? travel?.origin : travel?.destination;
    const rawPlaces = flightView?.places ?? (travelDirection ? [from, to].filter((place): place is LivePlace => Boolean(place)) : [...(hotel ? [hotel] : []), ...(day ? dayStops(day).map(stop => stop.place) : [])]);
    const places = [...new Map(rawPlaces.map(place => [place.id, place])).values()];
    const bounds = new maps.LatLngBounds(); overlays.current = { lines: [], pins: [] };
    places.forEach((place, index) => { bounds.extend(place); const element = document.createElement('div'); element.className = 'live-map-pin'; element.textContent = place.airportCode ?? (place.id === hotel?.id ? 'H' : String(index + 1)); markers.push(new maps.marker.AdvancedMarkerElement({ map, position: place, title: place.name, content: element })); overlays.current.pins.push({ element, id: place.id }); });
    const highlightedPath = flightView?.route?.path.length ? flightView.route.path : flightView?.line ?? route?.path;
    if (highlightedPath?.length) overlays.current.lines.push({ id: focus, line: new maps.Polyline({ map, path: highlightedPath, strokeColor: '#0878d1', strokeOpacity: 1, strokeWeight: 6 }) });
    if (!travelDirection && !flightView) day?.legs.forEach((leg, index) => { if (leg.path.length) overlays.current.lines.push({ id: `leg:${index}`, line: new maps.Polyline({ map, path: leg.path, strokeColor: '#0878d1', strokeOpacity: 0.35, strokeWeight: 4 }) }); });
    if (places.length) map.fitBounds(bounds); const lines = overlays.current.lines; return () => { markers.forEach(marker => { marker.map = null; }); lines.forEach(({ line }) => line.setMap(null)); };
  }, [runtime, hotel, day, travel, travelDirection, flightView, focus]);
  useEffect(() => {
    if (!runtime || !day) return; const legIndex = focus.startsWith('leg:') ? Number(focus.slice(4)) : -1; const leg = day.legs[legIndex];
    const id = flightView?.activeId ?? (travelDirection ? (travelDirection === 'return' ? travel?.origin.id : travel?.destination.id) : focus.startsWith('place:') ? focus.slice(6) : leg?.toId ?? hotel?.id);
    const place = flightView?.places.find(candidate => candidate.id === id) ?? (id === hotel?.id ? hotel : dayStops(day).find(stop => stop.place.id === id)?.place);
    overlays.current.lines.forEach(({ line, id: lineId }) => line.setOptions({ strokeOpacity: lineId === focus ? 1 : 0.35, strokeWeight: lineId === focus ? 6 : 4 })); overlays.current.pins.forEach(pin => pin.element.classList.toggle('is-active', pin.id === id));
    if (!follow || !place) return; const path = flightView?.route?.path ?? flightView?.line ?? leg?.path; const target = path?.length ? path[Math.floor(path.length / 2)] : place; const { map } = runtime; const center = map.getCenter();
    if (!center || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { map.setCenter(target); return; }
    const fromCenter = { lat: center.lat(), lng: center.lng() }; const began = performance.now(); let frame = 0;
    const animate = (now: number) => { const progress = Math.min((now - began) / 650, 1); const eased = 1 - Math.pow(1 - progress, 3); map.setCenter({ lat: fromCenter.lat + (target.lat - fromCenter.lat) * eased, lng: fromCenter.lng + (target.lng - fromCenter.lng) * eased }); if (progress < 1) frame = requestAnimationFrame(animate); };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, [runtime, hotel, day, travel, travelDirection, flightView, focus, follow]);
  const caption = flightView?.caption ?? (travelDirection ? `${travelDirection === 'return' ? travel?.destination.name : travel?.origin.name} to ${travelDirection === 'return' ? travel?.origin.name : travel?.destination.name}` : `${focus.startsWith('leg:') ? 'On the way · ' : ''}${hotel?.name ?? 'Day route'}`);
  return <div><div ref={ref} className="live-map" aria-label="Google map following intercity travel and this day's local route" /><p className="live-map-caption">{caption}</p>{error && <p role="alert">{error}</p>}</div>;
}
