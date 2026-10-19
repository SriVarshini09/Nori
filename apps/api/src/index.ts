import "../../worker/src/env.js";
import { serve } from "@hono/node-server";
import { createAgent, getDb, warmLLM, type OutboundMessage } from "@jobgraph/core";
import { createChannelRouter, sendToUser, type ChannelRouter } from "@jobgraph/channels";
import { startRuntime, type Runtime } from "../../worker/src/runtime.js";
import { createApp, defaultRunnerDeps } from "./app.js";

export { createApp } from "./app.js";

const embed = process.env.EMBED_WORKER === "1" || process.env.EMBED_WORKER === "true";
// `npm run demo` acts as one local user without sign-in; DEFAULT_USER_EMAIL from .env wins.
// Never in production: there every request belongs to a signed-in account and MCP uses MCP_USER_EMAIL.
if (embed && !process.env.DEFAULT_USER_EMAIL && process.env.NODE_ENV !== "production") process.env.DEFAULT_USER_EMAIL = "dev@jobgraph.local";

const port = Number(process.env.API_PORT ?? 4000);
const db = await getDb();
await warmLLM();
const runner = defaultRunnerDeps();

let router: ChannelRouter;
let notify: (userId: string, msg: OutboundMessage) => Promise<unknown>;
let runtime: Runtime | null = null;
if (embed) {
  // Single process: the scheduler (runner, feeds, inbox, agent tick, morning brief, weekly summary) and every channel
  // listener (Telegram, WhatsApp, Slack, and the console when CHANNEL_CONSOLE=1) run here, next to the HTTP API.
  runtime = await startRuntime(db, { name: "agent", runner });
  router = runtime.router;
  notify = runtime.notify;
} else {
  // The API only serves the WhatsApp webhook; Telegram/Slack listeners run in the worker.
  notify = (userId, msg) => sendToUser(db, userId, msg);
  router = createChannelRouter(db, { onMessage: createAgent(db, { runner, notify }) });
  await router.whatsapp.listen((m) => router.handleInbound(m).then(() => {}));
}

const app = createApp(db, { router, runnerDeps: runner, notify });
const server = serve({ fetch: app.fetch, port }, (info) => {
  const msg = `[api] listening on http://localhost:${info.port} (MCP at /mcp${process.env.MCP_TOKEN || process.env.NODE_ENV === "production" ? ", bearer token required" : ", no auth: localhost only"})${embed ? "; scheduler and channel listeners embedded" : ""}`;
  (runtime?.consoleMode ? console.error : console.log)(msg);
});

const shutdown = () => {
  runtime?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
