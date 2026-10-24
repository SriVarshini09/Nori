/**
 * Start-up checks for the API's environment, and an honest per-service report.
 *
 * `checkEnv` separates what must stop a production boot (errors) from what only deserves a warning.
 * `integrationReport` says, per service, whether its key is present. "configured" means the key exists, not that
 * the service was reached: a call against the real service is the only thing that makes a service "verified",
 * and this module never makes one.
 */
type Env = Record<string, string | undefined>;

export type EnvCheck = { errors: string[]; warnings: string[] };

const isLocalHost = (url: string) => {
  try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname); } catch { return false; }
};

export function checkEnv(env: Env = process.env): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = env.NODE_ENV === "production";

  const base64Len = (s: string) => { try { return Buffer.from(s, "base64").length; } catch { return -1; } };
  if (env.CREDENTIALS_KEY && base64Len(env.CREDENTIALS_KEY) !== 32) errors.push("CREDENTIALS_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  if (env.API_PORT && !/^\d{2,5}$/.test(env.API_PORT)) errors.push(`API_PORT must be a port number, got "${env.API_PORT}".`);
  if (env.WEB_URL) {
    try { new URL(env.WEB_URL); } catch { errors.push(`WEB_URL is not a valid URL: "${env.WEB_URL}".`); }
  }
  if ((env.RESEND_API_KEY || env.SMTP_URL) && !env.EMAIL_FROM) warnings.push("An email provider is set but EMAIL_FROM is not, so account emails are only logged. Set EMAIL_FROM to a sender the provider allows.");
  if (env.SMTP_URL && !/^smtps?:\/\//i.test(env.SMTP_URL)) errors.push("SMTP_URL must look like smtp://user:password@host:587 (or smtps:// for port 465).");
  if (env.ALLOW_REAL_SUBMIT === "true") warnings.push("ALLOW_REAL_SUBMIT=true: approved applications will be submitted for real.");

  if (prod) {
    if (!env.DATABASE_URL) errors.push("DATABASE_URL is required in production (embedded PGlite is for development).");
    if (!env.WEB_URL || isLocalHost(env.WEB_URL)) errors.push("WEB_URL must be the public https address of the web app in production (it is the one origin CORS allows, and the base of emailed links).");
    else if (!env.WEB_URL.startsWith("https://")) warnings.push("WEB_URL is not https: session cookies are Secure in production and will not stick over plain http.");
    if (!env.CREDENTIALS_KEY && !env.APP_SECRET) errors.push("Set CREDENTIALS_KEY (or APP_SECRET): stored secrets are encrypted with it, and the development fallback key is public.");
    else if (!env.CREDENTIALS_KEY) warnings.push("CREDENTIALS_KEY is not set; the key-encryption key is derived from APP_SECRET. Prefer a dedicated CREDENTIALS_KEY.");
    if (env.DEFAULT_USER_EMAIL) errors.push("DEFAULT_USER_EMAIL must not be set in production: it would let anyone without a session act as that user.");
    if (env.TELEGRAM_AUTOLINK === "true") errors.push("TELEGRAM_AUTOLINK must not be on in production: it links any stranger who messages the bot to the default user.");
    if (!env.MCP_TOKEN) warnings.push("MCP_TOKEN is not set: the /mcp endpoint will refuse every request in production.");
    if (!env.RESEND_API_KEY && !env.SMTP_URL) warnings.push("Neither RESEND_API_KEY nor SMTP_URL is set: password-reset and verification emails are only written to the log, so users cannot recover an account.");
    if (!env.ARTIFACTS_DIR) warnings.push("ARTIFACTS_DIR is not set: resume PDFs and screenshots go to the working directory and vanish with the container. Mount a volume and set it.");
  }
  return { errors, warnings };
}

export type IntegrationState = {
  id: string;
  name: string;
  /** configured: every needed key is present (not yet run against the service). blocked: a key is missing. */
  state: "configured" | "blocked";
  /** The variables that are missing. */
  needs: string[];
  /** What stops working or falls back while it is blocked. */
  without: string;
};

export function integrationReport(env: Env = process.env): IntegrationState[] {
  const has = (k: string) => Boolean(env[k]);
  const row = (id: string, name: string, needsAll: string[], without: string, anyOf?: string[]): IntegrationState => {
    const missing = needsAll.filter((k) => !has(k));
    const anyMissing = anyOf && !anyOf.some(has) ? [anyOf.join(" or ")] : [];
    const needs = [...missing, ...anyMissing];
    return { id, name, state: needs.length ? "blocked" : "configured", needs, without };
  };
  const hostedOk = has("HOSTED_LLM_API_KEY") && (has("HOSTED_LLM_PROVIDER") || has("HOSTED_LLM_BASE_URL")) || has("ANTHROPIC_API_KEY") || has("CLINE_API_KEY") || has("OPENAI_COMPAT_API_KEY");
  return [
    {
      id: "llm", name: "Hosted language model", state: hostedOk ? "configured" : "blocked",
      needs: hostedOk ? [] : ["HOSTED_LLM_API_KEY (+ HOSTED_LLM_PROVIDER or HOSTED_LLM_BASE_URL) or ANTHROPIC_API_KEY"],
      without: "Tailoring and answers use a local Ollama model when one runs, else the built-in heuristics. Users can add their own key in Settings.",
    },
    row("composio", "Gmail, Sheets, Calendar, Slack (Composio)", ["COMPOSIO_API_KEY"], "Inbox sync, the tracker sheet and verification-code lookup are unavailable."),
    row("parallel", "Job discovery and company research (Parallel)", ["PARALLEL_API_KEY"], "Discovery outside the public ATS feeds and company research are unavailable."),
    row("telegram", "Telegram channel", ["TELEGRAM_BOT_TOKEN"], "No Telegram chat; the web app and other channels still work."),
    row("whatsapp", "WhatsApp channel", ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"], "No WhatsApp chat."),
    {
      id: "email", name: "Account email (Resend or SMTP)",
      state: (has("RESEND_API_KEY") || has("SMTP_URL")) && has("EMAIL_FROM") ? "configured" : "blocked",
      needs: [...(has("RESEND_API_KEY") || has("SMTP_URL") ? [] : ["RESEND_API_KEY or SMTP_URL"]), ...(has("EMAIL_FROM") ? [] : ["EMAIL_FROM"])],
      without: "Verification and password-reset links are written to the server log instead of being emailed.",
    },
    row("mcp", "MCP endpoint token", ["MCP_TOKEN"], "In production /mcp refuses every request."),
  ];
}
