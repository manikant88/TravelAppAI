import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyLiveBrief, type LiveBrief } from '@/live/contracts';
import { batchEssentialAnswerMessage, batchRecoveryAnswerMessage, currentLocationAnswer, draftFromBrief, liveBriefUpdateMessage, LiveTripBriefBar, LiveTripEssentials, livePlanningRecoveryActions, stageEssentialAnswer, stageRecoveryAnswer, stagedEssentialAnswerCount } from '@/ui/live-trip-essentials';

const waitingForTravel: LiveBrief = {
  ...emptyLiveBrief,
  origin: 'Delhi',
  destination: 'Darjeeling',
  startDate: '2026-10-10',
  days: 4,
  travellers: 2,
  nightsConfirmed: true,
  endIntent: 'return_to_origin',
  endTravelMode: 'public_transit',
  pace: 'relaxed',
  preferences: 'hills, tea, heritage',
};

describe('live Trip Essentials', () => {
  it('renders only pending requirements', () => {
    const markup = renderToStaticMarkup(<LiveTripEssentials brief={waitingForTravel} busy={false} onEdit={vi.fn()} onSubmit={vi.fn()} />);
    expect(markup).not.toContain('Travel preference');
    expect(markup).not.toContain('Starting city');
    expect(markup).not.toContain('Destination or recommendations');
    expect(markup).not.toContain('Travel dates and hotel nights');
    expect(markup).not.toContain('Traveller details');
  });

  it('stages recommendation chips for one combined update', () => {
    const markup = renderToStaticMarkup(<LiveTripEssentials brief={{ ...waitingForTravel, travellers: null }} busy={false} onEdit={vi.fn()} onSubmit={vi.fn()} />);
    expect(markup).toContain('Apply answers');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('Choose all the answers you want to add');
    const travel = { label: 'Cab', message: 'I prefer a private cab.' };
    const returnMode = { label: 'Train', message: 'I want to take a train after Darjeeling.' };
    let answers = stageEssentialAnswer({}, 'transport', travel);
    answers = stageEssentialAnswer(answers, 'end_transport', returnMode);
    expect(stagedEssentialAnswerCount(answers)).toBe(2);
    expect(batchEssentialAnswerMessage(answers)).toBe('Update these Trip Essentials together: I prefer a private cab. I want to take a train after Darjeeling.');
    answers = stageEssentialAnswer(answers, 'transport', travel);
    expect(stagedEssentialAnswerCount(answers)).toBe(1);
  });

  it('labels seasonal guidance as provisional and offers its exact range as an answer', () => {
    const markup = renderToStaticMarkup(<LiveTripEssentials
      brief={{ ...waitingForTravel, startDate: null, nightsConfirmed: false }}
      busy={false}
      dateGuidance={{ status: 'provisional', evidenceKind: 'model_general_guidance', startDate: '2027-03-22', endDate: '2027-03-28', days: 7, summary: 'Late March is generally suitable for this trip.', bookingGuidance: 'Check live fares before deciding when to book.' }}
      onEdit={() => undefined}
      onSubmit={() => undefined}
    />);
    expect(markup).toContain('Provisional seasonal guidance');
    expect(markup).toContain('Current weather, prices, availability, events and closures have not been verified');
    expect(markup).toContain('Use 22 Mar–28 Mar');
    expect(markup).toContain('Check live fares before deciding when to book.');
  });

  it('uses staged choices to reveal dependent essentials before applying', () => {
    const answers = stageEssentialAnswer({}, 'transport', { label:'Flight', message:'I prefer to fly.', patch:{ travelMode:'flight' } });
    const effective = Object.values(answers).reduce<LiveBrief>((current, answer) => ({...current,...answer?.patch}), {...waitingForTravel,travelMode:null});
    expect(effective).toMatchObject({ travelMode:'flight',endIntent:'return_to_origin' });
  });

  it('does not highlight Preferences when automatic travel recommendation is available', () => {
    const markup = renderToStaticMarkup(<LiveTripBriefBar brief={waitingForTravel} busy={false} onEditingChange={vi.fn()} onSubmit={vi.fn()} onPrefill={vi.fn()} />);
    expect(markup).not.toMatch(/class="trip-fact trip-fact-empty essential-missing"[^>]*><span>Preferences<\/span>/);
    expect(markup).not.toMatch(/essential-missing[^>]*><span>From city<\/span>/);
  });

  it('describes only the Trip Brief fields that changed', () => {
    const dates = { ...draftFromBrief(waitingForTravel), end: '2026-10-20' };
    const dateMessage = liveBriefUpdateMessage(waitingForTravel, dates);
    expect(dateMessage).toBe('Update my Trip Brief: change my travel dates to 2026-10-10 through 2026-10-20 (11 calendar days and 10 hotel nights, checking out on 2026-10-20).');
    expect(dateMessage).not.toContain('starting city');
    expect(dateMessage).not.toContain('destination is');
    expect(dateMessage).not.toContain('travellers total');
    expect(dateMessage).not.toContain('relaxed');

    const preference = { ...draftFromBrief(waitingForTravel), travel: 'cab' as const };
    expect(liveBriefUpdateMessage(waitingForTravel, preference)).toBe('Update my Trip Brief: change my outward travel preference: I prefer a private cab.');
  });

  it('keeps Preferences highlighted when a cab pickup point is pending', () => {
    const markup = renderToStaticMarkup(<LiveTripBriefBar brief={{ ...waitingForTravel, travelMode: 'cab' }} busy={false} onEditingChange={vi.fn()} onSubmit={vi.fn()} onPrefill={vi.fn()} />);
    expect(markup).toMatch(/class="trip-fact trip-fact-empty essential-missing"[^>]*><span>Preferences<\/span>/);
  });

  it('keeps a failed generation in Trip Essentials with recovery choices', () => {
    const readyBrief = { ...waitingForTravel, travelMode: 'self_drive' as const, pickupLocation: 'Delhi city centre' };
    const planningIssue = { code: 'no_activities' as const, message: 'I found a stay, but not enough activities for a useful itinerary.' };
    const markup = renderToStaticMarkup(<LiveTripEssentials brief={readyBrief} busy={false} planningIssue={planningIssue} onEdit={vi.fn()} onSubmit={vi.fn()} />);
    expect(markup).toContain('Let’s adjust this trip');
    expect(markup).toContain(planningIssue.message);
    expect(markup).toContain('Broaden the activity mix');
    expect(markup).toContain('Give the itinerary more time');
    expect(markup).toContain('Add 1 day · until 14 Oct');
    expect(markup).not.toContain('Build my trip');
    const recovery = livePlanningRecoveryActions({ code: 'road_infeasible', message: 'Too far.', journey: 'outbound', minimumTripDays: 6, suggestedTravelModes: ['flight', 'train', 'recommend'] }, readyBrief);
    expect(recovery.map(action => action.label)).toEqual(['Choose a practical travel mode', 'Extend the trip to fit the journey']);
    expect(recovery[0].options.map(option => option.label)).toEqual(['Fly outbound instead', 'Take a train outbound', 'Let the planner choose faster travel']);
  });

  it('only offers retry when the failed operation could return a different result', () => {
    const readyBrief = { ...waitingForTravel, travelMode: 'cab' as const, pickupLocation: 'Delhi city centre' };
    const deterministic = livePlanningRecoveryActions({
      code: 'blocking_constraints',
      message: 'The current dates do not fit.',
      retryable: false,
      minimumTripDays: 6,
      journey: 'outbound',
      suggestedTravelModes: ['flight'],
    }, readyBrief);
    expect(deterministic.map(action => action.label)).toEqual(['Reconsider the long road journey', 'Extend the trip to fit the journey']);
    expect(deterministic.some(action => action.label.toLowerCase().includes('try again'))).toBe(false);

    const transient = livePlanningRecoveryActions({ code: 'no_stays', message: 'Stay search timed out.', retryable: true }, readyBrief);
    expect(transient.at(-1)).toMatchObject({ label: 'Retry the stay search' });
    expect(transient.at(-1)?.description).toContain('search did not finish');
  });

  it('stages recovery chips and omits date extensions at the planning limit', () => {
    const maxLengthBrief = { ...waitingForTravel, days: 14, travelMode: 'cab' as const, pickupLocation: 'Delhi city centre' };
    const actions = livePlanningRecoveryActions({ code: 'no_activities', message: 'Activity search timed out.', retryable: true }, maxLengthBrief);
    expect(actions.map(action => action.label)).toEqual(['Retry the activity search']);
    expect(actions.some(action => action.label.includes('time'))).toBe(false);
    const markup = renderToStaticMarkup(<LiveTripEssentials brief={maxLengthBrief} busy={false} planningIssue={{ code: 'no_activities', message: 'Activity search timed out.', retryable: true }} onEdit={vi.fn()} onSubmit={vi.fn()} />);
    expect(markup).not.toContain('Nature &amp; viewpoints');
    expect(markup).toContain('Search for activities again');
    expect(markup).toContain('Apply answers');

    const selected = stageRecoveryAnswer({}, 'Retry the activity search', actions[0].options[0]);
    expect(batchRecoveryAnswerMessage(selected)).toContain('Repeat the live searches');
  });

  it('offers faster modes or explicit road-trip confirmation when driving dominates', () => {
    const roadBrief = { ...waitingForTravel, travelMode: 'cab' as const, pickupLocation: 'Delhi city centre' };
    const actions = livePlanningRecoveryActions({ code: 'road_confirmation', message: 'This would mainly be a road trip.', journey: 'outbound', suggestedTravelModes: ['flight', 'train', 'bus', 'recommend'] }, roadBrief);
    expect(actions).toHaveLength(1);
    expect(actions[0].options.map(option => option.label)).toEqual(['Fly outbound instead', 'Take a train outbound', 'Take a bus outbound', 'Let the planner choose faster travel', 'Keep cab · make it a road trip']);
    expect(actions[0].description).toContain('use much of the available trip');
  });

  it('does not require a second build click once every essential is ready', () => {
    const readyBrief = { ...waitingForTravel, travelMode: 'public_transit' as const };
    const markup = renderToStaticMarkup(<LiveTripEssentials brief={readyBrief} busy={false} onEdit={vi.fn()} onSubmit={vi.fn()} />);
    expect(markup).not.toContain('Build my trip');
    expect(markup).not.toContain('Preparing your itinerary');
    expect(markup).toBe('');
  });

  it('turns an approved browser location into an explicit pickup answer', () => {
    expect(currentLocationAnswer(28.613939, 77.209021)).toEqual({
      label: 'My current location',
      message: 'Use my current location (28.61394,77.20902) as my starting point.',
      patch: { pickupLocation: '28.61394,77.20902' },
    });
  });
});
