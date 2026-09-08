<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project continuation

Read `PROJECT_CONTEXT.md` and the relevant sections of `IMPLEMENTATION_SPEC.md`.

Read `AI_HANDOFF.md` before changing existing behavior. Before product discovery, architecture work, or documentation changes, read `docs/agents/domain.md` for document ownership and conflict handling. Before working with specs or tickets, read `docs/agents/issue-tracker.md`.

Do not run automated browser tests unless the user explicitly asks for them.
