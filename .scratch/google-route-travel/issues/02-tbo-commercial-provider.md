# Qualify and integrate TBO commercial inventory

Status: draft

Blocked by: TBO account approval, commercial terms and test credentials

## Intended behavior

Add a supplier adapter for the TBO products that are contractually available to this
application, beginning with dated transport offers. Keep supplier offers separate from
Google route evidence and support a truthful search-to-handoff or search-to-book lifecycle.

## Acceptance criteria

- Confirm exact enabled products, India route/property coverage and API documentation.
- Confirm consumer display, caching, attribution, handoff and booking rights in writing.
- Define typed offer IDs, total price/currency, inclusions, availability, expiry and refresh.
- Reprice or revalidate an offer before selection/finalization.
- Distinguish no availability, unsupported route, expired offer and provider failure.
- Store no supplier secret in the client and log no traveller PII or credentials.
- Verify authenticated sandbox results before any production claim.

## Validation approach

- Contract tests against sanitized TBO sandbox fixtures.
- Bounded authenticated route/offer smoke tests after credentials are issued.
- Provider failure, expiry and reprice tests.
- Commercial checklist reviewed against the signed account terms.

## Comments

Created as the next provider slice while Google Routes supplies non-bookable road and
public-transit evidence. Implementation cannot begin until TBO confirms access and terms.
