/**
 * One agent cycle for the default user, printed as JSON; exits 0 on success. This is what
 * `cline schedule` (or cron) calls.
 *
 * When the API is reachable (API_URL, default http://localhost:${API_PORT:-4000}) the tick runs inside the
 * API via POST /api/agent/tick, because the API process owns the embedded PGlite database and a second
 * process must never open the same data directory. Only when the API is down does this open the DB directly.
 * The API resolves the user from DEFAULT_USER_EMAIL when no session cookie is sent.
 */
import "./env.js";
import { agentTick, ensureDefaultUser, getDb, type Db } from "@jobgraph/core";

const apiUrl = (process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`).replace(/\/$/, "");

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function viaApi(): Promise<unknown> {
  const res = await fetch(`${apiUrl}/api/agent/tick`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const text = await res.text();
  if (res.status === 401) throw new Error(`API at ${apiUrl} wants a session; start it with DEFAULT_USER_EMAIL set so scripts act as that user`);
  if (!res.ok) throw new Error(`POST ${apiUrl}/api/agent/tick -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function direct(): Promise<unknown> {
  const [{ pickDriver }, { sendToUser, waitForVerificationCode }] = await Promise.all([import("@jobgraph/drivers"), import("@jobgraph/channels")]);
  const db: Db = await getDb();
  const user = await ensureDefaultUser(db);
  return agentTick(db, user.id, {
    runner: { pickDriver, waitForCode: (d, userId, hint, ms) => waitForVerificationCode(d, userId, hint, ms) },
    notify: (userId, msg) => sendToUser(db, userId, msg),
  });
}

async function main() {
  const api = await reachable();
  console.error(api ? `[tick] running inside the API at ${apiUrl}` : `[tick] API not reachable at ${apiUrl}; opening the database directly`);
  const summary = api ? await viaApi() : await direct();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[tick] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
