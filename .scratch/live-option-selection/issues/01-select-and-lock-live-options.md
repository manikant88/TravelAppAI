# Select and lock live itinerary options

Status: done

Blocked by: none

## Intended behavior

Add session-scoped, server-validated stay, flight, Google route and activity selection
commands. Refresh affected routes and timeline dependencies atomically in the returned
plan, and prevent changes to explicitly locked selections.

## Acceptance criteria

- [x] Alternative stay and flight cards expose selection actions.
- [x] Selected stay and both flight directions expose independent locks.
- [x] Change actions open the established side drawer; alternatives never expand inside
  the itinerary timeline.
- [x] Drawer alternatives render through the same live flight, route, stay and activity
  card modules as their selected timeline counterparts rather than a separate row design.
- [x] Google route alternatives and observed activity candidates use the same drawer.
- [x] Drawer rows explain price, elapsed-time, arrival-time, and route-recalculation
  effects when the underlying evidence supports them.
- [x] Activity changes reject duplicate or regularly closed places and refresh the
  selected day's route chain.
- [x] Road-travel directions and individual activities expose session locks.
- [x] Unknown IDs, unavailable offers, expired offers and locked replacements fail
  without changing the prior client plan.
- [x] Stay changes refresh intercity, airport and daily local routes as applicable.
- [x] Flight changes refresh only the selected direction's airport transfers.
- [x] No booking, payment, Uber call or snapshot fallback is introduced.
- [x] TypeScript, ESLint, the full Vitest suite and production build pass; no automated
  browser tests are run.

## Validation

Pure selection-boundary tests plus repository-wide typecheck, lint, Vitest and build.
The pre-drawer suite passed 53 files and 294 tests. Focused drawer-boundary validation
passed 38 tests. A local manual browser check loaded without console errors, but the
transient sandbox responses for the tested dates did not contain a usable stay set, so
they could not render a live alternative drawer. The final repository-wide gates passed:
TypeScript, ESLint, production build, and 53 Vitest files with 298 tests. No automated
browser tests were run.

The visual follow-up removed the legacy compact drawer-row implementation and reused the
timeline card interfaces directly. Each card accepts an optional decision-impact note and
selection action, keeping provider evidence, photos, ratings, prices, source details and
responsive behavior in one implementation. TypeScript, repository-wide ESLint, all 298
tests and production build passed. Computer-use startup was unavailable for the final
visual inspection; no automated browser tests were run.

## Comments

Implemented the Phase 3 session selection boundary, inline flight alternatives, stay
The follow-up replaced all inline alternative expanders with the established inventory
drawer and extended server-validated selection to Google route and activity candidates.
