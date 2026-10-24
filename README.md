# Nori

An open-source personal job agent built around a **career graph**. It finds roles, researches companies, tailors a one-page resume where every bullet traces back to a fact about you, fills ATS forms with review-before-submit, reads verification codes from your mail, tracks replies, and talks to you over Slack, Telegram, WhatsApp, email, a dashboard, and MCP.

Built for the Cline x Composio x Parallel hackathon, Open Source AI Week, San Francisco, 19 October 2026. The scaffold (database schema, LLM layer, package layout) was prepared the evening before; the sponsor integrations and the end-to-end agent were built on the day. Commit history tells the story.

## Why a graph

Every other auto-apply tool holds a flat resume and a prompt. jobgraph turns your history into nodes (roles, projects, skills, metrics, education) and edges (used in, achieved at, worked at). Tailoring becomes retrieval: the job description is matched against your subgraph, bullets are rewritten only from evidence nodes, and the diff you approve shows which node each change came from. "What am I missing for this role" is a graph diff. Nothing is ever invented.

## Sponsor tools in the build

| Tool | Where |
|---|---|
| Parallel Search + Extract | `packages/core/src/feeds/parallel.ts`, `discover.ts`: intent-based job discovery across Greenhouse, Lever, Ashby and SmartRecruiters boards; pasted-URL extraction |
| Parallel Task API | `packages/core/src/research/company.ts`: per-company research with citations (stage, funding, headcount, news, interview process, sponsorship signals) |
| Composio | `packages/channels/`: Gmail (recruiter replies, verification codes), Slack (chat with the agent), Google Sheets (tracker), Google Calendar (interview holds) |
| Cline | Built with Cline; `.clinerules/project.md`; MCP server at `/mcp` so Cline can drive the agent; `cline schedule` for the daily run |
| Open models | `packages/core/src/llm/`: the operator sets one model endpoint (`HOSTED_LLM_*`: any OpenAI-compatible provider, Anthropic, or a local Ollama) and every account runs on it |

## The hackathon version, in one minute

- **Nothing to configure.** The model is part of the product: every account runs on the operator's model, with a daily allowance per person. No keys to paste. Self-hosting with no key at all runs on a local Ollama, or on rules alone.
- **Auto apply.** Set lanes once (titles, locations, remote, minimum match) and a daily cap. The agent finds new roles, skips the ones you cannot take and says why, tailors the resume, fills the form, and asks for your OK.
- **Talk to it anywhere.** Telegram or WhatsApp on your phone, a small companion beside your clock on the laptop (`npm run companion`), or the dashboard. "Skip the Stripe one, apply to the rest" works.
- **Honest by construction.** Every resume line and every answer traces to a node in your career graph. It cannot invent a claim.
- **Yours.** Export your graph as JSON any time. Run it fully local with `LOCAL_ONLY=1`.

```bash
npm run demo        # API + scheduler + channels in one process
npm run web         # dashboard on :3000
npm run companion   # menu-bar / tray companion
npm run seed -- --resume my-resume.pdf --email me@x.com --titles "Senior Frontend Engineer" --boards greenhouse:vercel --cap 3
```

## Live

- Dashboard: https://jobs.norinote.xyz
- API: https://api.norinote.xyz/api/health
- MCP: `POST https://api.norinote.xyz/mcp` with `Authorization: Bearer <MCP_TOKEN>`

## Run it

```bash
cp .env.example .env     # add keys you have; everything degrades gracefully without them
npm install
npx playwright install chromium
npm run db:migrate
npm run api              # http://localhost:4000
npm run worker           # runner loop, feed polling, inbox polling, channel listeners
npm run web              # http://localhost:3000
```

See `ARCHITECTURE.md` for the layout and the full HTTP API.

## Keys and what each one unlocks

Everything runs with no keys at all (heuristic extraction, feed polling, PDF, dry-run form filling, dashboard). Each key switches one capability from heuristic or stub to real.

| Env var | Get it at | Unlocks |
|---|---|---|
| `HOSTED_LLM_PROVIDER` + `HOSTED_LLM_BASE_URL` + `HOSTED_LLM_API_KEY` (+ `HOSTED_LLM_QUALITY_MODEL`, `HOSTED_LLM_BULK_MODEL`) | any OpenAI-compatible provider (platform.openai.com, OpenRouter, Groq), Anthropic, or Ollama (`http://localhost:11434/v1`) | The model every account runs on: resume extraction, bullet rewriting, answer drafting, inbox classification. `HOSTED_LLM_DAILY_TOKEN_CAP` (default 300000) bounds one person's daily use |
| `PARALLEL_API_KEY` | platform.parallel.ai (prepaid credit) | Intent-based job discovery, pasted-URL extraction, company research with citations |
| `COMPOSIO_API_KEY` | dashboard.composio.dev | Gmail inbox and verification codes, Slack chat, Google Sheets tracker, Google Calendar holds. Connect each app once from Settings. |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram; set `TELEGRAM_AUTOLINK=true` for single-user mode | Text the agent on your phone |
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` | Meta WhatsApp Cloud API | WhatsApp channel (outbound; inbound needs the webhook route exposed) |
| `ALLOW_REAL_SUBMIT=true` | you | Lets the driver click Submit after you approve the filled form |

### Running on a local model (Ollama)

Local models work, with two settings worth knowing. Ollama ships with a 4096-token context window, too small for resume tailoring (the agent falls back to its rule-based draft and says so in the log): start Ollama with `OLLAMA_CONTEXT_LENGTH=16384`. And "thinking" models such as qwen3.5 are slow by default; Nori turns their reasoning off for extraction. Every model call has a deadline (`LLM_TIMEOUT_MS`, default 3 minutes), after which the rule-based fallback runs, so a stalled model never freezes the agent.

## Demo loop

1. Paste a resume on /graph. The graph appears: roles, projects, skills, metrics with their source lines.
2. On /jobs, poll a board (`greenhouse` + `vercel`) or, with Parallel, describe what you want. Open a job: requirements, match explanation, gaps, research.
3. Apply. Watch the live log: requirements, match, tailoring, render. Review the diff with provenance and the ATS checklist. Approve.
4. The driver fills the real form in dry run and stops at form review with every field listed and a screenshot. Edit anything. Approve and send.
5. Text the agent: `find senior frontend remote`, `apply 2`, `missing 3`, `research 1`, `status`.

## Safety

The driver fills forms and stops. It only clicks submit when `ALLOW_REAL_SUBMIT=true` **and** you approved the filled form. It never creates accounts, never enters passwords, never solves CAPTCHAs.

## License

MIT
