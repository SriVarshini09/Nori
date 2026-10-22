# Deploy runbook

Shape: Neon Postgres, the API with the embedded worker on Fly.io (`jobgraph-api`, sjc), the dashboard on Vercel. Nothing here deploys by itself.

## 1. Database (Neon)
1. Create a project (Postgres 16, us-west-2). Copy the **direct** connection string and keep `?sslmode=require`:
   `DATABASE_URL=postgres://USER:PASS@ep-xxx.us-west-2.aws.neon.tech/neondb?sslmode=require`
2. Apply migrations from your machine (also runs on API boot):
   `DATABASE_URL=... npm run db:migrate`  (expect `migrations applied (postgres)`).

## 2. API (Fly.io)
```
fly launch --no-deploy --copy-config --name jobgraph-api --region sjc   # reuses fly.toml, answer N to a new Postgres/Redis
fly volumes create jobgraph_data --size 1 --region sjc                  # mounted at /data (artifacts: /data/artifacts)
fly secrets set \
  DATABASE_URL='postgres://...sslmode=require' \
  CREDENTIALS_KEY="$(openssl rand -base64 32)" \
  APP_SECRET="$(openssl rand -base64 32)" \
  PROXY_SECRET="<one random value, also set on Vercel>" \
  WEB_URL=https://jobs.norinote.xyz \
  COMPOSIO_API_KEY=... PARALLEL_API_KEY=... TELEGRAM_BOT_TOKEN=... \
  HOSTED_LLM_PROVIDER=cline HOSTED_LLM_BASE_URL=https://api.cline.bot/api/v1 HOSTED_LLM_API_KEY=... \
  HOSTED_LLM_QUALITY_MODEL=deepseek/deepseek-v4-pro HOSTED_LLM_BULK_MODEL=qwen/qwen3.7-plus
fly deploy
```
- Keep `CREDENTIALS_KEY` forever: changing it makes stored user model keys unreadable.
- Do not set `DEFAULT_USER_EMAIL` or `ALLOW_REAL_SUBMIT` until you mean to (the first lets anonymous requests act as that user; the second lets the driver click Submit).
- One machine only (`fly scale count 1`): the scheduler and channel listeners run inside the API process.
- `fly.toml` sets `EMBED_WORKER=1`, `NODE_ENV=production`, `API_PORT=4000`, `ARTIFACTS_DIR=/data/artifacts`. `DATABASE_URL` is required in production: without it the API refuses to start and says why.
- `PROXY_SECRET` must be the same value here and on Vercel. The dashboard's proxy signs each visitor's address with it, so login and sign-up rate limits count per visitor. Without it every request seems to come from Vercel and the limits are shared.

## 3. Dashboard (Vercel)
1. Import the repo, **Root Directory = `apps/web`** (keep "Include source files outside the Root Directory" on). `apps/web/vercel.json` installs at the repo root.
2. Environment variables (Production):
   `API_URL=https://api.norinote.xyz`, `NEXT_PUBLIC_API_URL=https://api.norinote.xyz`, `PROXY_SECRET` (the same value as on Fly). Live mode is the default; never set `NEXT_PUBLIC_USE_MOCK=1` here.
3. Deploy. Add the domain `jobs.norinote.xyz`.

## 4. DNS
| Record | Name | Value |
|---|---|---|
| CNAME | `jobs` | `cname.vercel-dns.com` |
| CNAME | `api` | `jobgraph-api.fly.dev` |

Then `fly certs add api.norinote.xyz` (Fly shows the exact record if it differs; an A/AAAA pair from `fly ips list` also works).

## 5. Cookies and CORS: two options
- **Recommended: Next.js proxy (default).** The browser only calls `https://jobs.norinote.xyz/api/*`, which Next rewrites to `API_URL`. The cookie is same-origin: `Secure; HttpOnly; SameSite=Lax`, host-only. Leave `COOKIE_DOMAIN` unset.
- **Direct cross-origin.** If the browser must call `api.norinote.xyz` itself, `fly secrets set COOKIE_DOMAIN=.norinote.xyz`. In production the cookie then becomes `Secure; SameSite=None; Domain=.norinote.xyz`, and CORS allows only `WEB_URL` with credentials. Use this only if you cannot proxy (the proxy adds one hop).

## 6. Smoke checklist
- [ ] `curl https://api.norinote.xyz/api/health` returns `{"ok":true,...,"embeddedWorker":true}`
- [ ] `https://jobs.norinote.xyz/signup` creates an account and lands on onboarding; the `jg_session` cookie is Secure
- [ ] Onboarding: upload a resume, finish the wizard, the graph page shows nodes
- [ ] Settings: save a Cline key, "Test" returns ok
- [ ] Apply to one job with `ALLOW_REAL_SUBMIT` unset: the run reaches form review with a resume PDF (dry run), the PDF opens
- [ ] Settings, Danger zone: delete a throwaway account and confirm you land on `/signup`
- [ ] `fly logs` shows no restart loop

## 7. Rollback
- API: `fly releases` then `fly deploy --image <registry.fly.io/jobgraph-api:deployment-...>` for the previous release.
- Dashboard: Vercel, Deployments, previous deployment, Promote to Production.
- Database: migrations are additive; rolling the API back is safe. For data loss use Neon point-in-time restore (a branch at a timestamp), then swap `DATABASE_URL`.
- Volume: `fly volumes snapshots list`, `fly volumes create --snapshot-id ...`.
