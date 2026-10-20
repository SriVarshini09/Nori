# Tools plan: keep what earns its place, make the rest bring-your-own

Decision rule: a service stays only if it removes real work for the user and nothing free or self-hostable does the job as well. Everything else becomes a pluggable provider the user (or the person hosting Nori) chooses, with a working path that needs no account anywhere.

## Verdicts

| Area | Today | Verdict | Why |
|---|---|---|---|
| Language model | Cline credits, OpenAI-compatible, Anthropic, Ollama | **BYOK first.** Presets for OpenAI, Anthropic, Google Gemini, OpenRouter, Groq/DeepSeek/Together (all OpenAI-compatible), plus local Ollama / LM Studio. Cline becomes one preset, not the default. | Users pay their own model bill and keep their data where they choose. No lock-in to a hackathon sponsor. |
| Sign in with ChatGPT | not built | **Add as a provider behind a flag, ship after access is confirmed.** | OpenAI has a "Sign in with ChatGPT" beta for launch partners (OAuth 2.0 / OIDC, usage drawn from the user's plan). General availability and developer terms were not confirmed in my search. Do not scrape the Codex CLI's tokens: unofficial and a terms risk. |
| Job discovery | Parallel search + extract; public ATS feeds | **Public ATS feeds are the core (no key). Parallel becomes an optional search adapter.** | Greenhouse, Lever, Ashby and SmartRecruiters expose public feeds. Parallel only adds breadth for roles outside them. |
| Company research | Parallel Task API | **Do it ourselves:** fetch the company's pages (with the SSRF guard) and let the user's model summarise with citations. Parallel optional. | Needs no extra account, works with a local model. |
| Mailbox (replies, verification codes) | Composio Gmail | **Two paths:** Composio for the hosted app (it carries Google's OAuth verification, which a small team cannot easily get for mail scopes), **IMAP with an app password** for self-hosters and privacy-minded users. | Reading mail is the most sensitive thing Nori does; give a path with no third party holding the token. |
| Tracker sheet, calendar, Slack | Composio | **Demote to optional integrations.** Add CSV and calendar-file (.ics) export, which need nothing. | The tracker already lives in Nori; Sheets is a convenience. |
| Chat channel | Telegram, WhatsApp, Slack, console | **Keep Telegram** (free Bot API). **Park WhatsApp** (Meta business verification is heavy). Slack optional. | |
| Account email | Resend, else console log | **Keep Resend, add generic SMTP** (`SMTP_URL`). | Any host can send mail without a Resend account. |
| Agent access | MCP endpoint | **Keep.** Open standard, works with any MCP client. | |

## Checklist

Order is by value. Effort in agent-hours is rough.

### A. Models (do first)
- [x] A1. Provider registry: one table of presets (id, label, base URL, key help link, default quality and bulk model, supports JSON mode, context size). Presets: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Together, Ollama, LM Studio, custom OpenAI-compatible. (4h)
- [x] A2. Settings UI: pick a preset, paste a key, pick models, "Test connection" shows the real result. Keys stay encrypted at rest and never reach the browser again. (4h)
- [x] A3. Model list from the provider (`/models`) so users choose from real names instead of typing them. (2h)
- [ ] A4. Local-first path: detect Ollama and LM Studio on their default ports, list installed models, warn when the context window is under 8k, show a one-line fix. (3h)
- [x] A5. Restrict the model-test base URL on hosted deployments (known gap, see MORNING.md): allow private addresses only when `LOCAL_ONLY` or an explicit env flag is set. (1h)
- [ ] A6. Cost and limits: per-user daily token cap and a visible "this run used about N tokens" line. (3h)
- [ ] A7. Sign in with ChatGPT provider (OAuth 2.0 / OIDC authorization-code + PKCE, token storage, refresh, revoke). Blocked on OpenAI approving the app and publishing developer terms. Build the provider interface now so it is a drop-in. (8h once unblocked)
- [ ] A8. Re-run the tailoring quality check on three real resumes against each class of model (large hosted, small hosted, 7B local) and record where the heuristic fallback kicks in. (4h)

### B. Discovery without a key
- [ ] B1. `SearchProvider` interface with adapters: none (ATS feeds only), Parallel, Brave Search, SearXNG (self-hosted), Tavily. Selected by env or Settings. (5h)
- [x] B2. Curated company registry (ATS token per company, by tag and region) seeded from public sources, editable by the user; "add a company by careers URL" auto-detects its ATS. (6h)
- [ ] B3. Replace Parallel company research with fetch-and-summarise using the SSRF-guarded fetcher and the user's model; keep citations. (5h)

### C. Mail without a third party
- [ ] C1. IMAP provider: host, port, app password (encrypted), folder; poll, classify, extract verification codes. Same interface the Composio path uses. (8h)
- [ ] C2. Settings UI to choose Composio or IMAP, with a connection test. (3h)
- [ ] C3. Tracker export: CSV download and an .ics file for interviews. (3h)

### D. Outbound mail and channels
- [x] D1. SMTP sender next to Resend (`SMTP_URL`), reflected in `npm run doctor`. (2h)
- [ ] D2. Telegram: verify the real bot flow end to end once a token exists. (2h)
- [ ] D3. Decide on WhatsApp: remove from the default settings page until a verified business number exists. (1h)

### E. Hosted-free tier (decision needed)
- [ ] E1. Decide: BYOK only (recommended; no model bill for the operator) or a small hosted allowance on an operator key with a hard per-user cap.
- [ ] E2. If a hosted allowance: per-user quota table, enforcement in the LLM layer, a clear "you have N free runs left" message.

### F. Clean-up
- [ ] F1. Rename the Settings sections and copy so no sponsor name is required to understand a screen; update README and `.env.example`. (2h)
- [ ] F2. Update `npm run doctor` so each area (model, search, mail, email, chat) shows which provider is active and what is missing. (2h)
- [ ] F3. Tests: each provider adapter runs against a local fake server, so CI proves the wiring with no keys. (6h)

## Order I would run them in

1. A1, A2, A3, A5 (BYOK works properly and safely) 
2. A4 (local models) and A8 (quality check)
3. B1, B3 (discovery and research with no sponsor account)
4. C1, C2 (private mailbox path)
5. D1, F1, F2 (so every area reports honestly)
6. A7 the day OpenAI access is confirmed

## What is already true

- The model layer already speaks the OpenAI-compatible and Anthropic wire formats and Ollama, and user keys are encrypted at rest (`packages/core/src/llm`).
- Public ATS feeds for four boards need no key.
- Nothing in the product stops working without Parallel, Composio or Cline; those features report "blocked: needs KEY" instead.

## Source notes

- "Sign in with ChatGPT": OpenAI's Codex docs describe ChatGPT sign-in for its own CLI (https://developers.openai.com/codex/auth); press and blog coverage describes a partner beta using OAuth 2.0 / OpenID Connect with plan-based usage. I could not find OpenAI's developer documentation or terms for general third-party use, so check those directly before building A7.
