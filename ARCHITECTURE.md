# jobgraph architecture

A job-application agent built around a **career graph**. Find roles, research companies, tailor a one-page resume with provenance, fill ATS forms with review-before-submit, read verification codes from mail, track replies, and talk to the user over Slack, Telegram, WhatsApp, email, a dashboard, and MCP.

## Layout

```
packages/core/src
  db/           Drizzle schema (schema.ts), hand-written DDL (migrations.ts), getDb()/openTestDb() (client.ts)
  contracts.ts  Shared types every package codes against. Coordinator-owned.
  llm/          getLLM(): Anthropic or any OpenAI-compatible endpoint; withFallback() for heuristics
  graph/        career graph: skills dictionary, resume ingestion, subgraph retrieval, conversational facts
  feeds/        ATS feed pollers (greenhouse, lever, ashby, smartrecruiters), Parallel search/extract, normalize+upsert, requirement extraction
  research/     Parallel Task API company research with citations
  match/        job <-> graph scoring with explanation
  tailor/       baseline resume from graph, bullet rewrite with provenance, HTML template, PDF fitting loop, ATS checks
  runner/       application state machine (queued -> tailoring -> resume_review -> filling -> form_review -> submitting -> submitted)
packages/drivers/src   Playwright apply drivers (generic label-based filler, greenhouse first), fixtures/ for offline tests
packages/channels/src  Telegram (Bot API), Slack + Gmail + Sheets + Calendar through Composio, inbox classification and OTP extraction
apps/api               Hono HTTP API, SSE run events, MCP server at /mcp
apps/worker            runs the runner loop, feed polling, inbox polling, channel listeners
apps/web               Next.js dashboard
```

## Conventions

- ESM TypeScript, Node 22. Relative imports inside a package end in `.js` (`./schema.js`). Cross-package imports use `@jobgraph/core`, `@jobgraph/drivers`, `@jobgraph/channels` (aliases in root tsconfig and vitest.config).
- Run with `tsx`. Typecheck: `npm run typecheck`. Tests: `npm test` (vitest; files `*.test.ts` next to the code).
- Database: `getDb()` from `@jobgraph/core`. Tests use `openTestDb()` (in-memory PGlite) and never the shared handle.
- LLM: `getLLM()` and `withFallback(llmCall, heuristic, label)` from `@jobgraph/core`. Every LLM-backed function must work with no provider configured (heuristic path) so tests pass offline. Use `z` (zod) schemas for structured output.
- Secrets only via env. `.env.example` lists them. Never log keys.
- Keep functions pure where possible: take `db` as the first argument instead of calling `getDb()` inside library code (apps call `getDb()` once).
- Playwright: Chromium is installed. Use `chromium.launch({ headless: true })`. Write artifacts (PDFs, screenshots) under `data/artifacts/<id>/`.
- Sessions in the API (see Auth and onboarding). `DEFAULT_USER_EMAIL` is only a dev fallback when no cookie is present.
- No new root-level dependencies without need. Package-level deps go in that package's package.json; run `npm install -w <pkg> <dep>`.

## Env (see .env.example)

`DATABASE_URL` (optional), `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` / `OPENAI_COMPAT_MODEL` (Cline: `https://api.cline.bot/api/v1`, Ollama: `http://localhost:11434/v1`), `LLM_PROVIDER` override, `PARALLEL_API_KEY`, `COMPOSIO_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DEFAULT_USER_EMAIL`, `ALLOW_REAL_SUBMIT` (driver never clicks submit unless `true`), `API_PORT`, `WEB_URL`, `SENTRY_DSN_API` (API error reporting; `NEXT_PUBLIC_SENTRY_DSN` on the web side, tunnelled through `/monitoring`).

## Auth and onboarding

Sessions live in the API. The Next.js app proxies `/api/*` to the API through `rewrites` so the session cookie is same-origin. Cookie `jg_session`, httpOnly, SameSite=Lax, 30 days, value = random 32-byte token; the `sessions` table stores its sha256 hash, userId, expiresAt, userAgent. Passwords are scrypt-hashed (node:crypto, random 16-byte salt, N=16384). Every `/api/*` route except `/api/auth/*`, `/api/health`, `/api/webhooks/*` and `/mcp` requires a session; when `DEFAULT_USER_EMAIL` is set and no cookie is present, the API falls back to that user (dev convenience, logged once). Multi-user is the default shape: nothing is keyed on a global user.

Onboarding is a profile state machine. `profiles.onboarding` JSON holds `{ step: "resume"|"contact"|"authorization"|"screening"|"preferences"|"integrations"|"done", completedAt }`. The wizard can be resumed. Fields collected (all on `profiles`, new columns in migration 0002):
- contact: fullName, email, phone, location (city, state, country), linkedin, github, website, pronouns (optional)
- authorization: workAuth { authorizedUS, needsSponsorship, status: citizen|permanent_resident|visa|other, visaType }, willingToRelocate, remotePreference
- screening (the answers ATS forms always ask): heardAbout, salaryExpectation { amount, currency, period }, earliestStartDate, noticePeriodWeeks, eeo { gender, race, veteran, disability } each defaulting to "decline", securityClearance, over18
- preferences: titles, locations, remote, salaryMin, stages, excludeCompanies, resumeAutoApprove, reviewBeforeSubmit, autoApplyDailyCap, autoApplyMinScore
The runner's heuristic answerer reads these first.

```
POST /api/auth/signup        { email, password, name } -> { user }  (sets cookie)
POST /api/auth/login         { email, password } -> { user }        (sets cookie)
POST /api/auth/logout        -> 204
GET  /api/auth/session       -> { user } | 401
PUT  /api/onboarding         { step, data } -> { profile }  (merges data into the profile, advances step)
GET  /api/onboarding         -> { step, profile }
POST /api/profile/resume-file  multipart "file" (pdf, docx, txt) -> IngestResult + { contact, pages, layout, hadTextLayer, extractedChars }; 422 for scanned PDFs without a text layer
```

## HTTP API (apps/api), all JSON unless noted

```
GET  /api/health
GET  /api/me                                  -> { user, profile }
PUT  /api/profile                             body: partial profile incl. preferences + settings
POST /api/profile/resume                      { text } -> IngestResult
GET  /api/graph                               -> Graph
POST /api/graph/facts                         { text } -> { nodesCreated }
GET  /api/jobs?q=&limit=&minScore=&status=    -> [{ job, match }]
POST /api/jobs/discover                       DiscoverQuery -> { added: number, jobs: [...] }   (Parallel search)
POST /api/jobs/url                            { url } -> { job }                                   (feed parse or Parallel extract)
POST /api/jobs/poll                           { atsType, token } -> { added }                      (feed poller)
GET  /api/jobs/:id                            -> { job, match, company }
POST /api/jobs/:id/research                   -> { research }                                      (Parallel Task)
POST /api/applications                        { jobId } -> application
GET  /api/applications?status=                -> [{ application, job, resume? }]
GET  /api/applications/:id                    -> { application, job, resume, events, company }
POST /api/applications/:id/approve-resume
POST /api/applications/:id/approve-form       { answers? }
POST /api/applications/:id/answer             { answers }
POST /api/applications/:id/skip
POST /api/applications/:id/retry
GET  /api/applications/:id/events             text/event-stream of RunEvent
GET  /api/resumes/:id                         -> resume row
GET  /api/resumes/:id.pdf                     application/pdf
GET  /api/resumes/:id.html                    text/html
GET  /api/inbox                               -> inbox messages
POST /api/inbox/sync                          -> { imported }
GET  /api/tracker/stats                       -> { byStatus: Record<string, number>, thisWeek: {...} }
POST /api/tracker/sync-sheet                  -> { spreadsheetUrl }
GET  /api/channels                            -> linked channels
GET  /api/channels/telegram                   -> { configured, botUsername, linked }
POST /api/channels/telegram/link              -> { code, expiresAt, botUsername, link }   (send the code to the bot, or open `link`; the chat is then linked to this account)
GET  /api/integrations                        -> [{ toolkit, connected }]
POST /api/integrations/:toolkit/connect       -> { redirectUrl }
POST /mcp                                     MCP streamable HTTP (tools: find_jobs, research_company, tailor_resume, apply, status)
```

## Hackathon version (branch `hackathon`)

Headline: a personal job agent you talk to from your phone (Telegram, WhatsApp) or a small companion in the laptop menu bar or tray, that applies hands-free within lanes and a daily cap ("Auto apply"), runs on the operator's hosted model (every account, no keys to paste) or a local Ollama, and is fully open source.

Model tiers: `getLLM("quality")` for writing (bullets, answers, chat) and `getLLM("bulk")` for extraction and classification. There are no per-user keys (the `user_credentials` table from migration 0004 is dropped in 0010): resolution per user is hosted key (HOSTED_LLM_* env) > local Ollama if reachable > heuristics. Every call is counted in `llm_usage` (user, UTC day) and the hosted key is capped per user per day by `HOSTED_LLM_DAILY_TOKEN_CAP` (default 300000); past the cap the heuristic fallback runs until midnight UTC. `LOCAL_ONLY=1` forces Ollama and refuses cloud LLM calls.

Lanes: `profiles.preferences.lanes = [{ id, name, titles[], locations[], remote: "only"|"ok"|"no", minScore, enabled }]`. The agent tick considers every enabled lane, best matches first, drawing from one shared `autoApplyDailyCap`. A job qualifies for a lane when its title matches any lane title (case-insensitive substring or canonical skill) and location/remote constraints hold.

How a cycle stays fast and honest (`agentTick`, one at a time per user):
- Scoring uses an instant rules-only requirements pass (`jobs.requirements.via = "heuristic"`) and only for jobs that fit an enabled lane. A model call per job never finishes on a local model, and a job outside every lane can never be queued.
- Before a daily-cap slot is spent, a job that passes the rule checks gets one closer read by the model (`ensureRequirements(..., { upgrade: true })`, at most `maxUpgrades` per cycle, default 8). Score, lane and checks are then re-evaluated. Tailoring and form filling also upgrade.
- Every model call has a deadline (`LLM_TIMEOUT_MS`, default 180000); on timeout the heuristic fallback runs. Local Ollama models get `reasoning_effort` off for extraction (thinking models are about 10x slower) and a context-window guard: a prompt that will not fit `OLLAMA_CONTEXT_LENGTH` (probed from `/api/ps`, or `OLLAMA_NUM_CTX`) falls back at once instead of returning cut-off JSON.
- Gate extras: entry-level titles (intern, new grad, early career, junior) are skipped for someone with 3+ years; one application per company and title.
- `TickSummary.note` says in one sentence why nothing was queued (cap 0, no lane, no job fits, below the score bar, all skipped).

Single process: `npm run demo` starts the API with the scheduler and channel listeners inside it (`EMBED_WORKER=1`), so the embedded database has one owner.

```
GET  /api/settings/model              -> { mode, source: "hosted"|"local"|"none", tiers, localOnly, usage: { totalTokens, capTokens, remainingTokens, exhausted, resetsAt } } (read-only)
GET  /api/lanes                       -> Lane[]
PUT  /api/lanes                       Lane[] -> Lane[]
GET  /api/graph/export                -> application/json download of nodes + edges + profile (no credentials)
GET  /api/agent/status                adds { mode, lanes: [{ id, name, enabled, queuedToday }], liveSubmit } (liveSubmit false = dry run: forms are filled, nothing is sent)
POST /api/agent/tick                  runs one cycle and waits; returns the TickSummary (scripts, scheduler)
POST /api/agent/tick?quick=1          starts the cycle in the background, 202 { running, startedAt } (the Run now button; a cycle can outlast any proxy)
GET  /api/agent/tick                  -> { running, startedAt?, last?: TickSummary, error? }
GET  /companion                       (web) compact view for the tray popover: status line, waiting-on-you with Approve/Skip, chat box; 360x560
```
Cline as the hosted provider: base URL `https://api.cline.bot/api/v1`, OpenAI-compatible `/chat/completions`, bearer = the operator's Cline API key. Default quality model `deepseek/deepseek-v4-pro`, bulk `qwen/qwen3.7-plus`.
