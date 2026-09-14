import { describe, it, expect, vi } from 'vitest';
import { zodTextFormat } from 'openai/helpers/zod';
import { extractionSchema, refreshDestinationStayForRoadDates, runLivePlan, type LiveModel } from '@/live/planner';
import { emptyLiveBrief, type LiveBrief, type LivePlace, type LivePlan, type LiveRequest, type LiveTravelOption } from '@/live/contracts';
import type { LiveProvider } from '@/live/google.server';
import type { StayProvider, SupplierStaySearchResult } from '@/inventory/providers/stay-provider';
import type { FlightProvider } from '@/transport/providers/nuitee-flight.server';
import type { TransportOffer } from '@/inventory/contracts';
const brief: LiveBrief = { ...emptyLiveBrief, origin: 'Delhi', destination: 'Jaipur', startDate: '2026-09-08', days: 4, travellers: 2, travelMode: 'public_transit', endIntent: 'return_to_origin', endTravelMode: 'public_transit', dietaryPreference: 'both', nightsConfirmed: true };
const place = (id: string): LivePlace => ({ id, name: id, address: 'Test address', lat: 26, lng: 75, source: 'Google Maps', checkedAt: '2026-09-04T00:00:00Z', mapsUrl: 'https://www.google.com/maps', attributions: [] });
const flightOffer = (direction: 'outbound' | 'return', amount = 2500): TransportOffer => ({ schemaVersion:1,kind:'supplier_offer',id:`recommended-flight-${direction}`,serviceId:`recommended-service-${direction}`,mode:'flight',from:direction==='outbound'?'DEL':'JAI',to:direction==='outbound'?'JAI':'DEL',departureAt:direction==='outbound'?'2026-09-08T08:00:00+05:30':'2026-09-11T18:00:00+05:30',arrivalAt:direction==='outbound'?'2026-09-08T09:00:00+05:30':'2026-09-11T19:00:00+05:30',durationMinutes:60,stops:0,operator:'Test Air',segments:[{mode:'flight',from:direction==='outbound'?'DEL':'JAI',to:direction==='outbound'?'JAI':'DEL',departureAt:direction==='outbound'?'2026-09-08T08:00:00+05:30':'2026-09-11T18:00:00+05:30',arrivalAt:direction==='outbound'?'2026-09-08T09:00:00+05:30':'2026-09-11T19:00:00+05:30',operator:'Test Air',number:'TA1'}],price:{amount,currency:'INR',unit:'per_traveller'},availability:'available',source:{provider:'Nuitée Connect Flights',providerOfferId:`recommended-provider-${direction}`,evidenceKind:'sandbox',checkedAt:'2026-09-07T00:00:00Z'},booking:null });
const flightProvider = (): FlightProvider => ({ search:vi.fn(async()=>({originHub:{code:'DEL',name:'Delhi Airport',latitude:28.56,longitude:77.1,countryCode:'IN'},destinationHub:{code:'JAI',name:'Jaipur Airport',latitude:26.82,longitude:75.8,countryCode:'IN'},outbound:[flightOffer('outbound')],returning:[flightOffer('return')],checkedAt:'2026-09-07T00:00:00Z',environment:'sandbox' as const,warnings:[]})) });
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
 it('keeps the model extraction contract compatible with strict Responses output', () => {
  expect(() => zodTextFormat(extractionSchema,'live_trip_brief')).not.toThrow();
 });
 it('keeps explicit trip facts and plans with defaults when model extraction temporarily fails', async () => {
  const d=setup();
  d.model.extract=async()=>{ throw new Error('model timeout'); };
  const result=await runLivePlan({ ...d.input, message:'Plan a relaxed trip from Delhi to Darjeeling for two adults from 10 October 2026 to 13 October 2026. Prioritise hills, tea and heritage.' },d);
  expect(result.plan?.generationStatus).toBe('valid');
  expect(result.brief).toMatchObject({ origin:'Delhi', destination:'Darjeeling', startDate:'2026-10-10', days:4, travellers:2, nightsConfirmed:true, pace:'relaxed', preferences:'hills, tea and heritage' });
  expect(result.brief).toMatchObject({ travelMode:'recommend', endIntent:'return_to_origin', endTravelMode:'recommend' });
 });
 it('retries failed live searches from the saved brief without requiring AI extraction', async () => {
  const d=setup();
  d.model.extract=vi.fn(async()=>{ throw new Error('model timeout'); });
  const result=await runLivePlan({
   ...d.input,
   brief,
   message:'Apply these trip adjustments together: Repeat the live searches that did not finish and plan again with the rest of my Trip Brief unchanged.',
  },d);
  expect(d.model.extract).not.toHaveBeenCalled();
  expect(d.provider.search).toHaveBeenCalledWith(expect.stringContaining('tourist'),4);
  expect(result.plan?.generationStatus).toBe('valid');
  expect(result.brief).toEqual(brief);
 });
 it('recovers a complete batch of essential answers without changing the outward mode', async () => {
  const d=setup();
  d.model.extract=async()=>{ throw new Error('model unavailable'); };
  const result=await runLivePlan({ ...d.input, brief:{...brief,destination:'Udaipur',travelMode:'cab',pickupLocation:null,endIntent:null,endTravelMode:null}, message:'Update these Trip Essentials together: Use Delhi city centre as my starting point. I want to return to Delhi after Udaipur. I want to fly after Udaipur.' },d);
  expect(result.brief).toMatchObject({ travelMode:'cab',pickupLocation:'Delhi city centre',endIntent:'return_to_origin',endTravelMode:'flight' });
  expect(result.plan).toBeUndefined();
  expect(result.message).toContain('Flight search is not available');
 });
 it('adds adults and children when structured extraction is unavailable', async () => {
  const d=setup();
  d.model.extract=async()=>{ throw new Error('model unavailable'); };
  const result=await runLivePlan({ ...d.input, brief:{...brief,travellers:null,travelMode:null}, message:'Plan a family-friendly holiday from Delhi to Udaipur for two adults and one child from 10 October 2026 to 18 October 2026.' },d);
  expect(result.brief.travellers).toBe(3);
  expect(result.brief.travelMode).toBe('recommend');
 });
 it('keeps an open-season trip request in essentials when AI extraction is unavailable', async () => {
  const d=setup();
  d.model.extract=vi.fn(async()=>{ throw new Error('model timeout'); });
  const result=await runLivePlan({
   ...d.input,
   message:'Hey me and my wife are planning a bhutan trip in march / april / may season. it will be a 7 day trip from banglore. Can you create an itinerary and also when should we start booking the flights so that we do not overpay.',
  },d);
  expect(result.plan).toBeUndefined();
  expect(result.brief).toMatchObject({ origin:'banglore',destination:'bhutan',travellers:2,days:7,startDate:null });
  expect(result.message).toContain('start date including the year');
  expect(d.provider.search).not.toHaveBeenCalled();
 });
 it('repairs an explicitly named destination when successful AI extraction omits it', async () => {
  const d=setup();
  d.model.extract=async()=>({
   brief:{...emptyLiveBrief,origin:'Bangalore',destination:null,travellers:2,days:7,travelMode:null,endIntent:null,endTravelMode:null},
   question:null,
   dateGuidance:{status:'provisional',evidenceKind:'model_general_guidance',startDate:'2027-03-15',days:7,summary:'March is generally a pleasant season in Bhutan.',bookingGuidance:'Check flights several months ahead, then verify current fares.'},
  });
  const result=await runLivePlan({
   ...d.input,
   message:'Hey me and my wife are planning a bhutan trip in march / april / may season. it will be a 7 day trip from banglore. Can you create an itinerary and also when should we start booking the flights so that we do not overpay.',
  },d);
  expect(result.plan).toBeUndefined();
  expect(result.brief).toMatchObject({origin:'Bangalore',destination:'bhutan',travellers:2,days:7,startDate:null,travelMode:'recommend'});
  expect(result.dateGuidance).toMatchObject({startDate:'2027-03-15',days:7});
 });
 it('offers model seasonal guidance without writing unverified dates into the brief', async () => {
  const d=setup();
  const seasonalBrief={...emptyLiveBrief,origin:'Bengaluru',destination:'Bhutan',travellers:2,days:7,travelMode:null,endIntent:null,endTravelMode:null};
  d.model.extract=async()=>({
   brief:seasonalBrief,
   question:null,
   dateGuidance:{status:'provisional',evidenceKind:'model_general_guidance',startDate:'2027-03-22',days:7,summary:'Late March is generally a comfortable period for a cultural trip to Bhutan.',bookingGuidance:'International flights are generally worth checking several months ahead, but no current fare has been checked.'},
  });
  const result=await runLivePlan({...d.input,message:'Recommend when we should take a seven-day Bhutan trip.'},d);
  expect(result.plan).toBeUndefined();
  expect(result.brief).toMatchObject({startDate:null,days:7,nightsConfirmed:false,travelMode:'recommend',endIntent:'return_to_origin'});
  expect(result.dateGuidance).toMatchObject({startDate:'2027-03-22',endDate:'2027-03-28',days:7,status:'provisional',evidenceKind:'model_general_guidance'});
  expect(result.message).toContain('general seasonal guidance');
  expect(d.provider.search).not.toHaveBeenCalled();
  d.model.extract=async()=>{ throw new Error('model unavailable'); };
  const accepted=await runLivePlan({...d.input,brief:result.brief,message:'Use 2027-03-22 through 2027-03-28 as my exact travel dates (7 calendar days and 6 hotel nights, checking out on 2027-03-28).'},d);
  expect(accepted.plan?.generationStatus).toBe('valid');
  expect(accepted.brief).toMatchObject({startDate:'2027-03-22',days:7,nightsConfirmed:true});
  expect(d.provider.search).toHaveBeenCalled();
 });
 it('discards a past model date recommendation', async () => {
  const d=setup();
  d.model.extract=async()=>({brief:{...brief,startDate:null,nightsConfirmed:false},question:null,dateGuidance:{status:'provisional',evidenceKind:'model_general_guidance',startDate:'2026-09-01',days:4,summary:'This is in the past.',bookingGuidance:null}});
  const result=await runLivePlan({...d.input,message:'Recommend dates for Jaipur.'},d);
  expect(result.dateGuidance).toBeUndefined();
  expect(result.message).toContain('start date including the year');
  expect(d.provider.search).not.toHaveBeenCalled();
 });
 it('clarifies nights before spending on provider searches', async () => {
  const d=setup(); d.model.extract=async()=>({brief:{...brief,nightsConfirmed:false},question:null});
  const r=await runLivePlan(d.input,d); expect(r.plan).toBeUndefined(); expect(r.message).toContain('3 nights'); expect(d.provider.search).not.toHaveBeenCalled();
 });
 it('keeps true calendar dates and unknown costs when live offers are unavailable', async()=>{
  const d=setup();const r=await runLivePlan(d.input,d);
  expect(r.plan?.days.map(x=>x.date)).toEqual(['2026-09-08','2026-09-09','2026-09-10','2026-09-11']);
  expect(r.plan?.totalCost).toBeNull();expect(r.plan?.generationStatus).toBe('valid');expect(r.plan?.selectedHotelId).toBe('hotel');expect(r.plan?.days[1].visits[0].place.id).toBe('attraction');expect(d.provider.route).toHaveBeenCalledTimes(2);
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
 it('introduces the destination through the selected activities and observed place descriptions', async () => {
  const d=setup();
  const palace={...place('city-palace'),name:'City Palace',editorialSummary:'A historic palace complex overlooking the lake.'};
  const lake={...place('lake-pichola'),name:'Lake Pichola'};
  d.model.extract=async()=>({brief:{...brief,destination:'Udaipur',preferences:'heritage, lakes and culture'},question:null});
  d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:palace.id,day:2,durationMinutes:90},{placeId:lake.id,day:3,durationMinutes:90}]});
  d.provider.search=vi.fn(async query=>query.startsWith('hotels')?[place('hotel')]:query.startsWith('tourist')?[palace,lake]:query.includes('restaurants')||query.startsWith('evening')?[]:[{...place('origin'),name:'Delhi',utcOffsetMinutes:330}]);
  d.provider.details=vi.fn(async id=>id===palace.id?palace:lake);
  const result=await runLivePlan(d.input,d);
  expect(result.message).toContain('The selected activities give you a feel for Udaipur');
  expect(result.message).toContain('historic landmarks and waterside scenery');
  expect(result.message).toContain('Highlights include City Palace and Lake Pichola');
  expect(result.message).toContain('City Palace: A historic palace complex overlooking the lake.');
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
 it.each(['invented','hotel'])('discards unobserved attraction ID %s and builds from verified options',async id=>{
  const d=setup();d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:id,day:1,durationMinutes:60}]});
 const r=await runLivePlan(d.input,d);expect(r.plan?.selectedHotelId).toBe('hotel');expect(r.plan?.days[1].visits[0]?.place.id).toBe('attraction');expect(r.plan?.generationStatus).toBe('valid');expect(r.plan?.warnings.join(' ')).toContain('unverified options');
 });
 it('discards repeated activities and out-of-range days before building from verified options',async()=>{
  const d=setup();d.model.select=async()=>({hotelId:'hotel',visits:[{placeId:'attraction',day:1,durationMinutes:60},{placeId:'attraction',day:5,durationMinutes:60}]});
  const r=await runLivePlan(d.input,d);expect(r.plan?.days.flatMap(day=>day.visits)).toHaveLength(1);expect(r.plan?.days[1].visits[0]?.place.id).toBe('attraction');expect(r.plan?.generationStatus).toBe('valid');
 });
 it('finishes with a deterministic arrangement when AI selection does not complete',async()=>{
  const d=setup();d.model.select=async()=>{throw new Error('selection timeout');};
  const r=await runLivePlan(d.input,d);expect(r.plan?.selectedHotelId).toBe('hotel');expect(r.plan?.days[1].visits[0]?.place.id).toBe('attraction');expect(r.plan?.generationStatus).toBe('valid');expect(r.plan?.generationIssue).toBeUndefined();expect(r.plan?.warnings.join(' ')).toContain('rebuilt deterministically');
 });
 it('retains live places but never converts a failed route into zero minutes',async()=>{
  const d=setup();d.provider.route=async()=>{throw new Error('Provider outage');};
  const r=await runLivePlan(d.input,d);expect(r.plan?.days[1].visits).toHaveLength(1);const activityLeg=r.plan?.days[1].legs.find(leg=>leg.toId==='attraction');expect(activityLeg?.minutes).toBeNull();expect(activityLeg && 'error' in activityLeg ? activityLeg.error : '').toBeTruthy();
 });
 it('preserves hotel candidates if attraction search fails',async()=>{
  const d=setup();d.provider.search=async q=>{if(q.startsWith('hotels'))return [place('hotel')];throw new Error('Unavailable');};
  const r=await runLivePlan(d.input,d);expect(r.plan?.hotels).toHaveLength(1);expect(r.plan?.days.every(x=>!x.visits.length)).toBe(true);expect(r.plan?.generationStatus).toBe('incomplete');expect(d.model.select).not.toHaveBeenCalled();expect(r.message).toContain('two attempts');expect(r.message).toContain('activity data service failed both attempts');expect(r.plan?.generationIssue?.cause).toContain('Unavailable');
 });
 it('recovers activity discovery with a bounded fallback attempt',async()=>{
  const d=setup();let activityCalls=0;
  d.provider.search=vi.fn(async q=>{
   if(q.startsWith('hotels'))return [place('hotel')];
   if(q.startsWith('tourist')){activityCalls++;if(activityCalls<=6)throw new Error('Temporary activity timeout');return [place('attraction')];}
   if(q.includes('restaurants')||q.startsWith('evening'))return [];
   return [{...place('origin'),name:'Delhi',utcOffsetMinutes:330}];
  });
  const r=await runLivePlan(d.input,d);
  expect(activityCalls).toBe(8);
  expect(r.plan?.generationStatus).toBe('valid');
  expect(r.plan?.generationIssue).toBeUndefined();
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
  expect(hotel?.utcOffsetMinutes).toBe(330);
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

it('does not select a 25-hour round road journey that consumes the trip', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,travelMode:'cab',endTravelMode:'cab',pickupLocation:'Rohini, Delhi'},question:null});
 d.provider.travelRoutes=vi.fn(async (_a,_b,input): Promise<LiveTravelOption[]>=>[{schemaVersion:1,kind:'route_evidence',id:`${input.direction}-cab`,providerRouteId:null,direction:input.direction,mode:'drive',roadUse:'cab',label:'Cab route estimate',minutes:1505,meters:1528000,path:[],departureAt:'2026-09-08T02:30:00Z',arrivalAt:'2026-09-09T03:35:00Z',transitModes:[],transitLines:[],checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:'estimated'}]);
 const result=await runLivePlan(d.input,d);
 expect(result.plan?.travel?.outboundRoadPlan?.travelDays).toBe(3);
 expect(result.plan?.travel?.outboundRoadPlan?.status).toBe('not_feasible');
 expect(result.plan?.travel?.suggestedOutboundId).toBeNull();
 expect(result.plan?.days.every(day=>day.visits.length===0)).toBe(true);
 expect(result.plan?.warnings.join(' ')).toContain('Extend the dates');
 expect(result.plan?.generationIssue).toMatchObject({
  code: 'road_infeasible',
  retryable: false,
  journey: 'outbound',
  suggestedTravelModes: ['flight', 'train', 'bus', 'recommend'],
 });
 expect(result.plan?.generationIssue?.minimumTripDays).toBe(9);
});

it('keeps multi-day road travel days free of destination activities and meals', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,days:7,travelMode:'cab',endIntent:'end_at_destination',endTravelMode:null,pickupLocation:'Rohini, Delhi'},question:null});
 d.provider.travelRoutes=vi.fn(async (_a,_b,input): Promise<LiveTravelOption[]>=>[{schemaVersion:1,kind:'route_evidence',id:`${input.direction}-cab`,providerRouteId:null,direction:input.direction,mode:'drive',roadUse:'cab',label:'Cab route estimate',minutes:1488,meters:1521000,path:[],departureAt:'2026-09-08T02:30:00Z',arrivalAt:'2026-09-09T03:18:00Z',transitModes:[],transitLines:[],checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:'estimated'}]);
 const result=await runLivePlan(d.input,d);
 expect(result.plan?.travel?.outboundRoadPlan?.travelDays).toBe(3);
 expect(result.plan?.days[0]).toMatchObject({ visits: [], meals: [] });
 expect(result.plan?.days[1]).toMatchObject({ visits: [], meals: [] });
 expect(result.plan?.days[2].meals?.length).toBeGreaterThan(0);
 expect(result.plan?.days.slice(0,2).every(day=>day.legs.length===0)).toBe(true);
});

it('asks whether a journey-dominant drive is intended as a road trip', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,days:5,travelMode:'cab',endIntent:'end_at_destination',endTravelMode:null,pickupLocation:'Rohini, Delhi',roadTripConfirmed:false},question:null});
 d.provider.travelRoutes=vi.fn(async (_a,_b,input): Promise<LiveTravelOption[]>=>[{schemaVersion:1,kind:'route_evidence',id:`${input.direction}-cab`,providerRouteId:null,direction:input.direction,mode:'drive',roadUse:'cab',label:'Cab route estimate',minutes:1488,meters:1521000,path:[],departureAt:'2026-09-08T02:30:00Z',arrivalAt:'2026-09-09T03:18:00Z',transitModes:[],transitLines:[],checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:'estimated'}]);
 const result=await runLivePlan(d.input,d);
 expect(result.plan?.travel?.outboundRoadPlan).toMatchObject({ travelDays:3, destinationDaysRemaining:2, status:'road_trip' });
 expect(result.plan?.generationStatus).toBe('incomplete');
 expect(result.plan?.generationIssue).toMatchObject({ code:'road_confirmation', journey:'outbound', suggestedTravelModes:['flight','train','bus','recommend'] });
 expect(result.message).toContain('mainly a road trip');
 expect(result.message).toContain('Confirm that you want the journey itself');
});

it('searches outward and later journey modes independently', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,travelMode:'train',endTravelMode:'bus'},question:null});
 await runLivePlan(d.input,d);
 const requests=vi.mocked(d.provider.travelRoutes).mock.calls.map(call=>call[2]);
 expect(requests[0].transitModes).toEqual(['TRAIN','LIGHT_RAIL','RAIL','SUBWAY']);
 expect(requests[1].transitModes).toEqual(['BUS']);
});

it('does not invent a return journey when the trip ends at the destination', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,endIntent:'end_at_destination',endTravelMode:null},question:null});
 const result=await runLivePlan(d.input,d);
 expect(d.provider.travelRoutes).toHaveBeenCalledTimes(1);
 expect(result.plan?.travel?.return).toEqual([]);
 expect(result.plan?.days.at(-1)?.availableEndMinutes).toBe(1320);
});

it('constrains explicit train and bus preferences to their Google transit modes', async () => {
 for (const [travelMode, expectedModes] of [['train', ['TRAIN', 'LIGHT_RAIL', 'RAIL', 'SUBWAY']], ['bus', ['BUS']]] as const) {
  const d=setup();
  d.model.extract=async()=>({brief:{...brief,travelMode,endTravelMode:travelMode},question:null});
  await runLivePlan(d.input,d);
  const requests = vi.mocked(d.provider.travelRoutes).mock.calls.map(call => call[2]);
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.mode === 'transit')).toBe(true);
  expect(requests.every(request => JSON.stringify(request.transitModes) === JSON.stringify(expectedModes))).toBe(true);
 }
});

it('uses cab road evidence and requires an explicit cab pickup point', async () => {
 const missing=setup();missing.model.extract=async()=>({brief:{...brief,travelMode:'cab',endTravelMode:'cab',pickupLocation:null},question:null});
 const clarification=await runLivePlan(missing.input,missing);
 expect(clarification.message).toContain('cab pick you up');
 expect(missing.provider.search).not.toHaveBeenCalled();

 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:'cab',endTravelMode:'cab',pickupLocation:'India Gate, New Delhi'},question:null});
 await runLivePlan(d.input,d);
 const requests = vi.mocked(d.provider.travelRoutes).mock.calls.map(call => call[2]);
 expect(requests).toHaveLength(2);
 expect(requests.every(request => request.mode === 'drive' && request.roadUse === 'cab')).toBe(true);
});

it('compares transit and cab route evidence for Recommend Me without requiring a pickup point', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:'recommend',endTravelMode:'recommend',pickupLocation:null,preferences:'budget-friendly travel'},question:null});
 const result=await runLivePlan(d.input,d);
 const requests = vi.mocked(d.provider.travelRoutes).mock.calls.map(call => call[2]);
 expect(requests).toHaveLength(6);
 expect(requests.filter(request => request.mode === 'transit')).toHaveLength(4);
 expect(requests.filter(request => request.mode === 'drive' && request.roadUse === 'cab')).toHaveLength(2);
 expect(result.plan?.travel?.outbound.map(option => option.mode)).toEqual(['transit', 'drive']);
 expect(result.plan?.travel?.selectionReason).toContain('preserves the most usable trip time');
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

it('recommends transport automatically when no mode was stated', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:null},question:null});
 const r=await runLivePlan(d.input,d);
 expect(r.brief.travelMode).toBe('recommend');
 expect(r.plan?.generationStatus).toBe('valid');
 expect(d.provider.travelRoutes).toHaveBeenCalled();
});

it('chooses a flight automatically when it preserves more usable trip time', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:null,endTravelMode:null},question:null});
 const routeSearch=d.provider.travelRoutes;
 d.provider.travelRoutes=vi.fn(async (from,to,input):Promise<LiveTravelOption[]> => {
  const options=await routeSearch(from,to,input);
  return from.id.startsWith('iata:') || to.id.startsWith('iata:') ? options.map(option=>({...option,minutes:20})) : options;
 });
 const result=await runLivePlan(d.input,{...d,flightProvider:flightProvider()});
 expect(result.plan?.warnings.join('\n')).not.toContain('Flight comparison was unavailable');
 expect(result.brief).toMatchObject({travelMode:'recommend',endTravelMode:'recommend'});
 expect(result.plan?.flight?.suggestedOutboundId).toBe('recommended-flight-outbound');
 expect(result.plan?.flight?.suggestedReturnId).toBe('recommended-flight-return');
 expect(result.plan?.travel?.suggestedOutboundId).toBeNull();
 expect(result.message).toContain('prioritized the strongest available experience and usable time');
});

it('does not present an infeasible cab fallback as the traveller choice for Recommend Me', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,days:7,travelMode:null,endTravelMode:null},question:null});
 d.provider.travelRoutes=vi.fn(async (_from,_to,input):Promise<LiveTravelOption[]> => input.mode === 'drive'
  ? [{schemaVersion:1,kind:'route_evidence',id:`${input.direction}-cab`,providerRouteId:null,direction:input.direction,mode:'drive',roadUse:'cab',label:'Cab route estimate',minutes:3600,meters:2000000,path:[],transitModes:[],transitLines:[],checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:'estimated'}]
  : []);
 const unavailableFlights: FlightProvider = {search:vi.fn(async()=>({originHub:{code:'DEL',name:'Delhi Airport',latitude:28.56,longitude:77.1,countryCode:'IN'},destinationHub:{code:'JAI',name:'Jaipur Airport',latitude:26.82,longitude:75.8,countryCode:'IN'},outbound:[],returning:[],checkedAt:'2026-09-07T00:00:00Z',environment:'sandbox' as const,warnings:[]}))};
 const result=await runLivePlan(d.input,{...d,flightProvider:unavailableFlights});
 expect(result.plan?.generationIssue).toMatchObject({code:'road_infeasible',journey:'outbound'});
 expect(result.message).toContain('couldn’t find a practical recommended journey');
 expect(result.message).toContain('available cab route');
 expect(result.message).not.toContain('Travelling by cab safely');
});

it('uses a stated total budget to prefer an affordable known-price route over a faster flight', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,budget:{amount:6000,currency:'INR',scope:'total'},travelMode:null,endTravelMode:null},question:null});
 d.provider.travelRoutes=vi.fn(async (_a,_b,input):Promise<LiveTravelOption[]> => {
  if (input.mode === 'drive') return [{ schemaVersion:1,kind:'route_evidence',id:`${input.direction}-cab`,providerRouteId:null,direction:input.direction,mode:'drive',roadUse:'cab',label:'Cab',minutes:300,meters:250000,path:[],transitModes:[],transitLines:[],checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:'estimated' }];
  const train = Boolean(input.transitModes?.includes('TRAIN'));
  return [{ schemaVersion:1,kind:'route_evidence',id:`${input.direction}-${train?'train':'bus'}`,providerRouteId:null,direction:input.direction,mode:'transit',label:train?'Train':'Bus',minutes:train?360:420,meters:null,path:[],transitModes:[train?'TRAIN':'BUS'],transitLines:[],fare:{currency:'INR',amount:train?500:300},checkedAt:'2026-09-04T00:00:00Z',source:'Google Routes',timingKind:'scheduled' }];
 });
 const result=await runLivePlan(d.input,{...d,flightProvider:flightProvider()});
 expect(result.plan?.travel?.suggestedOutboundId).toBe('outbound-train');
 expect(result.plan?.flight?.suggestedOutboundId).toBeNull();
 expect(result.plan?.travel?.selectionReason).toContain('₹6,000 total budget');
 expect(result.message).toContain('of your ₹6,000 total budget');
});

it('recommends the onward journey independently when the trip continues elsewhere', async () => {
 const d=setup();d.model.extract=async()=>({brief:{...brief,travelMode:null,endIntent:'continue_elsewhere',onwardDestination:'Mumbai',endTravelMode:null},question:null});
 const routeSearch=d.provider.travelRoutes;
 d.provider.travelRoutes=vi.fn(async (from,to,input):Promise<LiveTravelOption[]> => {
  const options=await routeSearch(from,to,input);
  return from.id.startsWith('iata:') || to.id.startsWith('iata:') ? options.map(option=>({...option,minutes:20})) : options;
 });
 const search=vi.fn(async () => {
  const onward=search.mock.calls.length > 1;
  return {originHub:{code:onward?'JAI':'DEL',name:onward?'Jaipur Airport':'Delhi Airport',latitude:onward?26.82:28.56,longitude:onward?75.8:77.1,countryCode:'IN'},destinationHub:{code:onward?'BOM':'JAI',name:onward?'Mumbai Airport':'Jaipur Airport',latitude:onward?19.09:26.82,longitude:onward?72.87:75.8,countryCode:'IN'},outbound:[{...flightOffer('outbound'),id:onward?'recommended-onward-flight':'recommended-flight-outbound'}],returning:[],checkedAt:'2026-09-07T00:00:00Z',environment:'sandbox' as const,warnings:[]};
 });
 const result=await runLivePlan(d.input,{...d,flightProvider:{search}});
 expect(search).toHaveBeenCalledTimes(2);
 expect(result.plan?.flight?.suggestedOutboundId).toBe('recommended-flight-outbound');
 expect(result.plan?.flight?.suggestedReturnId).toBe('recommended-onward-flight');
 expect(result.plan?.flight?.endDestinationAirport?.airportCode).toBe('BOM');
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
 d.model.extract=async()=>({brief:{...brief,travelMode:'flight',endTravelMode:'flight',pickupLocation:'Saket, New Delhi'},question:null});
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

it('does not recommend a supplier flight whose availability is unknown', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,travelMode:'flight',endTravelMode:'flight',pickupLocation:'Saket, New Delhi'},question:null});
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[place('attraction')]:[{...place(q==='Jaipur'?'jaipur':'pickup'),name:q,lat:q==='Jaipur'?26.91:28.52,lng:q==='Jaipur'?75.79:77.2,utcOffsetMinutes:330}]);
 const unavailableFlight={schemaVersion:1 as const,kind:'supplier_offer' as const,id:'flight-unknown',serviceId:'service-unknown',mode:'flight' as const,from:'DEL',to:'JAI',departureAt:'2026-09-08T08:00:00+05:30',arrivalAt:'2026-09-08T09:00:00+05:30',durationMinutes:60,stops:0,operator:'Test Air',segments:[{mode:'flight' as const,from:'DEL',to:'JAI',departureAt:'2026-09-08T08:00:00+05:30',arrivalAt:'2026-09-08T09:00:00+05:30',operator:'Test Air',number:'TA1'}],price:{amount:2500,currency:'INR' as const,unit:'per_traveller' as const},availability:'unknown' as const,source:{provider:'Nuitée Connect Flights',providerOfferId:'provider-unknown',evidenceKind:'sandbox' as const,checkedAt:'2026-09-07T00:00:00Z'},booking:null};
 const flightProvider:FlightProvider={search:vi.fn(async()=>({originHub:{code:'DEL',name:'Delhi Airport',latitude:28.56,longitude:77.1,countryCode:'IN'},destinationHub:{code:'JAI',name:'Jaipur Airport',latitude:26.82,longitude:75.8,countryCode:'IN'},outbound:[unavailableFlight],returning:[],checkedAt:'2026-09-07T00:00:00Z',environment:'sandbox' as const,warnings:[]}))};
 const result=await runLivePlan(d.input,{...d,flightProvider});
 expect(result.plan?.flight?.suggestedOutboundId).toBeNull();
 expect(result.plan?.travel?.context).toBe('flight_fallback');
});

it('keeps outbound route fallbacks when the outward flight is unavailable and the later journey uses another mode', async () => {
 const d=setup();
 d.model.extract=async()=>({brief:{...brief,travelMode:'flight',endTravelMode:'bus',pickupLocation:'Saket, New Delhi'},question:null});
 d.provider.search=vi.fn(async q=>q.startsWith('hotels')?[place('hotel')]:q.startsWith('tourist')?[place('attraction')]:[{...place(q==='Jaipur'?'jaipur':'pickup'),name:q,lat:q==='Jaipur'?26.91:28.52,lng:q==='Jaipur'?75.79:77.2,utcOffsetMinutes:330}]);
 const flightProvider:FlightProvider={search:vi.fn(async()=>({originHub:{code:'DEL',name:'Delhi Airport',latitude:28.56,longitude:77.1,countryCode:'IN'},destinationHub:{code:'JAI',name:'Jaipur Airport',latitude:26.82,longitude:75.8,countryCode:'IN'},outbound:[],returning:[],checkedAt:'2026-09-07T00:00:00Z',environment:'sandbox' as const,warnings:[]}))};
 const result=await runLivePlan(d.input,{...d,flightProvider});
 expect(result.plan?.travel?.context).toBe('flight_fallback');
 expect(result.plan?.travel?.outbound.map(option=>option.label)).toEqual(['Bus','Self-drive','Cab route estimate']);
 expect(result.plan?.travel?.return.map(option=>option.label)).toEqual(['Bus']);
 expect(result.plan?.travel?.suggestedOutboundId).toBeNull();
 expect(result.plan?.travel?.suggestedReturnId).toBe('return-transit');
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

it('clears stale stay pricing when road-adjusted occupancy cannot be revalidated', async () => {
 const hotel: LivePlace = {
  ...place('hotel'),
  source:'Nuitée Connect',
  stayOffer:{
   schemaVersion:1,kind:'supplier_offer',id:'offer:stay:hotel',roomOfferId:'room',propertyId:'hotel',locationId:'nuitee:hotel:hotel',
   checkIn:'2026-09-08',checkOut:'2026-09-14',rooms:1,
   propertyFacts:{name:'Hotel',rating:4,reviewCount:10,amenities:[],accessibility:[],tags:[],imageAssetKey:'hotel',latitude:26,longitude:75},
   roomFacts:{roomLabel:'Double Room',maxOccupancy:2,mealPlan:'none',refundable:true},
   price:{amount:3000,currency:'INR',unit:'per_room_per_night'},totalPrice:{amount:18000,currency:'INR'},availability:'available',
   source:{provider:'Nuitée Connect',providerOfferId:'provider-offer',evidenceKind:'sandbox',checkedAt:'2026-09-06T16:00:00Z'},booking:null,
  },
 };
 const days=Array.from({length:7},(_,index)=>({date:`2026-09-${String(8+index).padStart(2,'0')}`,visits:[],meals:[],legs:[]}));
 const plan:LivePlan={
  brief:{...brief,startDate:'2026-09-08',days:7,travellers:2},hotels:[hotel],selectedHotelId:hotel.id,days,
  travel:{origin:place('origin'),destination:hotel,outbound:[],return:[],suggestedOutboundId:null,suggestedReturnId:null,selectionReason:'',assumptions:[],outboundRoadPlan:{direction:'outbound',roadUse:'cab',status:'feasible',rawDriveMinutes:900,plannedMinutes:1800,travelDays:3,destinationDaysRemaining:4,message:'',segments:[{dayOffset:0,date:'2026-09-08',driveMinutes:600,breakMinutes:60,mealBreaks:['lunch'],departureMinutes:480,arrivalMinutes:1140,overnightRestMinutes:720,breakStops:[]},{dayOffset:1,date:'2026-09-09',driveMinutes:240,breakMinutes:20,mealBreaks:[],departureMinutes:480,arrivalMinutes:740,overnightRestMinutes:0,breakStops:[]}] }},
  warnings:[],checkedAt:'2026-09-07T00:00:00Z',status:'provisional',totalCost:null,generationStatus:'incomplete',scheduling:{pace:'balanced',paceDefaulted:false,findings:[]},locks:{hotel:false,outboundFlight:false,returnFlight:false,outboundTravel:false,returnTravel:false,activityIds:[],mealKeys:[]},
 };
 const stayProvider:StayProvider={search:vi.fn(async()=>({environment:'sandbox' as const,checkedAt:'2026-09-07T00:00:00Z',assumptions:[],offers:[]}))};
 const warnings:string[]=[];
 await refreshDestinationStayForRoadDates(plan,hotel,{stayProvider},warnings);
 expect(hotel.stayOffer).toBeUndefined();
 expect(warnings.join(' ')).toContain('not returned when rechecked');
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

it('retains an explicit user date range when model extraction drops it', async () => {
 const d=setup();
 d.input.message='Plan a relaxed trip from Delhi to Darjeeling for two adults from 10 October 2026 to 13 October 2026.';
 d.model.extract=async()=>({brief:{...brief,destination:'Darjeeling',startDate:null,days:4,nightsConfirmed:false},question:'Please confirm your start date including the year.'});
 const result=await runLivePlan(d.input,d);
 expect(result.brief.startDate).toBe('2026-10-10');
 expect(result.brief.days).toBe(4);
 expect(result.brief.nightsConfirmed).toBe(true);
 expect(result.plan?.generationStatus).toBe('valid');
 expect(d.provider.search).toHaveBeenCalled();
});

it('retains and derives a nine-day explicit date range from chat', async () => {
 const d=setup();
 d.input.message='Plan a relaxed trip from Delhi to Darjeeling for two adults from 10 October 2026 to 18 October 2026.';
 d.model.extract=async()=>({brief:{...brief,destination:'Darjeeling',startDate:null,days:null,nightsConfirmed:false},question:'How many calendar days will you travel?'});
 const result=await runLivePlan(d.input,d);
 expect(result.brief.startDate).toBe('2026-10-10');
 expect(result.brief.days).toBe(9);
 expect(result.brief.nightsConfirmed).toBe(true);
 expect(result.plan?.days).toHaveLength(9);
 expect(result.plan?.days.at(-1)?.date).toBe('2026-10-18');
 expect(result.plan?.generationStatus).toBe('valid');
 expect(d.provider.search).toHaveBeenCalled();
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
