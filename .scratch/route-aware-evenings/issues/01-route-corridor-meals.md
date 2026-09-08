# Refine meals along the itinerary route

Status: done

Blocked by: none

## Intended behavior

Search lunch and dinner candidates along the Google route between their surrounding
itinerary anchors, retaining the direct-route baseline and fallback provenance.

## Acceptance criteria

- Corridor search receives a real encoded route polyline.
- Lunch and dinner retain their surrounding anchor IDs and search basis.
- Selected meal routes can report added travel against the direct route.
- Destination-wide candidates remain an explicit fallback.
- Dietary evidence and unverified-menu caveats remain unchanged.

## Validation approach

Run Google provider contract tests, planner tests, typecheck, lint, build, and the full
unit suite.

## Comments

Implemented with an encoded Google route polyline, bounded along-route Text Search,
anchor/direct-route evidence, adjacent-leg detour calculation, and a destination-wide
fallback.

Verified on 7 September 2026 with TypeScript, repository-wide ESLint, all 312 Vitest
tests, and the Next.js production build.
