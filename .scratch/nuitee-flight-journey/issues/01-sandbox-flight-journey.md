# Sandbox flight journey

Status: done

Blocked by: none

## Acceptance criteria

- A real DEL–JAI sandbox request returns canonical offers with supplier provenance.
- Intake and model extraction support an explicit flight preference.
- Flight pickup is collected before paid provider searches.
- First-mile and last-mile routes surround both outbound and return flights.
- Flight and transfer events appear inside the existing continuous timeline.
- Day 1 local timing derives from arrival at the stay.
- Unit tests cover normalization and the planner journey boundary.
- TypeScript, ESLint and Vitest pass; no automated browser tests are run.

## Comments

Implemented the server-only adapter, city-to-IATA resolution, canonical direct-flight
offers, flight intake, four Google road transfers, continuous timeline cards and map
focus. A real sandbox DEL–JAI run returned eight direct offers each way plus all four
transfers. TypeScript, ESLint, production build and 289 tests passed. No automated browser
tests were run.
