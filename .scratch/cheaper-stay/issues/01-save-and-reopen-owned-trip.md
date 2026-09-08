# 01: Save and reopen an organizer-owned trip

Status: draft
Blocked by: none
Spec: ../spec.md

## What to build

An organizer signs in, saves an existing trip, and reopens the same canonical version after a page reload or a later session.

## Acceptance criteria

- [ ] Use verified identity and server-side ownership; choose the auth integration deliberately before implementation and document it.
- [ ] Load the trip from server storage by ID. Treat client data as a proposed input, never as authoritative ownership, permissions or totals.
- [ ] Preserve the existing trip/domain shape where practical while validating stored writes. Show save, loading, failure and retry states in the workspace.
- [ ] A second account and an unauthenticated caller cannot read or modify the private trip by guessing its ID.
- [ ] Use isolated test storage and separate runtime trip-write permissions from read-only supplier inventory; no changes to production data are authorized.

## Validation

Exercise save/read through the public application boundary with a real isolated database and verified-session test identities. Check persistence across separate requests, denied cross-account access and failed-write recovery.

## Comments

Proposed implementation breakdown. Review granularity and dependencies before marking ready.
