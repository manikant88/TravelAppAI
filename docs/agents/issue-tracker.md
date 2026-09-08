# Issue tracker: Local Markdown

Specs and tickets live in this repository. Publishing to the issue tracker means writing local Markdown files, not creating GitHub issues.

## Layout

- One feature directory: `.scratch/<feature-slug>/`.
- Feature specification: `.scratch/<feature-slug>/spec.md`.
- One file per ticket: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` within the feature.
- Identify tickets by their feature directory and number or full path.

## Ticket fields

Record the title, `Status:`, `Blocked by:`, intended behavior, acceptance criteria, and validation approach. Use `draft`, `ready`, `in-progress`, `blocked`, or `done` for status. Dependencies reference ticket paths; use `none` when there are no dependencies. Begin work on a ready ticket only when its dependencies are done.

Append discussion under `## Comments`. Before marking a ticket done, record what was implemented and the verification actually performed. Historical test results do not count as verification of new work.

## Scope

Feature specs describe proposed work until accepted by the user. Keep unresolved product choices explicit. When an accepted change supersedes a project contract, update the affected canonical document as part of the work.

The `triage` skill is not installed, so no triage-label configuration is required. These statuses describe local ticket progress rather than triage roles.
