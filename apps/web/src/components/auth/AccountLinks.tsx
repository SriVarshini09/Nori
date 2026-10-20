"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, Lock, Mail } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { ObButton } from "../onboarding/controls";
import { Icon, cx } from "../ui";

const field =
  "h-12 w-full rounded-xl border border-black/10 bg-white pl-11 pr-4 text-[15px] text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-black/25 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/15";

const message = (e: unknown) => (e instanceof ApiError ? e.detail : (e as Error).message);

/** The small centred card the account-link pages share (forgot, reset, verify). */
function LinkCard({ badge, title, children }: { badge: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[460px]">
      <div className="ob-card ob-step-in p-6 text-ink sm:p-9">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/15">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{badge}
        </span>
        <h1 className="mt-5 font-display text-[2rem] font-medium leading-[1.02] tracking-[-0.04em] text-ink sm:text-[2.4rem]">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 inline-flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-meta font-medium text-rose-700 ring-1 ring-inset ring-rose-600/15">
      <Icon icon={CircleAlert} className="mt-[1px]" />{children}
    </p>
  );
}

const backLink = (
  <p className="mt-7 border-t border-black/[0.06] pt-5 text-meta text-muted">
    <Link href="/login" className="font-semibold text-emerald-700 underline decoration-emerald-600/30 underline-offset-4 transition-colors hover:decoration-emerald-600">Back to sign in</Link>
  </p>
);

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.forgotPassword(email.trim()); setSent(true); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <LinkCard badge="Check your email" title={<>Link on<br />its way.</>}>
        <p role="status" className="mt-5 flex items-start gap-2 text-body-sm text-muted">
          <Icon icon={CircleCheck} className="mt-[3px] shrink-0 text-emerald-600" />
          <span>If an account exists for <strong className="text-ink">{email.trim()}</strong>, we have sent a link to choose a new password. It works for one hour.</span>
        </p>
        {backLink}
      </LinkCard>
    );
  }
  return (
    <LinkCard badge="Reset password" title={<>Forgot your<br />password?</>}>
      <p className="mt-4 text-body-sm text-muted">Enter the email you signed up with and we will send you a link to choose a new one.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-label font-medium uppercase text-muted">Email</span>
          <span className="relative block">
            <Icon icon={Mail} size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
            <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </span>
        </label>
        {error && <ErrorLine>{error}</ErrorLine>}
        <ObButton type="submit" disabled={busy || !email.trim()} className="h-12 w-full text-[15px]">
          {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Sending</> : <>Send reset link<Icon icon={ArrowRight} /></>}
        </ObButton>
      </form>
      {backLink}
    </LinkCard>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <LinkCard badge="Reset password" title={<>That link is<br />incomplete.</>}>
        <p className="mt-4 text-body-sm text-muted">Open the link from the email exactly as it was sent, or ask for a new one.</p>
        <p className="mt-6"><Link href="/forgot-password" className="font-semibold text-emerald-700 underline underline-offset-4">Send a new link</Link></p>
        {backLink}
      </LinkCard>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) { setError("The two passwords do not match."); return; }
    setBusy(true); setError(null);
    try { await api.resetPassword(token!, password); setDone(true); setTimeout(() => router.replace("/login"), 2500); }
    catch (err) { setError(message(err)); setBusy(false); }
  }

  if (done) {
    return (
      <LinkCard badge="Password changed" title={<>All set.</>}>
        <p role="status" className="mt-5 flex items-start gap-2 text-body-sm text-muted">
          <Icon icon={CircleCheck} className="mt-[3px] shrink-0 text-emerald-600" />
          <span>Your password is updated and every device was signed out. Taking you to sign in.</span>
        </p>
        <p className="mt-6"><Link href="/login" className="font-semibold text-emerald-700 underline underline-offset-4">Sign in now</Link></p>
      </LinkCard>
    );
  }
  return (
    <LinkCard badge="Reset password" title={<>Choose a<br />new password.</>}>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {[["New password", password, setPassword, "new-password"], ["Repeat it", again, setAgain, "new-password"]].map(([label, value, set, ac], i) => (
          <label key={label as string} className="block">
            <span className="mb-1.5 block text-label font-medium uppercase text-muted">{label as string}</span>
            <span className="relative block">
              <Icon icon={Lock} size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
              <input className={field} type="password" value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} autoComplete={ac as string} minLength={8} required />
            </span>
            {i === 0 && <span className="mt-1.5 block text-[12px] text-faint">At least 8 characters.</span>}
          </label>
        ))}
        {error && <ErrorLine>{error}</ErrorLine>}
        <ObButton type="submit" disabled={busy} className="h-12 w-full text-[15px]">
          {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />Saving</> : <>Set new password<Icon icon={ArrowRight} /></>}
        </ObButton>
      </form>
      {error && /expired|invalid/i.test(error) && <p className="mt-4 text-meta"><Link href="/forgot-password" className="font-semibold text-emerald-700 underline underline-offset-4">Send a new link</Link></p>}
      {backLink}
    </LinkCard>
  );
}

/** Spends the confirmation token once on arrival (a ref guards React's double effect). */
export function VerifyEmailStatus({ token }: { token?: string }) {
  const [state, setState] = useState<"working" | "ok" | "failed">(token ? "working" : "failed");
  const [error, setError] = useState<string | null>(token ? null : "This confirmation link is incomplete.");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.verifyEmail(token).then(() => setState("ok")).catch((err) => { setError(message(err)); setState("failed"); });
  }, [token]);

  return (
    <LinkCard badge="Email" title={state === "ok" ? <>You are<br />confirmed.</> : state === "working" ? <>Confirming<br />your email.</> : <>We could not<br />confirm that.</>}>
      {state === "working" && <p role="status" className="mt-5 flex items-center gap-2 text-body-sm text-muted"><Icon icon={LoaderCircle} className="animate-spin" />One moment.</p>}
      {state === "ok" && (
        <>
          <p role="status" className="mt-5 flex items-start gap-2 text-body-sm text-muted"><Icon icon={CircleCheck} className="mt-[3px] shrink-0 text-emerald-600" />Your email address is confirmed.</p>
          <p className="mt-6"><Link href="/dashboard" className={cx("inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-[14px] font-semibold text-white")}>Continue to Nori<Icon icon={ArrowRight} /></Link></p>
        </>
      )}
      {state === "failed" && (
        <>
          {error && <ErrorLine>{error}</ErrorLine>}
          <p className="mt-5 text-body-sm text-muted">Sign in and open <strong className="text-ink">Settings</strong> to get a new link.</p>
          <p className="mt-4"><Link href="/settings" className="font-semibold text-emerald-700 underline underline-offset-4">Go to Settings</Link></p>
        </>
      )}
    </LinkCard>
  );
}
