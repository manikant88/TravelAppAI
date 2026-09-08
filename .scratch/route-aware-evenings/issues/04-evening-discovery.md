# Discover optional evening experiences

Status: done

Blocked by: 02-day-rhythm.md, 03-time-window-validation.md

## Intended behavior

Discover destination-appropriate evening candidates and present them as an invitation
to refine the trip rather than silently placing them in the itinerary.

## Acceptance criteria

- Search terms reflect an explicit day rhythm when supplied.
- An unspecified or flexible preference discovers general evening experiences.
- Bars, clubs, casinos, and overnight activities are not auto-selected.
- The UI provides an accessible action that prepares a chat refinement.

## Validation approach

Run planner and UI rendering tests, then repository-wide checks.

## Comments

Implemented bounded preference-aware discovery and an optional workspace prompt that
prepares a chat refinement without inserting an evening selection into the itinerary.

Verified on 7 September 2026 with TypeScript, repository-wide ESLint, all 312 Vitest
tests, and the Next.js production build.
