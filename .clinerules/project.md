# jobgraph rules for Cline

Read ARCHITECTURE.md before changing anything. It is the source of truth for layout, conventions and the HTTP API.

## Non-negotiables
- The apply driver never clicks submit unless `ALLOW_REAL_SUBMIT=true` and the run was approved. Never weaken this.
- Never fabricate resume content. Every bullet must trace to graph node ids (`provenance`). The validator in `packages/core/src/tailor` enforces it; keep it.
- Every LLM-backed function must still work with no provider configured (heuristic path), so tests run offline.
- Secrets only from env. Never commit `.env`.

## Working style
- ESM TypeScript, Node 22, relative imports end in `.js`.
- Library code takes `db` as the first argument; apps call `getDb()` once.
- Tests are vitest files next to the code and use `openTestDb()`.
- Run `npm run typecheck` and `npm test` before finishing a task.
- Prefer sponsor tools where they fit: Parallel for search, extract and company research; Composio for Gmail, Slack, Google Sheets and Calendar; Cline for scheduled runs (`cline schedule`).
