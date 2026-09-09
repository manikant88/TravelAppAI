import { describe, it, expect, vi } from 'vitest';
import { runLivePlan, type LiveModel } from '@/live/planner';
import { emptyLiveBrief, type LiveBrief, type LivePlace, type LiveRequest, type LiveTravelOption } from '@/live/contracts';
import type { LiveProvider } from '@/live/google.server';
import type { StayProvider, SupplierStaySearchResult } from '@/inventory/providers/stay-provider';
import type { FlightProvider } from '@/transport/providers/nuitee-flight.server';
import type { TransportOffer } from '@/inventory/contracts';
const brief: LiveBrief = { ...emptyLiveBrief, origin: 'Delhi', destination: 'Jaipur', startDate: '2026-09-08', days: 4, travellers: 2, travelMode: 'public_transit', dietaryPreference: 'both', nightsConfirmed: true };
const place = (id: string): LivePlace => ({ id, name: id, address: 'Test address', lat: 26, lng: 75, source: 'Google Maps', checkedAt: '2026-09-04T00:00:00Z', mapsUrl: 'https://www.google.com/maps', attributions: [] });
function setup() {
 const model: LiveModel = { extract: vi.fn(async () => ({ brief, question: null })), select: vi.fn(async () => ({ hotelId: 'hotel', visits: [{ placeId: 'attraction', day: 2, durationMinutes: 90 }] })) };
 const travelOption = (direction: 'outbound' | 'return', mode: 'drive' | 'transit'): LiveTravelOption => ({ schemaVersion:1,kind:'route_evidence',id:`${direction}-${mode}`,providerRouteId:`${direction}-${mode}`,direction,mode,label:mode==='drive'?'Drive':'Bus',minutes:mode==='drive'?300:360,meters:250000,path:[],transitModes:mode==='transit'?['BUS']:[],transitLines:[],checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:mode==='drive'?'estimated':'scheduled' });
 const provider: LiveProvider = {
  search: vi.fn(async q => q.startsWith('hotels') ? [place('hotel')] : q.startsWith('tourist') ? [place('attraction')] : q.includes('restaurants') || q.startsWith('evening') ? [] : [{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]),
  details: vi.fn(async id => ({...place(id),utcOffsetMinutes:330})),
  route: vi.fn(async (a,b) => ({ fromId:a.id,toId:b.id,minutes:20,meters:1000,path:[],checkedAt:'2026-09-04T00:00:00Z' })),
  travelRoutes: vi.fn(async (_a,_b,input) => [travelOption(input.direction,input.mode)]),
 };
 const input: LiveRequest = { phase:'live',message:'Plan this trip on 8 September 2026',brief:emptyLiveBrief,history:[] };
 return { model, provider, input, signal: new AbortController().signal, today: '2026-09-04' };
}
describe('live conversation planning boundary', () => {
 it('clarifies nights before spending on provider searches', async () => {
  const d=setup(); d.model.extract=async()=>({brief:{...brief,nightsConfirmed:false},question:null});
  const r=await runLivePlan(d.input,d); expect(r.plan).toBeUndefined(); expect(r.message).toContain('3 nights'); expect(d.provider.search).not.toHaveBeenCalled();
 });
 it('keeps true calendar dates and unknown costs without snapshot offers', async()=>{
  const d=setup();const r=await runLivePlan(d.input,d);
  expect(r.plan?.days.map(x=>x.date)).toEqual(['2026-09-08','2026-09-09','2026-09-10','2026-09-11']);
  expect(r.plan?.totalCost).toBeNull();expect(r.plan?.selectedHotelId).toBe('hotel');expect(r.plan?.days[1].visits[0].place.id).toBe('attraction');expect(d.provider.route).toHaveBeenCalledTimes(2);
  expect(r.plan?.travel?.outbound.map(option=>option.mode)).toEqual(['transit']);
  expect(r.plan?.travel?.return.map(option=>option.mode)).toEqual(['transit']);
 expect(r.plan?.travel?.suggestedOutboundId).toBe('outbound-transit');
 expect(d.provider.travelRoutes).toHaveBeenCalledTimes(2);
  expect(r.message).toContain('I’ve put together a 4-day trip to Jaipur');
  expect(r.message).toContain('I’m using hotel as your base');
  expect(r.message).toContain('I scheduled 1 activity at a balanced pace');
  expect(r.message).toContain('For travel, I picked the quickest route');
  expect(r.message).not.toMatch(/Nuitée|Google Places|provider inventory/i);
 });
 it('describes planning work without exposing supplier names in loading copy', async () => {
  const d=setup(); const progress:string[]=[];
  await runLivePlan(d.input,{...d,progress:message=>progress.push(message)});
  expect(progress).toEqual(expect.arrayContaining([
   expect.stringContaining('stays, activities, restaurants and evening options'),
   expect.stringContaining('opening hours, transfers and meal timing'),
  ]));
  expect(progress.join(' ')).not.toMatch(/Nuitée|Google|provider|sandbox/i);
 });
 it.each(['invented','hotel'])('rejects unobserved attraction ID %s',async id=>{
  const d=setup();d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:id,day:1,durationMinutes:60}]});
 const r=await runLivePlan(d.input,d);expect(r.plan?.selectedHotelId).toBeNull();expect(d.provider.route).not.toHaveBeenCalled();
 });
 it('rejects repeated activities and out-of-range days',async()=>{
  const d=setup();d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:'attraction',day:1,durationMinutes:60},{placeId:'attraction',day:5,durationMinutes:60}]});
  const r=await runLivePlan(d.input,d);expect(r.plan?.days.every(x=>!x.visits.length)).toBe(true);expect(d.provider.details).not.toHaveBeenCalled();
 });
 it('retains live places but never converts a failed route into zero minutes',async()=>{
  const d=setup();d.provider.route=async()=>{throw new Error('Provider outage');};
  const r=await runLivePlan(d.input,d);expect(r.plan?.days[1].visits).toHaveLength(1);const activityLeg=r.plan?.days[1].legs.find(leg=>leg.toId==='attraction');expect(activityLeg?.minutes).toBeNull();expect(activityLeg && 'error' in activityLeg ? activityLeg.error : '').toBeTruthy();
 });
 it('preserves hotel candidates if attraction search fails',async()=>{
  const d=setup();d.provider.search=async q=>{if(q.startsWith('hotels'))return [place('hotel')];throw new Error('Unavailable');};
  const r=await runLivePlan(d.input,d);expect(r.plan?.hotels).toHaveLength(1);expect(r.plan?.days.every(x=>!x.visits.length)).toBe(true);expect(d.model.select).not.toHaveBeenCalled();
 });
 it('uses dated supplier stays without treating their property IDs as Google place IDs', async () => {
  const d = setup();
  const stayProvider: StayProvider = {
   search: vi.fn(async (): Promise<SupplierStaySearchResult> => ({
    environment: 'sandbox',
    checkedAt: '2026-09-06T16:00:00Z',
    assumptions: ['1 room assumed, with no more than two travellers per room.'],
    offers: [{
     schemaVersion: 1, kind: 'supplier_offer', id: 'offer:stay:nuitee:test', roomOfferId: 'room', propertyId: 'hotel', locationId: 'nuitee:hotel:hotel',
     checkIn: '2026-09-08', checkOut: '2026-09-11', rooms: 1,
     propertyFacts: { name: 'Nuitée Jaipur Hotel', rating: 4.4, reviewCount: 80, amenities: ['WiFi'], accessibility: [], tags: ['central'], imageAssetKey: 'nuitee:hotel', address: 'Jaipur', latitude: 26.92, longitude: 75.82 },
     roomFacts: { roomLabel: 'Double Room', maxOccupancy: 2, mealPlan: 'breakfast', refundable: true },
     price: { amount: 3000, currency: 'INR', unit: 'per_room_per_night' }, totalPrice: { amount: 9000, currency: 'INR' }, availability: 'available',
     source: { provider: 'Nuitée Connect', providerOfferId: 'provider-offer', evidenceKind: 'sandbox', checkedAt: '2026-09-06T16:00:00Z' }, booking: null,
    }],
   })),
  };
  const result = await runLivePlan(d.input, { ...d, stayProvider });
  const hotel = result.plan?.hotels[0];
  expect(hotel?.source).toBe('Nuitée Connect');
  expect(hotel?.stayOffer?.totalPrice?.amount).toBe(9000);
  expect(d.provider.search).not.toHaveBeenCalledWith(expect.stringMatching(/^hotels/), expect.anything(), expect.anything());
  expect(d.provider.details).not.toHaveBeenCalledWith('hotel');
  expect(result.plan?.warnings).toContain('Stay search assumption: 1 room assumed, with no more than two travellers per room.');
 });
 it('stops before supplier calls when cancelled',async()=>{
  const d=setup();const c=new AbortController();c.abort();await expect(runLivePlan(d.input,{...d,signal:c.signal})).rejects.toThrow();expect(d.provider.search).not.toHaveBeenCalled();
 });
});

it('keeps the itinerary when one travel mode fails and does not invent its fare', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,travelMode:'self_drive',pickupLocation:'Saket, New Delhi'},question:null});
 d.provider.travelRoutes=vi.fn(async (_a,_b,input): Promise<LiveTravelOption[]>=>{
  if(input.direction==='return')throw new Error('No return route');
  return [{schemaVersion:1,kind:'route_evidence',id:`${input.direction}-drive`,providerRouteId:`${input.direction}-drive`,direction:input.direction,mode:'drive',label:'Drive',minutes:300,meters:250000,path:[],transitModes:[],transitLines:[],checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:'estimated'}];
 });
 const r=await runLivePlan(d.input,d);
 expect(r.plan?.days[1].visits).toHaveLength(1);
 expect(r.plan?.travel?.outbound).toHaveLength(1);
 expect(r.plan?.travel?.outbound[0]).not.toHaveProperty('fare');
 expect(r.plan?.travel?.return).toHaveLength(0);
 expect(r.plan?.warnings.some(w=>w.includes('route searches failed'))).toBe(true);
});

it('constrains explicit train and bus preferences to their Google transit modes', async () => {
 for (const [travelMode, expectedModes] of [['train', ['TRAIN', 'LIGHT_RAIL', 'RAIL', 'SUBWAY']], ['bus', ['BUS']]] as const) {
  const d=setup();
  d.model.extract=async()=>({brief:{...brief,travelMode},question:null});
  await runLivePlan(d.input,d);
  const requests = vi.mocked(d.provider.travelRoutes).mock.calls.map(call => call[2]);
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.mode === 'transit')).toBe(true);
  expect(requests.every(request => JSON.stringify(request.transitModes) === JSON.stringify(expectedModes))).toBe(true);
 }
});

it('uses cab road evidence and requires an explicit cab pickup point', async () => {
 const missing=setup();missing.model.extract=async()=>({brief:{...brief,travelMode:'cab',pickupLocation:null},question:null});
 const clarification=await runLivePlan(missing.input,missing);
 expect(clarification.message).toContain('cab pick you up');
 expect(missing.provider.search).not.toHaveBeenCalled();

 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:'cab',pickupLocation:'India Gate, New Delhi'},question:null});
 await runLivePlan(d.input,d);
 const requests = vi.mocked(d.provider.travelRoutes).mock.calls.map(call => call[2]);
 expect(requests).toHaveLength(2);
 expect(requests.every(request => request.mode === 'drive' && request.roadUse === 'cab')).toBe(true);
});

it('compares transit and cab route evidence for Recommend Me without requiring a pickup point', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:'recommend',pickupLocation:null,preferences:'budget-friendly travel'},question:null});
 const result=await runLivePlan(d.input,d);
 const requests = vi.mocked(d.provider.travelRoutes).mock.calls.map(call => call[2]);
 expect(requests).toHaveLength(4);
 expect(requests.filter(request => request.mode === 'transit')).toHaveLength(2);
 expect(requests.filter(request => request.mode === 'drive' && request.roadUse === 'cab')).toHaveLength(2);
 expect(result.plan?.travel?.outbound.map(option => option.mode)).toEqual(['transit', 'drive']);
 expect(result.plan?.travel?.selectionReason).toContain('practical for 2 travellers');
 expect(result.plan?.travel?.selectionReason).toContain('budget preference');
 expect(result.plan?.travel?.assumptions.join(' ')).toContain('private-cab price');
});

it('limits detailed Google enrichment to the scheduled shortlist', async () => {
 const d=setup();
 const candidates=Array.from({length:10},(_,index)=>place(`attraction-${index}`));
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?candidates:q.includes('restaurants')||q.startsWith('evening')?[]:[{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]);
 d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:'attraction-0',day:2,durationMinutes:90}]});
 const result=await runLivePlan(d.input,d);
 expect(result.plan?.days.flatMap(day=>day.visits).length).toBeGreaterThan(6);
 expect(d.provider.details).toHaveBeenCalledTimes(6);
 const discoveryQueries = vi.mocked(d.provider.search).mock.calls.map(call => String(call[0])).filter(query => query.startsWith('tourist'));
 expect(discoveryQueries).toHaveLength(6);
 expect(discoveryQueries.join(' ')).toMatch(/heritage.*museums.*markets.*parks.*adventure.*family/);
 const googleCalls = vi.mocked(d.provider.search).mock.calls.length + vi.mocked(d.provider.details).mock.calls.length + vi.mocked(d.provider.route).mock.calls.length + vi.mocked(d.provider.travelRoutes!).mock.calls.length;
 expect(googleCalls).toBeLessThanOrEqual(60);
});

it('asks for a transport preference before any provider search', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:null},question:null});
 const r=await runLivePlan(d.input,d);
 expect(r.message).toContain('How would you like to travel');
 expect(d.provider.search).not.toHaveBeenCalled();
});

it('asks self-drivers for a starting location before any provider search', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:'self_drive',pickupLocation:null},question:null});
 const r=await runLivePlan(d.input,d);
 expect(r.message).toContain('start driving from');
 expect(d.provider.search).not.toHaveBeenCalled();
});

it('asks flyers for a starting point before any provider search', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:'flight',pickupLocation:null},question:null});
 const r=await runLivePlan(d.input,{...d,flightProvider:{search:vi.fn()} as unknown as FlightProvider});
 expect(r.message).toContain('airport transfer start');
 expect(d.provider.search).not.toHaveBeenCalled();
});

it('continues with generic restaurant discovery when dining preferences are omitted', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,dietaryPreference:null},question:null});
 const r=await runLivePlan(d.input,d);
 expect(r.plan).toBeDefined();
 expect(d.provider.search).toHaveBeenCalledWith('restaurants in Jaipur',8);
});

it('adds restaurant meals to daily routes with explicit pure-vegetarian provenance', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,dietaryPreference:'pure_vegetarian',dietaryNotes:'no peanuts'},question:null});
 const restaurants=Array.from({length:8},(_,index)=>({...place(`restaurant-${index}`),lat:26+index/1000,lng:75+index/1000}));
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[place('attraction')]:q.startsWith('pure vegetarian restaurants')?restaurants:[{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]);
 d.provider.details=vi.fn(async id=>({...place(id),regularHours:[{open:{day:0,hour:0,minute:0}}],utcOffsetMinutes:330}));
 const r=await runLivePlan(d.input,d);
 expect(d.provider.search).toHaveBeenCalledWith(expect.stringContaining('pure vegetarian restaurants in Jaipur no peanuts'),8);
 expect(r.plan?.days[0].meals?.map(meal=>meal.type)).toEqual(['lunch','dinner']);
 expect(r.plan?.days[1].meals?.map(meal=>meal.type)).toEqual(['breakfast','lunch','dinner']);
 expect(r.plan?.days[0].meals?.[0].dietaryNote).toContain('confirm that the kitchen serves only vegetarian food');
 expect(r.plan?.days[1].legs[0]).toMatchObject({fromId:'hotel',toId:'hotel',minutes:0});
});

it('searches meals along their surrounding Google route and records the added drive', async () => {
 const d=setup();
 d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:'attraction-a',day:2,durationMinutes:60},{placeId:'attraction-b',day:2,durationMinutes:60}]});
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[place('attraction-a'),place('attraction-b')]:q.includes('restaurants')?[place('fallback-restaurant')]:q.startsWith('evening')?[]:[{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]);
 let corridorIndex=0;
 d.provider.searchAlongRoute=vi.fn(async (_query,from,to)=>({
  places:[{...place(`corridor-${corridorIndex++}`),regularHours:[{open:{day:0,hour:0,minute:0}}]}],
  directLeg:{fromId:from.id,toId:to.id,minutes:10,meters:1000,path:[{lat:26,lng:75},{lat:26.1,lng:75.1}],checkedAt:'2026-09-07T00:00:00Z'},
 }));
 d.provider.details=vi.fn(async id=>({...place(id),regularHours:[{open:{day:0,hour:0,minute:0}}],utcOffsetMinutes:330}));
 const result=await runLivePlan(d.input,d);
 const lunch=result.plan?.days[1].meals?.find(meal=>meal.type==='lunch');
 expect(d.provider.searchAlongRoute).toHaveBeenCalledWith(expect.stringContaining('restaurants'),expect.objectContaining({id:'attraction-a'}),expect.objectContaining({id:'attraction-b'}),5);
 expect(lunch?.routeFit).toMatchObject({basis:'route_corridor',fromId:'attraction-a',toId:'attraction-b',directMinutes:10,addedMinutes:30});
 expect(lunch?.scheduleValidation).toMatchObject({status:'valid',evidence:'regular_hours'});
});

it('keeps day rhythm optional and suppresses evening discovery for early nights', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,dayRhythm:'early_nights'},question:null});
 await runLivePlan(d.input,d);
 expect(d.provider.search).not.toHaveBeenCalledWith(expect.stringContaining('evening'),expect.anything());
});

it('discovers evening ideas without inserting them into the itinerary', async () => {
 const d=setup();
 const evening=place('evening-market');
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[place('attraction')]:q.includes('restaurants')?[]:q.startsWith('evening')?[evening]:[{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]);
 const result=await runLivePlan(d.input,d);
 expect(result.plan?.eveningOptions).toEqual([evening]);
 expect(result.plan?.eveningPrompt).toContain('optional evening ideas');
 expect(result.plan?.days.flatMap(day=>day.visits).some(visit=>visit.place.id===evening.id)).toBe(false);
});

it('schedules one validated evening candidate when the traveller explicitly requests nightlife', async () => {
 const d=setup();
 const nightlife=place('night-market');
 d.model.extract=async()=>({brief:{...brief,dayRhythm:'nightlife'},question:null});
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[place('attraction')]:q.includes('restaurants')?[]:q.startsWith('night clubs')?[nightlife]:[{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]);
 const result=await runLivePlan(d.input,d);
 const scheduled=result.plan?.days.flatMap(day=>day.visits).find(visit=>visit.place.id===nightlife.id);
 expect(scheduled).toMatchObject({period:'evening',sequenceOrder:60});
 expect(result.plan?.eveningPrompt).toBeUndefined();
});

it('builds a flight journey with four airport road transfers', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,travelMode:'flight',pickupLocation:'Saket, New Delhi'},question:null});
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[place('attraction')]:[{...place(q==='Jaipur'?'jaipur':'pickup'),name:q,lat:q==='Jaipur'?26.91:28.52,lng:q==='Jaipur'?75.79:77.2,utcOffsetMinutes:330}]);
 const makeOffer=(direction:'outbound'|'return'):TransportOffer=>({schemaVersion:1,kind:'supplier_offer',id:`flight-${direction}`,serviceId:`service-${direction}`,mode:'flight',from:direction==='outbound'?'DEL':'JAI',to:direction==='outbound'?'JAI':'DEL',departureAt:direction==='outbound'?'2026-09-08T08:00:00+05:30':'2026-09-11T18:00:00+05:30',arrivalAt:direction==='outbound'?'2026-09-08T09:00:00+05:30':'2026-09-11T19:00:00+05:30',durationMinutes:60,stops:0,operator:'Test Air',segments:[{mode:'flight',from:direction==='outbound'?'DEL':'JAI',to:direction==='outbound'?'JAI':'DEL',departureAt:direction==='outbound'?'2026-09-08T08:00:00+05:30':'2026-09-11T18:00:00+05:30',arrivalAt:direction==='outbound'?'2026-09-08T09:00:00+05:30':'2026-09-11T19:00:00+05:30',operator:'Test Air',number:'TA1'}],price:{amount:2500,currency:'INR',unit:'per_traveller'},availability:'available',source:{provider:'Nuitée Connect Flights',providerOfferId:`provider-${direction}`,evidenceKind:'sandbox',checkedAt:'2026-09-07T00:00:00Z'},booking:null});
 const lateCheap={...makeOffer('outbound'),id:'flight-late-cheap',departureAt:'2026-09-08T15:50:00+05:30',arrivalAt:'2026-09-08T16:45:00+05:30',durationMinutes:55,price:{amount:1000,currency:'INR' as const,unit:'per_traveller' as const}};
 const flightProvider:FlightProvider={search:vi.fn(async()=>({originHub:{code:'DEL',name:'Delhi Airport',latitude:28.56,longitude:77.1,countryCode:'IN'},destinationHub:{code:'JAI',name:'Jaipur Airport',latitude:26.82,longitude:75.8,countryCode:'IN'},outbound:[lateCheap,makeOffer('outbound')],returning:[makeOffer('return')],checkedAt:'2026-09-07T00:00:00Z',environment:'sandbox' as const,warnings:[]}))};
 const r=await runLivePlan(d.input,{...d,flightProvider});
 expect(r.plan?.flight?.suggestedOutboundId).toBe('flight-outbound');
 expect(r.plan?.flight?.originAirport.airportCode).toBe('DEL');
 expect(r.plan?.flight?.destinationAirport.airportCode).toBe('JAI');
 expect(d.provider.travelRoutes).toHaveBeenCalledTimes(4);
 expect(r.plan?.travel).toBeUndefined();
});

it('reports a failed flight search instead of claiming flight evidence was used', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,travelMode:'flight',pickupLocation:'Delhi ISBT bus depot'},question:null});
 const timeout=Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
 const flightProvider:FlightProvider={search:vi.fn(async()=>{throw timeout;})};
 const r=await runLivePlan(d.input,{...d,flightProvider});
 expect(r.plan?.flight).toBeUndefined();
 expect(r.plan?.travel?.context).toBe('flight_fallback');
 expect(r.plan?.travel?.suggestedOutboundId).toBeNull();
 expect(r.plan?.travel?.outbound.map(option=>option.label)).toEqual(['Bus','Self-drive','Cab route estimate']);
 expect(r.plan?.warnings).toContain('Cab alternatives use Google road distance and duration only. Cab availability, pickup time and fare are not verified.');
 expect(r.plan?.warnings).toContain('Flight search failed: The operation was aborted due to timeout. No flight offer was added; outbound and return timing remain unresolved.');
 expect(r.message).toContain('I couldn’t find a usable flight');
 expect(r.message).not.toMatch(/Nuitée|Google Places|provider inventory/i);
});

import { localClockMinutes, projectLiveDay } from '@/live/timeline';
import { regularHoursAt, regularHoursStatus, validateRegularHoursInterval } from '@/live/opening-hours';
it('propagates an unknown transfer through every downstream time', () => {
 const day = { date:'2026-09-08', visits:[{place:place('a'),durationMinutes:60},{place:place('b'),durationMinutes:90}], legs:[{fromId:'hotel',toId:'a',minutes:null,meters:null,path:[] as [],checkedAt:'2026-09-04T00:00:00Z',error:'Driving connection unavailable'},{fromId:'a',toId:'b',minutes:20,meters:1000,path:[],checkedAt:'2026-09-04T00:00:00Z'}] };
 const timeline=projectLiveDay(day);expect(timeline.rows.map(r=>r.start)).toEqual([null,null]);expect(timeline.end).toBeNull();
});

it('rejects a model-invented year before supplier requests', async () => {
 const d=setup();d.input.message='Jaipur from 8 September for four days';
 d.model.extract=async()=>({brief:{...brief,startDate:'8911-09-08'},question:null});
 const r=await runLivePlan(d.input,d);expect(r.brief.startDate).toBeNull();expect(r.message).toContain('year');expect(d.provider.search).not.toHaveBeenCalled();
});

it('understands regular opening periods including overnight windows', () => {
 const venue = {...place('venue'), regularHours:[{open:{day:2,hour:18,minute:0},close:{day:3,hour:2,minute:0}}]};
 expect(regularHoursStatus(venue,'2026-09-08')).toBe('open');
 expect(regularHoursStatus(venue,'2026-09-09')).toBe('open');
 expect(regularHoursStatus(venue,'2026-09-10')).toBe('closed');
 expect(regularHoursStatus(place('unknown'),'2026-09-08')).toBe('unknown');
});

it('validates regular opening hours at a meal time', () => {
 const restaurant={...place('restaurant'),regularHours:[{open:{day:2,hour:12,minute:0},close:{day:2,hour:15,minute:0}},{open:{day:2,hour:19,minute:0},close:{day:2,hour:23,minute:0}}]};
 expect(regularHoursAt(restaurant,'2026-09-08',13*60)).toBe('open');
 expect(regularHoursAt(restaurant,'2026-09-08',17*60)).toBe('closed');
 expect(regularHoursAt(place('unknown'),'2026-09-08',13*60)).toBe('unknown');
});

it('requires regular hours to cover the complete scheduled interval', () => {
 const restaurant={...place('restaurant'),regularHours:[{open:{day:2,hour:19,minute:0},close:{day:2,hour:20,minute:0}}]};
 expect(validateRegularHoursInterval(restaurant,'2026-09-08',19*60,19*60+45).status).toBe('valid');
 expect(validateRegularHoursInterval(restaurant,'2026-09-08',19*60+30,20*60+30)).toMatchObject({status:'invalid',evidence:'regular_hours'});
 expect(validateRegularHoursInterval(place('unknown'),'2026-09-08',19*60,20*60).status).toBe('unresolved');
});

it('validates complete intervals inside an overnight regular-hours period', () => {
 const venue={...place('venue'),regularHours:[{open:{day:2,hour:18,minute:0},close:{day:3,hour:2,minute:0}}]};
 expect(validateRegularHoursInterval(venue,'2026-09-08',23*60,25*60).status).toBe('valid');
 expect(validateRegularHoursInterval(venue,'2026-09-08',25*60,27*60).status).toBe('invalid');
});

it('moves an activity from a regularly closed day to the nearest open trip day', async () => {
 const d=setup();
 d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:'attraction',day:1,durationMinutes:60}]});
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[{...place('attraction'),regularHours:[{open:{day:3,hour:9,minute:0},close:{day:3,hour:17,minute:0}}]}]:q.includes('restaurants')||q.startsWith('evening')?[]:[{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]);
 const r=await runLivePlan(d.input,d);
 expect(r.plan?.days[0].visits).toHaveLength(0);
 expect(r.plan?.days[1].visits[0]).toMatchObject({hoursStatus:'open',hoursNote:'Regular schedule shows open on Wednesday'});
 expect(r.plan?.warnings.some(w=>w.includes('moved from 2026-09-08 to 2026-09-09'))).toBe(true);
});

it('separates driving, arrival buffers, visits and the return time without double counting', () => {
 const leg = (fromId: string, toId: string, minutes: number) => ({fromId,toId,minutes,meters:1000,path:[],checkedAt:'2026-09-04T00:00:00Z'});
 const timeline = projectLiveDay({date:'2026-09-08',visits:[{place:place('a'),durationMinutes:60},{place:place('b'),durationMinutes:90}],legs:[leg('hotel','a',20),leg('a','b',10),leg('b','hotel',30)]});
 expect(timeline.rows.map(({departure,arrival,start,end})=>({departure,arrival,start,end}))).toEqual([
  {departure:600,arrival:620,start:635,end:695},
  {departure:695,arrival:705,start:720,end:810},
 ]);
 expect(timeline.returnDeparture).toBe(810);
 expect(timeline.returnArrival).toBe(840);
 expect(timeline.end).toBe(855);
});
it('does not reuse the outbound drive when the return connection is absent', () => {
 const timeline = projectLiveDay({date:'2026-09-08',visits:[{place:place('a'),durationMinutes:60}],legs:[{fromId:'hotel',toId:'a',minutes:20,meters:1000,path:[],checkedAt:'2026-09-04T00:00:00Z'}]});
 expect(timeline.rows[0].end).toBe(695);
 expect(timeline.back).toBeUndefined();
 expect(timeline.returnArrival).toBeNull();
 expect(timeline.end).toBeNull();
});

it('continues Day 1 from the route arrival instead of resetting to 10:00', () => {
 const arrival=localClockMinutes('2026-09-08T06:32:00Z',330,'2026-09-08');
 expect(arrival).toBe(722);
 const timeline=projectLiveDay({date:'2026-09-08',visits:[{place:place('a'),durationMinutes:60}],legs:[{fromId:'hotel',toId:'a',minutes:20,meters:1000,path:[],checkedAt:'2026-09-04T00:00:00Z'}]},arrival!+30);
 expect(timeline.rows[0]).toMatchObject({departure:752,arrival:772,start:787});
});
