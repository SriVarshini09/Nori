# What has actually run

The roadmap (`docs/ROADMAP.md`) calls a stage done only when its "proven when" lines ran for real. This file is the record: date, what ran, result. Nothing is listed here from a unit test alone.

## Stage 0: the deploy works for a stranger

| Date | Check | How | Result |
|---|---|---|---|
| 24 Oct 2026 | Live API has a model | `HOSTED_LLM_*` set on Fly (OpenAI, gpt-4.1 / gpt-4.1-mini). `/api/health` reports both tiers. A throwaway account's connection test returned a real completion in 1.5 s, then the account was deleted. | Proven |
| 24 Oct 2026 | Per-user daily token cap | PR 9 merged and deployed (Fly release v11). Settings on the live site shows "Model use today: 0 of 300,000 tokens". The refusal path is covered by `usage.test.ts` against a fake provider; a real user hitting the cap has not happened yet. | Proven (cap display); refusal in tests only |
| 24 Oct 2026 | Bring-your-own-key removed | PR 10 merged and deployed. Live Settings shows the read-only Model section and no key form; `user_credentials` dropped by migration 0010 on boot. | Proven |
| 24 Oct 2026 | Dashboard deploys from main | Vercel project `nori` imported from GitHub, root `apps/web`, env `API_URL` and `NEXT_PUBLIC_API_URL`. Domain `jobs.norinote.xyz` moved from the old account by TXT verification. Landing, public privacy page and the `/api` proxy answer from the new build. | Proven |
| 24 Oct 2026 | Telegram reaches the phone | `TELEGRAM_BOT_TOKEN` on Fly (bot @NoriNoteBot). Linking by one-time code shipped in PR 12 (Settings, Channels, Link Telegram). The owner pressed the button on the live site, sent the code from their phone, the bot replied "Linked" and answered `status`; the API shows the chat linked with `linkedWithCode`. | Proven |
| 24 Oct 2026 | Account email arrives | `RESEND_API_KEY` and `EMAIL_FROM=Nori <hello@norinote.xyz>` on Fly, domain verified in Resend (DKIM, two sending CNAMEs, DMARC at Spaceship). A real confirmation email was sent to the owner's Gmail, arrived, and its link set `emailVerifiedAt` on the live account. | Proven |

Still open in Stage 0: Sentry and an uptime monitor, the 7 Dependabot findings, a staging app on Fly, the phone walk-through of sign-up to an approved dry-run form.

Known problems seen on the way: the `PARALLEL_API_KEY` on Fly is invalid (every agent tick logs `Parallel search failed: 401`), so web discovery is off and only the ATS feeds run. Vercel suggests updating the `jobs` CNAME to its new value; the old one still works.
