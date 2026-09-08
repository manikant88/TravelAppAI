import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoogleProvider } from '@/live/google.server';
const place = { id:'p1',displayName:{text:'Observed hotel'},location:{latitude:26,longitude:75},rating:4.4,userRatingCount:120,photos:[{name:'places/p1/photos/photo1',authorAttributions:[{displayName:'Photographer',uri:'//maps.google.com/contrib/1'}]}] };
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function mockResponses(photoOk=true,priceRange?:unknown) {
 vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY','private-test-key');
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({places:[{...place,priceRange}]})).mockResolvedValueOnce(photoOk?Response.json({photoUri:'https://lh3.googleusercontent.com/test-photo'}):Response.json({}, {status:404}));
 vi.stubGlobal('fetch',fetcher);return fetcher;
}
describe('live place card evidence',()=>{
 it('returns attributed photos without exposing the server key or inventing a price',async()=>{
  mockResponses();const [p]=await createGoogleProvider(new AbortController().signal).search('hotels',1,true);
  expect(p.photo?.authors).toEqual([{name:'Photographer',url:'https://maps.google.com/contrib/1'}]);expect(p.rating).toBe(4.4);expect(p.priceGuidance).toBeUndefined();expect(JSON.stringify(p)).not.toContain('private-test-key');
 });
 it('preserves the place when its photo request fails',async()=>{
  mockResponses(false);const [p]=await createGoogleProvider(new AbortController().signal).search('hotels',1,true);expect(p.id).toBe('p1');expect(p.photo).toBeUndefined();
 });
 it('keeps returned currency/range as guidance instead of a nightly price',async()=>{
  mockResponses(true,{startPrice:{currencyCode:'INR',units:'500'},endPrice:{currencyCode:'INR',units:'1000'}});
  const [p]=await createGoogleProvider(new AbortController().signal).search('hotels',1,true);expect(p.priceGuidance).toEqual({currency:'INR',min:500,max:1000});expect(p).not.toHaveProperty('nightlyPrice');
 });
 it('does not resolve photos for undisplayed attraction search candidates',async()=>{
  const fetcher=mockResponses();const [p]=await createGoogleProvider(new AbortController().signal).search('attractions',20);expect(fetcher).toHaveBeenCalledTimes(1);expect(p.photo).toBeUndefined();
 });
 it('preserves observed about details and only affirmative amenities',async()=>{
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY','private-test-key');
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({...place, editorialSummary:{text:'A historic city hotel.'}, websiteUri:'https://hotel.example/', goodForChildren:true, allowsDogs:false, parkingOptions:{freeParkingLot:true}, accessibilityOptions:{wheelchairAccessibleEntrance:true}})).mockResolvedValueOnce(Response.json({photoUri:'https://lh3.googleusercontent.com/test-photo'}));
  vi.stubGlobal('fetch',fetcher);
  const p=await createGoogleProvider(new AbortController().signal).details('p1');
  expect(p.editorialSummary).toBe('A historic city hotel.');
  expect(p.amenities).toEqual(['Good for children','Free parking lot','Wheelchair-accessible entrance']);
  expect(p.websiteUrl).toBe('https://hotel.example/');
  expect(fetcher.mock.calls[0][1].headers['X-Goog-FieldMask']).toContain('editorialSummary');
 });
 it('searches along an encoded Google route corridor',async()=>{
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY','private-test-key');
  const fetcher=vi.fn()
   .mockResolvedValueOnce(Response.json({routes:[{distanceMeters:12000,duration:'1200s',polyline:{geoJsonLinestring:{coordinates:[[75,26],[75.1,26.1]]}}}]}))
   .mockResolvedValueOnce(Response.json({places:[place]}));
  vi.stubGlobal('fetch',fetcher);
  const provider=createGoogleProvider(new AbortController().signal);
  const from={id:'a',name:'A',address:'',lat:26,lng:75,source:'Google Maps' as const,checkedAt:'',mapsUrl:'https://maps.google.com',attributions:[]};
  const result=await provider.searchAlongRoute!('vegetarian restaurants',from,{...from,id:'b',lat:26.1,lng:75.1},3);
  expect(result.directLeg).toMatchObject({fromId:'a',toId:'b',minutes:20,meters:12000});
  expect(result.places[0].id).toBe('p1');
  const body=JSON.parse(String(fetcher.mock.calls[1][1].body));
  expect(body).toMatchObject({textQuery:'vegetarian restaurants',pageSize:3,searchAlongRouteParameters:{polyline:{encodedPolyline:expect.any(String)}}});
  expect(body.searchAlongRouteParameters.polyline.encodedPolyline.length).toBeGreaterThan(4);
 });
});

describe('live intercity route evidence',()=>{
 it('preserves observed transit modes, schedule and missing fare',async()=>{
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY','private-test-key');
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({routes:[{
   distanceMeters:250000,duration:'21600s',polyline:{geoJsonLinestring:{coordinates:[[77.2,28.6],[75.8,26.9]]}},
   legs:[{steps:[{transitDetails:{stopDetails:{departureTime:'2026-09-08T02:45:00Z',arrivalTime:'2026-09-08T03:15:00Z'},transitLine:{nameShort:'Yellow Line',vehicle:{type:'SUBWAY'}}}},{transitDetails:{stopDetails:{departureTime:'2026-09-08T03:30:00Z',arrivalTime:'2026-09-08T08:45:00Z'},transitLine:{name:'Delhi Jaipur',vehicle:{type:'BUS'}}}}]}],
  }]}));
  vi.stubGlobal('fetch',fetcher);
  const provider=createGoogleProvider(new AbortController().signal);
  const from={id:'delhi',name:'Delhi',address:'',lat:28.6,lng:77.2,source:'Google Maps' as const,checkedAt:'',mapsUrl:'https://maps.google.com',attributions:[]};
  const to={...from,id:'jaipur',name:'Jaipur',lat:26.9,lng:75.8};
  const [route]=await provider.travelRoutes(from,to,{direction:'outbound',mode:'transit',departureTime:'2026-09-08T08:00:00+05:30'});
  expect(route).toMatchObject({label:'Subway + Bus',minutes:360,meters:250000,departureAt:'2026-09-08T02:45:00Z',arrivalAt:'2026-09-08T08:45:00Z',transitModes:['SUBWAY','BUS'],transitLines:['Yellow Line','Delhi Jaipur'],timingKind:'scheduled'});
  expect(route).not.toHaveProperty('fare');
  expect(fetcher.mock.calls[0][1].body).toContain('"travelMode":"TRANSIT"');
 });

 it('keeps a transit fare only when Google returns it',async()=>{
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY','private-test-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({routes:[{distanceMeters:10000,duration:'1800s',legs:[],travelAdvisory:{transitFare:{currencyCode:'INR',units:'125',nanos:500000000}}}]})));
  const provider=createGoogleProvider(new AbortController().signal);
  const from={id:'a',name:'A',address:'',lat:28,lng:77,source:'Google Maps' as const,checkedAt:'',mapsUrl:'https://maps.google.com',attributions:[]};
  const [route]=await provider.travelRoutes(from,{...from,id:'b'},{direction:'return',mode:'transit',departureTime:'2026-09-11T17:00:00+05:30'});
  expect(route.fare).toEqual({currency:'INR',amount:125.5});
 });

 it('derives explicitly estimated drive times from the requested departure',async()=>{
  vi.stubEnv('GOOGLE_MAPS_SERVER_API_KEY','private-test-key');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({routes:[{distanceMeters:120000,duration:'7200s',legs:[]}]})));
  const provider=createGoogleProvider(new AbortController().signal);
  const from={id:'a',name:'A',address:'',lat:28,lng:77,source:'Google Maps' as const,checkedAt:'',mapsUrl:'https://maps.google.com',attributions:[]};
  const [route]=await provider.travelRoutes(from,{...from,id:'b'},{direction:'outbound',mode:'drive',departureTime:'2026-09-08T08:00:00+05:30'});
  expect(route).toMatchObject({departureAt:'2026-09-08T08:00:00+05:30',arrivalAt:'2026-09-08T04:30:00.000Z',timingKind:'estimated'});
 });
});
