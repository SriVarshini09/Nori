# Handoff: continuing Nori from 24 October 2026

For the next Claude session (or person) picking this up in a fresh clone. Everything below was true at about 09:00 UTC on 24 October 2026. Read this, then `docs/ROADMAP.md` (what to build and how each stage is proven) and `docs/VERIFIED.md` (what has actually run). `ARCHITECTURE.md` has the layout and the HTTP API.

## What Nori is now

A subscription job agent, not a demo. Every account runs on Nori's hosted model (no bring-your-own-key; that was removed in PR 10), with a per-user daily token allowance (PR 9). The repo is `SriVarshini09/Nori` (private). The owner is Sri Varshini (GitHub SriVarshini09); they are not technical with the terminal, so give exact steps, do the fiddly parts, one step at a time, and let them do dashboard clicks from screenshots.

## Where it runs

| Part | Where | How to deploy |
|---|---|---|
| API + worker | Fly.io app `jobgraph-api-norinote`, region sjc, one machine, Docker, embedded worker. Domain `api.norinote.xyz`. Health: `https://api.norinote.xyz/api/health` | From the repo root on a machine where `flyctl` is logged in: `flyctl deploy --remote-only -a jobgraph-api-norinote`. Takes 3 to 4 minutes. Migrations run on boot. Fly was logged in as kanaparthiprembabu@gmail.com on the previous machine; a new machine needs `flyctl auth login` by whoever owns that account. |
| Dashboard | Vercel project `nori` on the owner's own Vercel account (Hobby), imported from GitHub, root `apps/web`, env `API_URL` and `NEXT_PUBLIC_API_URL` = `https://api.norinote.xyz`. Domain `jobs.norinote.xyz` | Automatic on every push to `main`. Vercel posts a commit status named "Vercel"; check with `gh api repos/SriVarshini09/Nori/commits/<sha>/status`. |
| Database | Neon Postgres (`DATABASE_URL` on Fly) | Nothing to do |
| DNS | Spaceship (launch1/launch2.spaceship.net) for norinote.xyz | Owner edits records there |
| Email | Resend, domain norinote.xyz verified (DKIM, two sending CNAMEs, DMARC) | Key on Fly |
| Telegram | Bot @NoriNoteBot, token on Fly | People link a chat from Settings, Channels, with a one-time code (PR 12) |

Fly secrets set: `APP_SECRET CREDENTIALS_KEY DATABASE_URL WEB_URL ARTIFACTS_DIR PGLITE_DIR MCP_TOKEN MCP_USER_EMAIL HOSTED_LLM_PROVIDER HOSTED_LLM_BASE_URL HOSTED_LLM_API_KEY HOSTED_LLM_QUALITY_MODEL HOSTED_LLM_BULK_MODEL RESEND_API_KEY EMAIL_FROM TELEGRAM_BOT_TOKEN PARALLEL_API_KEY`. The model is OpenAI gpt-4.1 (quality) and gpt-4.1-mini (bulk). Daily cap per user defaults to 300,000 tokens (`HOSTED_LLM_DAILY_TOKEN_CAP`, not set, so default).

## The `.env` file is not in git

It must be copied by hand to the new machine (it is gitignored). Variables it held, values with the owner: `HOSTED_LLM_PROVIDER=openai-compatible`, `HOSTED_LLM_BASE_URL=https://api.openai.com/v1`, `HOSTED_LLM_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM=Nori <hello@norinote.xyz>`, `TELEGRAM_BOT_TOKEN`, `SMTP_URL` (an older Gmail SMTP login, unused once Resend is set). The old file had Windows line endings; strip `\r` when reading values in a shell. Never paste a key into chat; the owner puts it in `.env` and the session reads it from disk.

## Open pull requests

- [#13](https://github.com/SriVarshini09/Nori/pull/13) `docs/verified-telegram`: adds the Telegram row to `docs/VERIFIED.md`. Docs only. Merge.
- [#14](https://github.com/SriVarshini09/Nori/pull/14) `fix/dependabot`: vitest 3 → 4.1.12, overrides for body-parser and fast-uri; closes all 7 Dependabot alerts; full gate passed. Merge, then the next Fly deploy carries it.

`main` is at `c7a98df` (merge of PR 12).

## Stage 0 status (see ROADMAP.md)

Proven on the live site on 24 October: hosted model, daily cap shown in Settings, bring-your-own-key removed, dashboard deploying from main, account email arrives and its link works, Telegram linked from the owner's phone and answering `status`.

Left, in order:

1. **Sentry and uptime.** The owner was creating two Sentry projects, `nori-api` (Node) and `nori-web` (Next.js), and putting their DSNs in `.env` as `SENTRY_DSN_API` and `SENTRY_DSN_WEB`. Nothing is wired in code yet. Plan: `@sentry/node` in `apps/api` (init in `apps/api/src/index.ts` when the DSN is set; capture unhandled errors and failed runner steps), `@sentry/nextjs` in `apps/web`; push both DSNs to Fly and Vercel; send one deliberate test error from each and confirm it appears. Uptime: a Better Stack monitor on `https://api.norinote.xyz/api/health` alerting the owner's email, nothing in code.
2. **Staging app on Fly** (`jobgraph-api-staging`) so changes are tried before production. Copy the secrets except `DATABASE_URL` (use a Neon branch) and `TELEGRAM_BOT_TOKEN` (two pollers on one bot token fight; leave Telegram off on staging).
3. **Phone walk-through**, the Stage 0 finish line: on a phone that has never seen the site, sign up, confirm email, upload a resume, open a job, apply, review the tailored diff, review the filled form, approve (dry run). Fix what breaks. This is also the rehearsal for the hackathon judges.

Then Stage 1 (PWA and Web Push, Google sign-in) and Stage 2 (Browserbase, CAPTCHA hand-off, first real Greenhouse submission), per ROADMAP.md.

## Known problems

- `PARALLEL_API_KEY` on Fly is invalid: every agent tick logs `Parallel search failed: 401`. Web discovery is off; ATS feeds still run. Either a fresh key from platform.parallel.ai or leave it (roadmap moves discovery to context.dev and Exa anyway).
- Vercel suggests changing the `jobs` CNAME at Spaceship to `6423c8db20d10506.vercel-dns-017.com.`; the old `cname.vercel-dns.com` still works.
- One pre-existing lint warning in `apps/web/src/lib/api.ts` (window.location.assign). Harmless.
- Real submission has never run (`ALLOW_REAL_SUBMIT` off). Lever and Ashby always hit a CAPTCHA; SmartRecruiters blocks bots. See `docs/LIVE-DRYRUN.md`.
- Resend's sending-only key cannot list domains (401 on that endpoint is expected).

## How work is done here

- Every change on its own branch (`feat/...`, `fix/...`, `docs/...`), pushed, with a PR into `main`. The owner merges. Never push to `main`.
- Before opening a PR, run the full gate from the repo root: `node scripts/gate.mjs` (about 7 minutes; stop local dev servers first). It runs typecheck, unit and API tests, the same on PostgreSQL 17, web lint, production build, a crawl of every page, and the browser journey twice. Post the result as a PR comment.
- Local dev: API `npx tsx apps/api/src/index.ts` on :4000 (uses `.env`, embedded PGlite under `./data`, does not poll Telegram unless `EMBED_WORKER=1`), web `npm run dev --workspace apps/web` on :3000. `.claude/launch.json` has both.
- Never create an account on the production site. For a signed-in check of the live dashboard, the owner signs in on a shared browser pane and the session reads the page.
- `docs/VERIFIED.md` records what ran for real, per stage. A roadmap stage counts as done only when its "proven when" lines actually ran.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; PR bodies end with the Claude Code attribution line.

## The hackathon

Agent Builders Hackathon by Omnara, Saturday 24 October 2026, 10:00 to 20:00 PDT, 639 Howard St, San Francisco. Building 11:00 to 17:30, demos 18:00, awards 18:45. Devpost: https://agent-builders-hackathon.devpost.com/. The written rules exclude existing projects, but the organizers confirmed by email on 23 October that Nori may be brought; say so in the Devpost write-up. Judging: production-ready, agentic use, creativity. Submit a live link plus a test login or open sign-up. Sponsor credits worth using: context.dev (career-page reader and monitors, roadmap stage 4), Exa (social and web search), Stripe (plans, stage 6). See the last section of `docs/ROADMAP.md` for what fits the day and the two-minute demo script.

## A first message for the new session

> Read docs/HANDOFF.md, docs/ROADMAP.md and docs/VERIFIED.md in this repo. Nori is live on Fly (API) and Vercel (dashboard). Continue Stage 0 from where the handoff says: Sentry wiring once the DSNs are in .env, then the staging app, then the phone walk-through. Work on branches with PRs, run node scripts/gate.mjs before each PR, and never push to main.
