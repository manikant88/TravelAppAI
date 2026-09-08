# Domain documentation

This is a single-context application. Keep each kind of information in its designated document.

## Document ownership

| File | Responsibility |
| --- | --- |
| `AGENTS.md` | Shared assistant instructions, Next.js documentation requirement, verification constraints, and pointers. |
| `CLAUDE.md` | Imports `AGENTS.md` and records Matt Pocock skill configuration. |
| `PROJECT_CONTEXT.md` | Product problem, users, principles, accepted scope, and non-goals. |
| `IMPLEMENTATION_SPEC.md` | Technical contracts, state ownership, data boundaries, and implementation requirements. |
| `AI_HANDOFF.md` | Dated implementation observations, continuation notes, and recorded verification. |
| `README.md` | Human-facing overview, setup, and operating instructions for the application as it exists. |
| `CONTEXT.md` | Domain glossary only: agreed terms and distinctions, without implementation plans. |
| `docs/adr/` | Decisions with meaningful reversal cost, non-obvious reasoning, and real trade-offs. |
| `.scratch/<feature>/` | Proposed feature specs, actionable tickets, acceptance criteria, and progress. |

## Reading rules

Before product or architecture work, read `PROJECT_CONTEXT.md`, the relevant sections of `IMPLEMENTATION_SPEC.md`, and `AI_HANDOFF.md`. Read `CONTEXT.md` and relevant ADRs when they exist. Create the glossary only when a term is resolved, and create an ADR only when a decision merits one; missing files do not block work.

Use agreed glossary terms in specs, code discussions, and tests. Read the relevant feature spec and ticket before implementation.

## Transition from prototype to product

The accepted direction is a product for actual customers. The product and technical documents distinguish that direction from the existing implementation baseline. Historical P0 restrictions and P1/P2 priorities must not dictate customer requirements. Specific launch capabilities, providers, ownership, and booking responsibility remain discovery decisions; none is implemented merely by updating the scope.

Keep the baseline documents in place during discovery. Capture proposed changes in feature specs. Once the user accepts a new scope, revise affected sections of the canonical documents together and identify which prior assumptions are superseded. Git history preserves earlier versions; avoid copying whole documents into parallel authoritative versions.

`PROJECT_CONTEXT.md` currently delegates specific behavior decisions to the dated handoff. Honor that explicit delegation, but do not treat every handoff note as a blanket override of product or technical contracts. Surface other conflicts, verify actual behavior in code when relevant, and reconcile affected documents with the accepted decision.

Keep enduring contracts in the product/spec documents rather than accumulating permanent overrides in the handoff. Keep verification results dated and distinguish historical results from checks performed for current work. Update the README when delivered behavior or setup changes.

## Skill use

User instructions and the repository's existing Next.js and browser-test requirements continue to apply. Use the local issue tracker conventions in `docs/agents/issue-tracker.md`. No `CONTEXT-MAP.md` or per-module documentation hierarchy is needed for this application.
