import nodemailer from "nodemailer";

/**
 * Outgoing email for account links (verification, password reset).
 *
 * With RESEND_API_KEY set, mail goes through Resend; with SMTP_URL, through any SMTP server. Without either nothing leaves the machine: the message is
 * logged to the console so a developer can click the link. `mailerState()` reports which of the two applies,
 * so the app never claims email works when it only logs.
 */
export type Mail = { to: string; subject: string; text: string; html?: string };
export type Mailer = (mail: Mail) => Promise<void>;

export type MailerState = { mode: "resend" | "smtp" | "console"; from: string | null; blockedBy: string | null };

/** Which sender is active. Resend wins when both are set; SMTP_URL (smtp://user:pass@host:587 or smtps://...) is the any-provider option. */
export function mailerState(env: Record<string, string | undefined> = process.env): MailerState {
  if (env.RESEND_API_KEY) return { mode: "resend", from: env.EMAIL_FROM ?? null, blockedBy: env.EMAIL_FROM ? null : "EMAIL_FROM" };
  if (env.SMTP_URL) return { mode: "smtp", from: env.EMAIL_FROM ?? null, blockedBy: env.EMAIL_FROM ? null : "EMAIL_FROM" };
  return { mode: "console", from: null, blockedBy: "RESEND_API_KEY or SMTP_URL" };
}

export const consoleMailer: Mailer = async (mail) => {
  console.log(`[mail] (not sent: neither RESEND_API_KEY nor SMTP_URL is set) to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
};

export function resendMailer(apiKey: string, from: string): Mailer {
  return async (mail) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  };
}

/** Any SMTP server: Gmail with an app password, Fastmail, Postmark, SES, your own. The URL carries the login. */
export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return async (mail) => {
    await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) });
  };
}

/** The mailer the environment calls for. */
export function defaultMailer(): Mailer {
  const s = mailerState();
  if (s.mode === "resend" && s.from) return resendMailer(process.env.RESEND_API_KEY!, s.from);
  if (s.mode === "smtp" && s.from) return smtpMailer(process.env.SMTP_URL!, s.from);
  return consoleMailer;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function verifyEmail(link: string): Pick<Mail, "subject" | "text" | "html"> {
  return {
    subject: "Confirm your email for Nori",
    text: `Confirm your email address to finish setting up Nori:\n\n${link}\n\nThe link works for 3 days. If you did not create an account, ignore this message.`,
    html: `<p>Confirm your email address to finish setting up Nori.</p><p><a href="${esc(link)}">Confirm my email</a></p><p>The link works for 3 days. If you did not create an account, ignore this message.</p>`,
  };
}

export function resetEmail(link: string): Pick<Mail, "subject" | "text" | "html"> {
  return {
    subject: "Reset your Nori password",
    text: `Someone asked to reset the password for this Nori account. To choose a new one, open:\n\n${link}\n\nThe link works for one hour and only once. If this was not you, ignore this message; your password stays as it is.`,
    html: `<p>Someone asked to reset the password for this Nori account.</p><p><a href="${esc(link)}">Choose a new password</a></p><p>The link works for one hour and only once. If this was not you, ignore this message; your password stays as it is.</p>`,
  };
}
