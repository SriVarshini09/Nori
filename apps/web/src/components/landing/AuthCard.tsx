"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle, Lock, Mail, UserRound, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";

const field =
  "h-[52px] w-full rounded-2xl border border-[#e8dcc0] bg-white/80 pl-12 pr-4 text-[15px] text-[#3b2410] placeholder:text-[#a99a80] transition-[border-color,box-shadow] duration-150 hover:border-[#d6c18f] focus:border-[#f2a900] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#f2a900]/20";

/** Only same-site paths are honoured as a post-login destination. */
const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

function Row({ label, icon: I, hint, children }: { label: string; icon: LucideIcon; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#6b5a43]">{label}</span>
      <span className="relative block">
        <I size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8f7e63]" />
        {children}
      </span>
      {hint && <span className="mt-1.5 block text-[12px] text-[#8f7e63]">{hint}</span>}
    </label>
  );
}

/** Account card in the meadow style: sign-up on the front page and on /signup, sign-in on /login. */
export function AuthCard({ mode = "signup", next }: { mode?: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const signup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (signup) await api.signup(email.trim(), password, name.trim());
      else await api.login(email.trim(), password);
      router.replace(signup ? "/onboarding" : safeNext(next));
      router.refresh();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        status === 401 ? "That email and password do not match."
          : status === 409 ? "An account with that email already exists."
          : err instanceof ApiError ? err.detail : (err as Error).message,
      );
      setBusy(false);
    }
  }

  return (
    <div id="start" className="relative rounded-[32px] border border-white/70 bg-[#fffdf6]/90 p-6 shadow-[0_30px_80px_-30px_rgba(120,80,0,0.45),0_2px_0_rgba(255,255,255,0.9)_inset] backdrop-blur-xl sm:p-9">
      <span className="inline-flex items-center gap-2 rounded-full bg-[#eef6df] px-3.5 py-1.5 text-[12.5px] font-semibold text-[#2f5a1f]"><span className="h-2 w-2 rounded-full bg-[#4fa83e]" />{signup ? "Create account" : "Sign in"}</span>
      <h2 className="mt-5 font-display text-[2.4rem] font-semibold leading-[0.95] tracking-[-0.045em] text-[#4a2410] sm:text-[3rem]">
        {signup ? <>Start your<br />search.</> : <>Good to see<br />you again.</>}
      </h2>
      <p className="mt-3 max-w-[34ch] text-[16px] leading-relaxed text-[#6b5a43]">
        {signup ? "Create your account and take the first step towards a brighter career." : "Sign in to see what I found while you were away."}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {signup && (
          <Row label="Name" icon={UserRound}>
            <input className={field} placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </Row>
        )}
        <Row label="Email" icon={Mail}>
          <input className={field} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Row>
        <Row label="Password" icon={Lock} hint={signup ? "At least 8 characters." : undefined}>
          <input
            className={`${field} pr-12`}
            type={show ? "text" : "password"}
            placeholder={signup ? "Create a strong password" : "Your password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 8 : undefined}
            required
          />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-[#8f7e63] transition-colors hover:bg-[#f4ead0] hover:text-[#4a2410]">
            {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </Row>

        {!signup && (
          <p className="-mt-1 text-right text-[13px]">
            <Link href="/forgot-password" className="font-medium text-[#8a5a14] underline decoration-[#f2a900]/50 underline-offset-4 transition-colors hover:text-[#4a2410]">Forgot password?</Link>
          </p>
        )}

        <p role="alert" aria-live="polite" className="min-h-5">
          {error && <span className="inline-flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700 ring-1 ring-inset ring-rose-600/15"><CircleAlert size={16} aria-hidden="true" className="mt-px" />{error}</span>}
        </p>

        <button type="submit" disabled={busy} className="group inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#5a2a12] text-[16px] font-semibold text-white shadow-[0_14px_30px_-12px_rgba(90,42,18,0.7)] transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-[#6b3319] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2a900] disabled:opacity-70">
          {busy ? <><LoaderCircle size={18} aria-hidden="true" className="animate-spin" />{signup ? "Creating account" : "Signing in"}</> : <>{signup ? "Create account" : "Sign in"}<ArrowRight size={18} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-1" /></>}
        </button>
      </form>

      {signup && (
        <p className="mt-5 text-center text-[12.5px] leading-relaxed text-[#8f7e63]">
          By creating an account you agree to the <Link href="/terms" className="underline underline-offset-2 hover:text-[#4a2410]">Terms</Link> and the <Link href="/privacy" className="underline underline-offset-2 hover:text-[#4a2410]">Privacy page</Link>.
        </p>
      )}
      <p className="mt-5 border-t border-[#eadfc4] pt-4 text-center text-[13.5px] text-[#6b5a43]">
        {signup ? "Already have an account? " : "New to Nori? "}
        <Link href={signup ? "/login" : "/signup"} className="font-semibold text-[#8a5a14] underline decoration-[#f2a900]/50 underline-offset-4 transition-colors hover:text-[#4a2410]">{signup ? "Sign in" : "Create an account"}</Link>
      </p>
    </div>
  );
}
