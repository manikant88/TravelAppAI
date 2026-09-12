# Domain documentation

Keep each kind of project context in one designated document. Git history preserves
superseded architecture and earlier handoff notes; do not copy them into new canonical
files.

## Document ownership

| File | Responsibility |
| --- | --- |
| `AGENTS.md` | Shared assistant instructions and required verification constraints. |
| `PROJECT_CONTEXT.md` | Product problem, principles, accepted scope, and non-goals. |
| `IMPLEMENTATION_SPEC.md` | Current technical contracts, state ownership, and data boundaries. |
| `AI_HANDOFF.md` | Concise current code map, continuation risks, and latest verification. |
| `README.md` | Human-facing overview, setup, commands, and smoke scenarios. |
| `CONTEXT.md` | Resolved domain vocabulary only. |
| `docs/adr/` | Decisions with meaningful reversal cost and non-obvious trade-offs. |
| `.scratch/<feature>/` | Feature acceptance history and actionable local tickets. |

## Reading rules

For routine implementation, read `AI_HANDOFF.md` first and only the relevant section of
`IMPLEMENTATION_SPEC.md`. Read `PROJECT_CONTEXT.md` when the work changes product scope,
experience principles, or customer behavior. Read `CONTEXT.md` and relevant ADRs when
the change touches an agreed term or recorded decision.

Before changing a feature with a `.scratch` spec, read its spec and active ticket. Follow
`docs/agents/issue-tracker.md` when creating or updating tickets.

Verify behavior in code when documents and implementation disagree. Reconcile the
canonical document that owns the decision. Put enduring rules in product context or the
implementation spec; keep the handoff limited to code navigation, active risks, and
current verification.

Create a glossary entry only after terminology is resolved. Create an ADR only when the
decision has meaningful reversal cost. Update the README when delivered setup or runtime
behavior changes.

User instructions, the repository's Next.js documentation rule, and the browser-test
restriction continue to apply. No per-module documentation hierarchy is needed for this
application.
