import { expect, test, type Page } from '@playwright/test';
import type { StayOffer, TransportOffer } from '@/inventory/contracts';
import type { LiveBrief, LiveDay, LivePlace, LivePlan, LiveSelectionRequest, LiveTravelOption } from '@/live/contracts';

const checkedAt = '2026-09-07T03:00:00.000Z';
const brief: LiveBrief = { origin: 'Delhi', destination: 'Jaipur', startDate: '2027-09-08', days: 4, travellers: 2, travelMode: 'flight', pickupLocation: 'India Gate', endIntent: 'return_to_origin', onwardDestination: null, endTravelMode: 'flight', dietaryPreference: 'both', dietaryNotes: '', dayRhythm: null, pace: null, nightsConfirmed: true, preferences: '', constraints: [] };

function place(id: string, name: string, kind: 'hotel' | 'activity', index: number): LivePlace {
  return {
    id, name, address: `${index + 1} Test Road, Jaipur, India`, lat: 26.91 + index / 100, lng: 75.78 + index / 100,
    source: kind === 'hotel' ? 'Nuitée Connect' : 'Google Maps', checkedAt, mapsUrl: `https://maps.google.com/?q=${id}`,
    rating: 4.2 + index / 10, reviewCount: 1200 + index * 300,
    editorialSummary: `${name} has verified descriptive details for this browser test.`, amenities: ['Wheelchair-accessible entrance', 'Restroom'], attributions: [{ name: kind === 'hotel' ? 'Nuitée Connect' : 'Google Maps' }],
  };
}

function stay(id: string, name: string, index: number, total: number): LivePlace {
  const stayOffer: StayOffer = {
    schemaVersion: 1, kind: 'supplier_offer', id: `stay-offer-${id}`, roomOfferId: `room-${id}`, propertyId: id, locationId: 'city:jaipur', checkIn: '2027-09-08', checkOut: '2027-09-11', rooms: 1,
    price: { currency: 'INR', amount: Math.round(total / 3), unit: 'per_room_per_night' }, totalPrice: { currency: 'INR', amount: total }, availability: 'available',
    roomFacts: { roomLabel: 'Deluxe double room', maxOccupancy: 2, mealPlan: 'breakfast', refundable: true },
    propertyFacts: { name, address: `${index + 1} Test Road`, latitude: 26.91 + index / 100, longitude: 75.78 + index / 100, rating: 4.2 + index / 10, reviewCount: 1200 + index * 300, amenities: ['Wi-Fi'], accessibility: [], tags: [], imageAssetKey: 'test:hotel', starRating: 4 },
    source: { provider: 'Nuitée Connect', providerOfferId: `provider-${id}`, evidenceKind: 'sandbox', checkedAt, expiresAt: '2027-09-08T00:00:00.000Z' }, booking: null,
    cancellationTerms: { summary: 'Refundable until 24 hours before arrival.', refundable: true },
  };
  return {
    ...place(id, name, 'hotel', index),
    stayOffer,
  };
}

function route(id: string, direction: 'outbound' | 'return', label: string, minutes: number, departureAt: string, arrivalAt: string): LiveTravelOption {
  return { schemaVersion: 1, kind: 'route_evidence', id, providerRouteId: id, direction, mode: label.includes('Drive') ? 'drive' : 'transit', label, minutes, meters: minutes * 1000, path: [{ lat: 28.61, lng: 77.2 }, { lat: 26.91, lng: 75.78 }], departureAt, arrivalAt, transitModes: label.includes('Drive') ? [] : ['TRAIN', 'BUS'], transitLines: label.includes('Drive') ? [] : ['Express 12'], timingKind: label.includes('Drive') ? 'estimated' : 'scheduled', checkedAt, source: 'Google Routes' };
}

function flight(id: string, number: string, departureAt: string, arrivalAt: string, price: number): TransportOffer {
  return {
    schemaVersion: 1, kind: 'supplier_offer', id, serviceId: id, mode: 'flight', from: 'DEL', to: 'JAI', departureAt, arrivalAt,
    durationMinutes: Math.round((Date.parse(arrivalAt) - Date.parse(departureAt)) / 60000), stops: 0, operator: number.startsWith('6E') ? 'IndiGo' : 'Air India',
    segments: [{ mode: 'flight', from: 'DEL', to: 'JAI', departureAt, arrivalAt, operator: number.startsWith('6E') ? 'IndiGo' : 'Air India', number }],
    price: { currency: 'INR', amount: price, unit: 'per_traveller' }, availability: 'available',
    source: { provider: 'Nuitée Connect Flights', providerOfferId: id, evidenceKind: 'sandbox', checkedAt, expiresAt: '2027-09-07T23:00:00.000Z' }, booking: null,
    cancellationTerms: { summary: 'Fare terms require refresh.' },
  };
}

const hotelA = stay('hotel-a', 'Rajasthan Palace', 0, 12_000);
const hotelB = stay('hotel-b', 'Jaipur City Hotel', 1, 14_500);
const activityA = place('activity-a', 'Amber Fort', 'activity', 0);
const activityB = place('activity-b', 'City Palace', 'activity', 1);
const activityC = place('activity-c', 'Jal Mahal', 'activity', 2);
const activityD = place('activity-d', 'Evening Hill Trek', 'activity', 4);
const restaurantA = place('restaurant-a', 'Jaipur Dining House', 'activity', 3);
const origin = { ...place('origin', 'India Gate', 'activity', 0), utcOffsetMinutes: 330 };
const destination = { ...hotelA, utcOffsetMinutes: 330 };
const originAirport = { ...place('airport-del', 'Indira Gandhi International Airport', 'activity', 0), airportCode: 'DEL', utcOffsetMinutes: 330 };
const destinationAirport = { ...place('airport-jai', 'Jaipur International Airport', 'activity', 0), airportCode: 'JAI', utcOffsetMinutes: 330 };
const flightA = flight('flight-a', '6E100', '2027-09-08T07:40:00+05:30', '2027-09-08T08:40:00+05:30', 3_000);
const flightB = flight('flight-b', 'AI202', '2027-09-08T11:30:00+05:30', '2027-09-08T12:35:00+05:30', 3_600);
const returnFlight = { ...flight('flight-return', '6E300', '2027-09-11T18:00:00+05:30', '2027-09-11T19:00:00+05:30', 3_200), from: 'JAI', to: 'DEL', segments: [{ ...flightA.segments[0], from: 'JAI', to: 'DEL', number: '6E300', departureAt: '2027-09-11T18:00:00+05:30', arrivalAt: '2027-09-11T19:00:00+05:30' }] };
const localLeg = (fromId: string, toId: string, minutes: number) => ({ fromId, toId, minutes, meters: minutes * 500, path: [{ lat: 26.91, lng: 75.78 }, { lat: 26.93, lng: 75.8 }], checkedAt });

function days(): LiveDay[] {
  return [
    { date: '2027-09-08', visits: [{ place: activityA, durationMinutes: 90, hoursStatus: 'open', hoursNote: 'Regular schedule shows open' }], meals: [{ type: 'lunch', place: restaurantA, durationMinutes: 60, targetStartMinutes: 780, location: 'restaurant', dietaryNote: 'Vegetarian and non-vegetarian preference used for this Google restaurant search.', hoursStatus: 'open', hoursNote: 'Regular schedule covers the planned lunch time' }], legs: [localLeg('hotel-a', 'activity-a', 20), localLeg('activity-a', 'restaurant-a', 15), localLeg('restaurant-a', 'hotel-a', 25)] },
    { date: '2027-09-09', visits: [{ place: activityC, durationMinutes: 60, timingKind: 'fixed', fixedStartMinutes: 600, timingEvidence: { kind: 'provider_slot', durationMinutes: 60, startMinutes: 600, source: 'provider', label: 'Provider ticket time' }, durationProfile: { kind: 'provider_slot', minimumMinutes: 60, preferredMinutes: 60, maximumMinutes: 60, groupSensitivity: 'none', evidence: 'provider' }, mealCoverage: { type: 'lunch', evidence: 'provider', sourceLabel: 'Experience provider', note: 'The ticket includes lunch.' }, hoursStatus: 'unknown', hoursNote: 'Opening hours unavailable' }], legs: [localLeg('hotel-a', 'activity-c', 15), localLeg('activity-c', 'hotel-a', 15)], capacityNote: '4 hr remains flexible after scheduled activities, meals and travel; no additional validated candidate was placed.' },
    { date: '2027-09-10', visits: [], legs: [] },
    { date: '2027-09-11', visits: [], legs: [] },
  ];
}

function flightPlan(): LivePlan {
  const transfer = route('airport-transfer', 'outbound', 'Drive', 25, '2027-09-08T05:15:00Z', '2027-09-08T05:40:00Z');
  return {
    brief, hotels: [hotelA, hotelB], selectedHotelId: hotelA.id, activityOptions: [activityA, activityB, activityC, activityD], mealOptions: [restaurantA], days: days(),
    flight: { origin, destination, originAirport, destinationAirport, outbound: [flightA, flightB], return: [returnFlight], suggestedOutboundId: flightA.id, suggestedReturnId: returnFlight.id, outboundFirstMile: transfer, outboundLastMile: transfer, returnFirstMile: { ...transfer, direction: 'return' }, returnLastMile: { ...transfer, direction: 'return' }, assumptions: [] },
    warnings: ['Sandbox prices require refresh.'], checkedAt, status: 'provisional', totalCost: null,
    locks: { hotel: false, outboundFlight: false, returnFlight: false, outboundTravel: false, returnTravel: false, activityIds: [] },
  };
}

function roadPlan(): LivePlan {
  const outboundA = route('road-a', 'outbound', 'Drive', 270, '2027-09-08T02:30:00Z', '2027-09-08T07:00:00Z');
  const outboundB = route('road-b', 'outbound', 'Train + Bus', 300, '2027-09-08T03:30:00Z', '2027-09-08T08:30:00Z');
  const returning = route('road-return', 'return', 'Drive', 280, '2027-09-11T11:30:00Z', '2027-09-11T16:10:00Z');
  return { ...flightPlan(), brief: { ...brief, travelMode: 'self_drive' }, flight: undefined, travel: { origin, destination, outbound: [outboundA, outboundB], return: [returning], suggestedOutboundId: outboundA.id, suggestedReturnId: returning.id, selectionReason: 'Shortest route matching your preference.', assumptions: [] } };
}

async function installFakeMap(page: Page) {
  await page.addInitScript(() => {
    class FakeMap { center = { lat: 20, lng: 78 }; fitBounds() {} setCenter(point: { lat: number; lng: number }) { this.center = point; } getCenter() { return { lat: () => this.center.lat, lng: () => this.center.lng }; } }
    class FakeBounds { extend() {} }
    class FakePolyline { setMap() {} setOptions() {} }
    class FakeMarker { map: unknown; constructor(options: { map: unknown }) { this.map = options.map; } }
    Object.defineProperty(window, 'google', { value: { maps: { Map: FakeMap, LatLngBounds: FakeBounds, Polyline: FakePolyline, marker: { AdvancedMarkerElement: FakeMarker } } }, configurable: true });
  });
}

async function mockPlanner(page: Page, initialPlan: LivePlan) {
  let current = structuredClone(initialPlan);
  await page.route('**/api/agent/conversation', async routeHandler => {
    const request = routeHandler.request();
    if (request.method() !== 'POST') return routeHandler.continue();
    const body = request.postDataJSON();
    if (body.phase === 'live') return routeHandler.fulfill({ status: 200, contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'result', result: { kind: 'live', brief: current.brief, message: 'Built the browser-test itinerary.', plan: current } })}\n` });
    if (body.phase !== 'live-selection') return routeHandler.continue();
    current = structuredClone(body.plan);
    const command = body.command as LiveSelectionRequest['command'];
    current.locks ??= { hotel: false, outboundFlight: false, returnFlight: false, outboundTravel: false, returnTravel: false, activityIds: [] };
    current.locks.activityIds ??= [];
    if (command.type === 'select_activity' && command.placeId === activityD.id && !command.confirmConstraints) {
      const finding = { id: 'day-0-daylight-activity-d', severity: 'warning' as const, dayIndex: 0, itemId: activityD.id, message: 'Evening Hill Trek falls outside the conservative daylight planning window.', overridable: true };
      const impact = { status: 'warning' as const, requiresConfirmation: true, affectedDays: [0], movedItems: [{ dayIndex: 0, itemId: restaurantA.id, label: restaurantA.name, kind: 'meal' as const, previousStartMinutes: 780, nextStartMinutes: 840, deltaMinutes: 60 }], transferChanges: [{ dayIndex: 0, previousFromId: hotelA.id, previousToId: activityA.id, nextFromId: hotelA.id, nextToId: activityD.id, previousMinutes: 20, nextMinutes: 35 }], mealChanges: [{ dayIndex: 0, type: 'lunch' as const, previousStartMinutes: 780, nextStartMinutes: 840, deltaMinutes: 60 }], usableTimeDeltaMinutes: -60, findings: [finding], alternatives: [{ id: activityB.id, label: activityB.name }] };
      return routeHandler.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'live-selection', plan: current, message: 'This change needs confirmation.', impact, confirmation: { command: { ...command, confirmConstraints: true }, findings: [finding], impact } }) });
    }
    if (command.type === 'set_lock') current.locks[command.target] = command.locked;
    if (command.type === 'set_activity_lock') current.locks.activityIds = command.locked ? [...new Set([...current.locks.activityIds, command.placeId])] : current.locks.activityIds.filter(id => id !== command.placeId);
    if (command.type === 'select_hotel') current.selectedHotelId = command.hotelId;
    if (command.type === 'select_flight' && current.flight) {
      if (command.direction === 'outbound') current.flight.suggestedOutboundId = command.offerId;
      else current.flight.suggestedReturnId = command.offerId;
    }
    if (command.type === 'select_travel' && current.travel) {
      if (command.direction === 'outbound') current.travel.suggestedOutboundId = command.optionId;
      else current.travel.suggestedReturnId = command.optionId;
    }
    if (command.type === 'select_activity') {
      const candidate = current.activityOptions?.find(option => option.id === command.placeId);
      const visit = current.days[command.dayIndex]?.visits[command.visitIndex];
      if (candidate && visit) visit.place = candidate;
    }
    const impact = command.type.startsWith('select_') ? { status: command.type === 'select_activity' && command.placeId === activityD.id ? 'warning' as const : 'safe' as const, requiresConfirmation: false, affectedDays: [0], movedItems: [], transferChanges: [], mealChanges: [], usableTimeDeltaMinutes: 0, findings: [], alternatives: [] } : undefined;
    await routeHandler.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'live-selection', plan: current, message: 'Selection applied in browser test.', impact }) });
  });
}

async function createPlan(page: Page, plan: LivePlan) {
  page.on('pageerror', error => console.error(`PAGE ERROR: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') console.error(`BROWSER ERROR: ${message.text()}`);
  });
  await installFakeMap(page);
  await mockPlanner(page, plan);
  await page.goto('/plan');
  const composer = page.getByLabel('Ask your trip planner');
  await composer.fill('Plan a four day Jaipur trip from Delhi.');
  const send = page.getByRole('button', { name: /^Send/ });
  await expect(send).toBeEnabled({ timeout: 5_000 });
  await send.click();
  await expect(page.getByRole('heading', { name: 'Jaipur', exact: true })).toBeVisible();
}

test('flight, stay and activity alternatives reuse timeline cards and apply selections', async ({ page }) => {
  await createPlan(page, flightPlan());
  const outbound = page.locator('.live-card-column .live-route-card').filter({ hasText: 'Selected outbound flight' });
  await outbound.getByRole('button', { name: 'Change' }).click();
  const drawer = page.getByRole('dialog', { name: 'Change outbound flight' });
  await expect(drawer.locator('.live-route-card')).toHaveCount(2);
  await expect(drawer.locator('.flight-card-body')).toHaveCount(2);
  await expect(drawer.locator('.live-route-footer').first()).toBeVisible();
  expect(await drawer.locator('.live-route-card').evaluateAll(cards => cards.every(card => card.scrollHeight <= card.clientHeight))).toBe(true);
  await expect(drawer.locator('.drawer-option')).toHaveCount(0);
  await drawer.locator('.live-route-card').filter({ hasText: 'AI202' }).getByRole('button', { name: 'Select flight' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('.live-card-column .live-route-card').filter({ hasText: 'Selected outbound flight' })).toContainText('AI202');

  const selectedFlight = page.locator('.live-card-column .live-route-card').filter({ hasText: 'Selected outbound flight' });
  await selectedFlight.getByRole('button', { name: 'Lock' }).click();
  await expect(selectedFlight.getByRole('button', { name: 'Change' })).toBeDisabled();

  const stayCard = page.locator('.live-card-column .live-place-card').filter({ hasText: 'Arrive at your stay' });
  await stayCard.getByRole('button', { name: 'Change' }).click();
  const stayDrawer = page.getByRole('dialog', { name: 'Change stay' });
  await expect(stayDrawer.locator('.live-place-card .hotel-card-body')).toHaveCount(2);
  await expect(stayDrawer.locator('.live-place-card .live-card-footer')).toHaveCount(2);
  await expect(stayDrawer.locator('.live-place-card .live-card-footer').first()).toBeVisible();
  expect(await stayDrawer.locator('.live-place-card').evaluateAll(cards => cards.every(card => card.scrollHeight <= card.clientHeight))).toBe(true);
  await stayDrawer.locator('.live-place-card').filter({ hasText: 'Jaipur City Hotel' }).getByRole('button', { name: 'Select stay' }).click();
  await expect(page.locator('.live-card-column .live-place-card').filter({ hasText: 'Arrive at your stay' })).toContainText('Jaipur City Hotel');

  const activity = page.locator('.live-card-column .live-place-card').filter({ hasText: 'Amber Fort' });
  await activity.getByRole('button', { name: 'Change' }).click();
  const activityDrawer = page.getByRole('dialog', { name: 'Change activity' });
  await expect(activityDrawer.locator('.live-place-card .activity-card-body')).toHaveCount(3);
  await expect(activityDrawer.locator('.live-place-about')).toHaveCount(3);
  await expect(activityDrawer.locator('.live-place-card .live-card-footer').first()).toBeVisible();
  expect(await activityDrawer.locator('.live-place-card').evaluateAll(cards => cards.every(card => card.scrollHeight <= card.clientHeight))).toBe(true);
  await activityDrawer.locator('.live-place-card').filter({ hasText: 'City Palace' }).getByRole('button', { name: 'Select activity' }).click();
  await expect(page.locator('.live-card-column .live-place-card').filter({ hasText: 'City Palace' })).toBeVisible();
});

test('Google route alternatives use travel cards and update timeline timing', async ({ page }) => {
  await createPlan(page, roadPlan());
  const outbound = page.locator('.live-card-column .live-route-card').filter({ hasText: 'Suggested outbound travel' });
  await outbound.getByRole('button', { name: 'Change' }).click();
  const drawer = page.getByRole('dialog', { name: 'Change outbound travel' });
  await expect(drawer.locator('.live-route-card')).toHaveCount(2);
  await expect(drawer.locator('.flight-card-body')).toHaveCount(2);
  await drawer.locator('.live-route-card').filter({ hasText: 'Train + Bus' }).getByRole('button', { name: 'Select travel' }).click();
  await expect(page.locator('.live-card-column .live-route-card').filter({ hasText: 'Suggested outbound travel' })).toContainText('Train + Bus');
  const timelineEvent = page.locator('.live-timeline-event').filter({ has: page.locator('.live-route-card', { hasText: 'Train + Bus' }) });
  await expect(timelineEvent.locator('.live-time-rail')).toContainText('09:00');
  await expect(timelineEvent.locator('.live-time-rail')).toContainText('14:00');
  await expect(page.locator('.live-map-caption')).toContainText('India Gate');
});

test('meal stops render in the timed route chain with dietary provenance', async ({ page }) => {
  await createPlan(page, flightPlan());
  const meal = page.locator('.live-card-column .itinerary-meal-card').filter({ hasText: 'Jaipur Dining House' });
  await expect(meal).toBeVisible();
  await expect(meal).toContainText('Lunch · 60 min');
  await expect(meal).toContainText('Regular schedule covers the planned lunch time');
  await expect(meal).toContainText('Vegetarian and non-vegetarian preference');
  await expect(page.locator('.live-day-summary').first()).toContainText('60 min meals');
  await expect(page.locator('.live-transfer').filter({ hasText: 'Drive to Jaipur Dining House' })).toBeVisible();
});

test('fixed activity evidence, capacity explanations and edit impacts are visible', async ({ page }) => {
  await createPlan(page, flightPlan());
  const fixed = page.locator('.live-card-column .live-place-card').filter({ hasText: 'Jal Mahal' });
  await expect(fixed).toContainText('Provider ticket time');
  await expect(fixed).toContainText('Includes lunch');
  await expect(page.getByText(/4 hr remains flexible/)).toBeVisible();

  const activity = page.locator('.live-card-column .live-place-card').filter({ hasText: 'Amber Fort' });
  await activity.getByRole('button', { name: 'Change' }).click();
  const drawer = page.getByRole('dialog', { name: 'Change activity' });
  await drawer.locator('.live-place-card').filter({ hasText: 'Evening Hill Trek' }).getByRole('button', { name: 'Select activity' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Review schedule conflict' });
  await expect(confirmation).toContainText('1 item moved');
  await expect(confirmation).toContainText('1 transfer changed');
  await expect(confirmation).toContainText('1 meal time changed');
  await expect(confirmation).toContainText('60 min usable time lost');
  await confirmation.getByRole('button', { name: 'Apply anyway' }).click();
  await expect(page.locator('.live-card-column .live-place-card').filter({ hasText: 'Evening Hill Trek' })).toBeVisible();
  await expect(page.locator('.live-impact-summary')).toContainText('warning');
});

test('drawer supports keyboard dismissal and mobile layout without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createPlan(page, flightPlan());
  const activity = page.locator('.live-card-column .live-place-card').filter({ hasText: 'Amber Fort' });
  await activity.getByRole('button', { name: 'Change' }).click();
  const drawer = page.getByRole('dialog', { name: 'Change activity' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByPlaceholder('Search activities')).toBeFocused();
  expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(activity.getByRole('button', { name: 'Change' })).toBeFocused();
});
