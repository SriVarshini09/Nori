# Overnight goal: a launch-ready Nori

Branch: `launch/overnight` (worktree `.claude/worktrees/launch`, cut from `fix/auto-apply`). Nothing here is deployed or pushed until a human reviews it.

## Goal

Make Nori a product that works end to end for a real user: every link, route and button works; the backend is hardened; the resume system is real (library, editor, several templates, exports). "Done" is measured, not felt.

## Done criteria (all must hold)

1. `node scripts/gate.mjs` passes: typecheck, unit tests, web production build (live mode), lint.
2. `node scripts/crawl.mjs` reports **0 broken routes, 0 dead links, 0 console errors, 0 failed network calls** across every page, for a signed-in user and a signed-out visitor.
3. The browser end-to-end suite (`npm run e2e`) passes: sign up, onboarding with resume, graph, jobs, apply, resume review and edit, template switch, approve, tracker, settings, sign out.
4. Resume: base resume library, section editor with live preview, at least 6 templates, theme controls (font, accent, density, margins, Letter/A4), per-application template choice, PDF + DOCX + TXT export, version history. Every template renders every fixture persona on the page limit without overflow, and passes the ATS checks where it claims ATS-safe.
5. Auth: password reset and email verification flows (provider-backed when a key exists, console-logged otherwise), change password, session list and revoke, rate limiting, security headers.
6. Known bug fixed: answering form questions then approving no longer returns 409.
7. Every integration that needs a secret has a clearly reported state: **verified** (ran against the real service) or **blocked: needs KEY_NAME**. Nothing is reported as working unless it ran.

## Guardrails (never, even if it would be faster)

- No deploy, no push, no force push, no merge to `main`. Commits on `launch/overnight` only.
- `ALLOW_REAL_SUBMIT` stays off. Never submit a real application.
- No sign-ups or logins on third-party services; no entering credentials anywhere. Secrets only from the environment (`.env`, gitignored).
- Never touch the shared dev servers on ports 3000/4000 or the `data/` folder of the main checkout. This work uses ports 3200/4200 and a scratch database.
- No destructive git (`reset --hard`, `clean -fd`, `stash` in the shared stash). Set work aside with a WIP commit.
- Do not weaken existing tests to make them pass. If a test is wrong, fix it with a stated reason in the commit message.

## Method

One step at a time. After each step: run the gate, commit with a message that says what changed and why, tick the checklist below. If the gate fails twice on the same cause, record it under "Blocked" and move on to the next step rather than stalling.

## Checklist

- [ ] P0 Gate script, CI workflow, security headers, CORS, rate limits
- [ ] P1 Crawler, fix every broken link or route, end-to-end suite
- [ ] P2 Backend hardening that needs no keys (409 race, auth flows, sessions, feeds, scheduler, drivers)
- [ ] P3 Resume system (library, editor, templates, theme, exports, history, better tailoring)
- [ ] P4 Integrations: report state per service, wire everything that can be tested offline
- [ ] P5 Frontend polish (mobile, accessibility, empty/error states, legal pages)
- [ ] P6 Morning report (`docs/MORNING.md`): what was done, what is blocked and on which key, how to review, how to launch

## Keys the human provides (put in a gitignored `.env` at the main checkout root; copied into the worktree at run time)

```
# hosted LLM (any one provider)
HOSTED_LLM_PROVIDER=cline|openai-compatible|anthropic
HOSTED_LLM_BASE_URL=
HOSTED_LLM_API_KEY=
HOSTED_LLM_QUALITY_MODEL=
HOSTED_LLM_BULK_MODEL=
# or ANTHROPIC_API_KEY=

COMPOSIO_API_KEY=        # Gmail, Sheets, Calendar, Slack
PARALLEL_API_KEY=        # job discovery, company research
TELEGRAM_BOT_TOKEN=      # phone channel
RESEND_API_KEY=          # email for verification and password reset (or SMTP_URL=)
EMAIL_FROM=
```

## Blocked

(filled in during the run)

## Log

(one line per completed step, newest last)
