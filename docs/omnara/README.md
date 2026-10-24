# Nori on Omnara

A managed Omnara agent whose tools are Nori's own MCP server. Nothing in Nori changes; the agent runs on Omnara and calls `https://api.norinote.xyz/mcp` with its own bearer token. Built for the Agent Builders Hackathon, 24 October 2026.

## What you need

- An Omnara account with credits, and a personal API token from app.omnara.com (Personal tokens). Put it in `.env` as `OMNARA_API_KEY=` (the CLI reads that name).
- Nori's MCP token: the value of the `MCP_TOKEN` secret on Fly. Put the same value in `.env` as `MCP_TOKEN=`. To rotate it, run `flyctl secrets set MCP_TOKEN=<new value> -a jobgraph-api-norinote` and update `.env` to match.

## Steps (all from the repo root)

```bash
# 1. who am I, which org and project
npx omnara whoami
npx omnara config select            # pick the org and project once

# 2. a generic secret holding Nori's MCP token; note the sec_... id it prints
npx omnara secrets create --name nori-mcp-token --type generic --value "$MCP_TOKEN"

# 3. put that id into docs/omnara/nori-agent.yaml at auth.secret_id, then create the profile
npx omnara profiles create --name nori-agent --file docs/omnara/nori-agent.yaml --json

# 4. launch and talk to it
npx omnara agents launch --profile <profile-id> --message "status" --json
npx omnara agents chat <agent-id>
```

The console link is `https://app.omnara.com/projects/<project-id>/agents/<agent-id>`.

## What to try

- `find senior AI engineer roles, remote` then `research 2`
- `what am I missing for 3`
- `apply to 1` (the agent confirms the job, Nori tailors and fills, then waits for approval in the dashboard or on Telegram; nothing is sent by the agent)
- `status`

## Notes

- The MCP endpoint acts as the operator account named by `MCP_USER_EMAIL` on Fly: the agent works that account's career graph and applications.
- `apply` and `add_fact` are set to ask before running; the rest run without asking.
- Slack or Discord: optional, through Omnara's integrations (`npx omnara integrations ...`), each needing a bot app on that platform.
