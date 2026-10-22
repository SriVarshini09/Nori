# Morning report

Branch `launch/overnight` (worktree `.claude/worktrees/launch`). Nothing is pushed, deployed or merged. `ALLOW_REAL_SUBMIT` was never turned on and no real application was submitted.

## Where it stands

`node scripts/gate.mjs` passes on this branch:

| Step | What it proves |
|---|---|
| TypeScript | the whole monorepo type-checks |
| Unit and API tests | engine, API, auth flows, resume exports, drivers (routing), env checks |
| Lint (web) | no lint errors |
| Web build, live mode | production build with `NEXT_PUBLIC_USE_MOCK=0` |
| Crawl | 67 pages (visitor and signed-in, desktop and 390 px phone), every link, 0 console/network errors, 0 axe-core WCAG A/AA violations, no horizontal overflow |
| Browser e2e (46 steps) | a real browser: signup, onboarding, resume studio, application review and edit, forgot password, email confirm, devices, password change, plus click-through of jobs (filters, drawer, apply), applications (answer then approve, skip), tracker, inbox and auto apply (cap, switches, lanes, run now, chat) |

## What changed, in the order you asked about

**Links and routes.** A crawler now visits every route and checks every link. Fixed: unknown ids returned HTTP 500 (now a friendly 404 page), `/api/artifacts/*` had no ownership check, a hydration error on empty states, and an onboarding bug that returned 400 when the salary was left blank.

**Resume.** A real system instead of a sample: library of resumes, section editor with live preview, 7 templates, font, accent, size, spacing, margins, Letter/A4, section reorder and hide, version history with restore, PDF / Word / text / JSON export, an ATS check that warns on two-column layouts, and editing of the tailored resume for a job before you approve it. Every template was rendered for four personas; no text is lost in the PDF and page limits hold.

**Backend.** Password reset, email confirmation, change password, signed-in devices (list and sign out), rate limits, security headers and CSP, boot-time env validation, hourly clean-up of expired sessions. The answer-then-approve 409 is fixed (approve waits up to 25 s for the resumed run). Lever, Ashby and SmartRecruiters drivers added. The tailoring prompt shrinks in three steps for 4k-context local models.

**Security.** A pasted job link can no longer make the server fetch internal addresses (loopback, private ranges, cloud metadata), including through redirects. An unreadable link now answers 422 with the reason instead of 500. One gap left: the model-test endpoint still calls a user-supplied base URL, because local Ollama needs that; restrict it before running a multi-tenant host.

**Job supply.** Nori now watches a curated registry of 186 company boards (104 Greenhouse, 54 Ashby, 20 Lever, 8 SmartRecruiters), each checked against its live public feed on the day it was built (about 33,000 open roles). The worker seeds them at start and re-reads each every 3 hours; boards a user follows or applied to are refreshed hourly by that user's agent tick. A new Companies page lets people search, follow and unfollow, and add any company by pasting its careers or job link (Nori finds the board behind it). Re-verify the list with `npx tsx scripts/verify-boards.mts` (edit `scripts/board-candidates.txt` to add candidates). Not covered: Workday, LinkedIn, Indeed and company-built career sites.

**Bring your own model.** Settings and onboarding now offer 12 providers (OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Together, Mistral, Cline, Ollama, LM Studio, or any OpenAI-compatible endpoint). Paste a key, load the provider's own model list, test the connection; keys are stored encrypted and never shown again. In production a model URL must be a public address (so the model settings cannot be used to reach internal services); single-user hosts that want Ollama or LM Studio on the same machine set `ALLOW_PRIVATE_MODEL_URLS=1`. Account email can now go through Resend or any SMTP server (`SMTP_URL` + `EMAIL_FROM`); the SMTP path is tested against a stand-in SMTP server, not a real mail provider. Plan and checklist: `docs/TOOLS.md`.

**Autopilot (hands-free applying, guarded).** New setting on Auto apply: Nori can send an application without asking, but only when 11 checks all pass (account-free platform, match above your bar, no eligibility conflict, nothing unprovable from your profile, every answer from your profile, readable resume, you approved 3 yourself first, no recent application to the same company, server allowed to send). Anything else waits for you with the reason shown. Off by default. Details and limits: `docs/AUTOPILOT.md`. Real submission has still never run on a live site.

**Resume tailoring, designed as a recruiter reads.** The tailoring now writes a job-specific, level-aware summary with real results (no stock sentence, no filler), leaves out older bullets that say nothing about the job (each recorded, your original untouched), and rejects the model's filler and any skill it cannot prove. A new **Recruiter's view** on every application shows a score, each skill the job asks for (shown in your experience / only in the skills list / not on your resume), what a recruiter would question and how to fix it. Two silent defects found and fixed: every model summary was being discarded because it contained the real years, and omitted bullets were reported as untruthful. Design and measurements: `docs/RESUME-TAILORING.md`.

**Real PostgreSQL in the gate.** Everything used to be tested only on an embedded stand-in. The suite now also runs on real PostgreSQL 17, which found three real problems: (1) answering a question and approving straight away could be refused with a 409, because the answer was saved after the reply; fixed by saving first and only backgrounding the run; (2) the production database pool had no connection timeout (a busy pool would hang requests) and no error handler (Neon closes idle connections, which could crash the server); both added, `DB_POOL_MAX` sets the size; (3) two browser tests asserted transient states and are fixed to assert lasting facts.

**Public side.** Landing page, Privacy, Terms, robots, sitemap, share image.

## What is NOT verified, and why

| Item | State |
|---|---|
| Live dry runs (20 Oct 2026, nothing submitted) | **Done**: Greenhouse fills 17 fields and works; Lever and Ashby fill then stop at a CAPTCHA; SmartRecruiters blocks automated browsers (handed to the person). Five defects found and fixed. See `docs/LIVE-DRYRUN.md`. |
| (superseded) Real applications on Lever / Ashby / SmartRecruiters | Drivers route and open the application step (tested offline). Never run against a live posting. SmartRecruiters uses web components that the generic filler may not reach. Do a dry run on a posting you pick. |
| OpenAI | **Verified for real (20 Oct 2026).** Key accepted, 135 models listed, connection test and real tailoring run on gpt-4.1-mini, gpt-4.1, gpt-5-mini and gpt-5; the whole pipeline (read resume, graph, match, tailor, summary) ran on gpt-4.1 / gpt-4.1-mini. The run found and fixed a real bug: gpt-5 and o-series models reject `temperature` and `max_tokens`. Repeat with `npm run live:model -- <model>` and `npm run live:flow`. Speed: gpt-4.1 about 10 s per tailoring, gpt-5-mini 23 s, gpt-5 43 s. |
| Anthropic, Gemini and other providers | Same adapter, not run against the real services. |
| Local models (Ollama) | Tried qwen3:4b and qwen3.5:9b: neither returned usable JSON for a whole-resume tailoring (timeout / invalid JSON), so Nori falls back to its rules. Per-role requests and JSON repair are planned. |
| Hosted model, Composio (Gmail/Sheets/Calendar/Slack), Parallel, Telegram, WhatsApp, Resend email | **Blocked: needs keys.** Nothing ran against these. `npm run doctor` prints exactly which variable each one needs. |
| Email through SMTP (Gmail) | **Verified for real (20 Oct 2026).** Gmail login accepted; a real confirmation email and a real password-reset email arrived in the inbox, both links worked, the reset signed out older sessions. Sender used for the test: a personal Gmail with an app password; use a domain address before a public launch (Gmail limits and spam risk). Resend: not run. |
| Reset / confirm emails (setup note) | Without (`RESEND_API_KEY` or `SMTP_URL`) + `EMAIL_FROM` the links are written to the API log, not emailed. In production that means users cannot recover accounts. |
| Privacy and Terms text | Drafted from what the code actually does. Have someone qualified review before launch. Set `NEXT_PUBLIC_CONTACT_EMAIL` so they show a real contact (otherwise they point to the GitHub issues page). |
| Production Postgres | **Verified on a real PostgreSQL 17 server** (20 Oct 2026): every migration on an empty database and again (idempotent), all 487 unit/API tests and all 54 browser steps, real concurrent connections (10 racing sign-ups create one account; a single-use link works once), the `DATABASE_URL` start-up path. `npm run test:pg` (add `-- --e2e` for the browser journey) runs it with no Docker and no account; it is part of the gate. **Not yet verified on Neon itself:** SSL (`sslmode=require`), connection limits and a pooled URL. Run the same suite against a scratch Neon branch before launch. |

## Things to know

- GitHub `origin/main` still has only the first commit and the live site is an older build. Nothing here is live until you push and deploy.
- The e2e and crawl use an offline stack (in-memory DB, fake form driver, no model). They prove the product's flows, not model quality.
- `.claude/worktrees/` is untracked in the main checkout; this worktree has its own `node_modules`.

## How to review

```bash
cd .claude/worktrees/launch
git log --oneline main..HEAD          # 18 commits, each one a step
npm run doctor                        # keys: configured vs blocked
node scripts/gate.mjs                 # everything above, ~4 minutes
```

Screenshots from the browser run are in `test-results/e2e/`, the crawl report in `test-results/crawl/report.md`.

## To launch

1. Review the diff and merge `launch/overnight` into `main` yourself.
2. Put the keys you have in the production environment (see `.env.example`; `docs/deploy.md`). Without `RESEND_API_KEY` and `EMAIL_FROM`, set them before opening signups.
3. Set `NODE_ENV=production`, `DATABASE_URL`, `WEB_URL`, `CREDENTIALS_KEY`, `ARTIFACTS_DIR`. The API refuses to boot in production with an unsafe setup and says why.
4. Run a dry run of one real posting per ATS before trusting the drivers.
5. Keep `ALLOW_REAL_SUBMIT=false` until you have watched at least one full approval flow yourself.
