# 07: Validate live stay and routing access

Status: draft
Blocked by: none
Spec: ../spec.md

## What to build

Run a controlled, reproducible live evaluation for the Jaipur room-group example before committing to customer integration.

## Acceptance criteria

- [ ] Record evidence of production eligibility and permitted search, revalidation, handoff, AI processing and saved-data use.
- [ ] Obtain explicit authorization before account creation, commercial outreach, subscriptions or paid commitments; no credentials are entered into tickets.
- [ ] Check the same dates, party/room groups, taxes, meal/cancellation terms, exact property/location and handoff context against provider results.
- [ ] Distinguish supplier observation time from retrieval/cache time and verify permitted retention and deletion rules.
- [ ] Measure latency, failed calls, request consumption and total cost against the INR 15,000 target; document setup/minimum fees separately.
- [ ] Report pass/fail evidence and unverified gaps. Sandbox fixtures and consumer catalog pages are not proof of live availability.

## Validation

Access-dependent provider contract evaluation, not a mocked test or automated browser test. Use approved credentials and matched inputs; retain only permitted, sanitized evidence. Missing credentials is an explicit external blocker.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
