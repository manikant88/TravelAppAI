# Capture an optional day rhythm

Status: done

Blocked by: none

## Intended behavior

Retain explicit early-night, evening, nightlife, overnight-adventure, or flexible intent
without making the preference a prerequisite for initial planning.

## Acceptance criteria

- Existing briefs remain schema-valid with a null preference.
- The model only sets the preference from traveller language.
- Missing preference does not block provider searches.
- Early-night preference suppresses evening discovery.

## Validation approach

Run brief-schema and live-planner tests plus repository checks.

## Comments

Implemented as an optional brief value with model instructions that prohibit demographic
inference and prohibit blocking the initial plan for this preference.

Verified on 7 September 2026 with TypeScript, repository-wide ESLint, all 312 Vitest
tests, and the Next.js production build.
