# Phase 6 completion

## Accepted behavior

Complete the accepted Phase 6A–6I capacity-aware scheduling plan. Provider or manual
fixed timing remains exact, outdoor activities retain difficulty and daylight planning
constraints, and the live planner discovers a diverse bounded candidate pool before
enriching only the scheduled shortlist.

All itinerary changes use the same deterministic scheduler as initial planning and
return a structured impact containing moved items, transfer changes, meal changes,
usable-time change, findings and confirmation requirements. Overridable warnings require
confirmation. Non-overridable conflicts are rejected without mutating the itinerary.

The timeline explains fixed versus estimated timing, combined meal evidence, meaningful
free time, affected constraints and capacity decisions. The final implementation is
verified with deterministic unit, planner, selection and browser scenarios.

## Scope boundary

This work completes the scheduler and selection behavior required by Phase 6. Creating
user-authored itinerary items, supplier booking, cross-midnight occupancy and overnight
self-drive remain in their existing future-scope tickets.
