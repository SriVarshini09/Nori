"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle, Lock, Mail, UserRound, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Doll } from "./dash/Doll";
import { Letters } from "./Letters";
import { ObButton } from "./onboarding/controls";
import { Icon, cx } from "./ui";

/** Only same-site paths are honoured as a post-login destination. */
const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

const field =
  "h-12 w-full rounded-xl border border-black/10 bg-white pl-11 pr-4 text-[15px] text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-black/25 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/15";

function Row({ label, icon, hint, children }: { label: string; icon: LucideIcon; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-label font-medium uppercase text-muted">{label}</span>
      <span className="relative block">
        <Icon icon={icon} size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        {children}
      </span>
      {hint && <span className="mt-1.5 block text-[12px] text-faint">{hint}</span>}
    </label>
  );
}

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [focus, setFocus] = useState<"name" | "email" | "password" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cheer, setCheer] = useState(0);
  const signup = mode === "signup";
  const first = name.trim().split(/\s+/)[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (signup) await api.signup(email.trim(), password, name.trim());
      else await api.login(email.trim(), password);
      setCheer((c) => c + 1);
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

  // Nori's note follows what you are doing
  const notes = useMemo(() => {
    if (busy) return [signup ? "Making your account..." : "Signing you in..."];
    if (error) return ["Hmm, that did not work. Try again?"];
    if (focus === "password") return ["I am not looking. Promise!"];
    if (focus === "email") return [signup ? "Where can I reach you?" : "Which email is it?"];
    if (focus === "name" && first) return [`Nice to meet you, ${first}!`];
    if (focus === "name") return ["What should I call you?"];
    return signup
      ? ["Hi! I am Nori. Let us get you set up.", "Takes about 30 seconds."]
      : ["Welcome back! I missed you.", "Your queue is waiting."];
  }, [busy, error, focus, signup, first]);

  return (
    <div className="grid w-full items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-14">
      {/* left: Nori says hi */}
      <div className="order-2 lg:order-1">
        <h1 className="font-display text-[2.6rem] font-medium leading-[0.95] tracking-[-0.05em] sm:text-[3.6rem] xl:text-[4.4rem]" aria-label={signup ? "Hi, new friend!" : "Welcome back, friend."}>
          {signup ? (
            <>
              <Letters text="Hi there," /><br />
              <Letters text="new friend." from={9} grad />
            </>
          ) : (
            <>
              <Letters text="Welcome back," /><br />
              <Letters text="friend." from={14} grad />
            </>
          )}
          <span className="ob-wave ml-3 align-top text-[0.6em]" aria-hidden="true">&#128075;</span>
        </h1>
        <p className="ob-rise mt-5 max-w-md text-[16px] leading-relaxed text-white/65" style={{ ["--i" as string]: 8 }}>
          {signup ? "Create your account and I will build your career graph, find roles and tailor every application." : "Sign in to see what I found while you were away."}
        </p>
        <div className="relative mt-2 h-[300px] sm:h-[400px]">
          <span aria-hidden="true" className="absolute left-1/2 top-[48%] h-[75%] w-[75%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,214,150,0.4),rgba(255,122,184,0.18)_55%,transparent)] blur-2xl" />
          <Doll messages={notes} cheer={cheer} shy={focus === "password"} />
        </div>
      </div>

      {/* right: the form */}
      <div className="ob-card ob-step-in order-1 p-6 text-ink sm:p-9 lg:order-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/15">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {signup ? "Create account" : "Sign in"}
        </span>
        <h2 className="mt-5 font-display text-[2.2rem] font-medium leading-[1] tracking-[-0.04em] text-ink sm:text-[2.7rem]">
          {signup ? <>Start your<br />search.</> : <>Good to see<br />you again.</>}
        </h2>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {signup && (
            <Row label="Name" icon={UserRound}>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} onFocus={() => setFocus("name")} onBlur={() => setFocus(null)} autoComplete="name" required />
            </Row>
          )}
          <Row label="Email" icon={Mail}>
            <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} onFocus={() => setFocus("email")} onBlur={() => setFocus(null)} autoComplete="email" required />
          </Row>
          <Row label="Password" icon={Lock} hint={signup ? "At least 8 characters." : undefined}>
            <input
              className={cx(field, "pr-12")}
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocus("password")}
              onBlur={() => setFocus(null)}
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : undefined}
              required
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-faint transition-colors hover:bg-stone hover:text-ink"
            >
              <Icon icon={show ? EyeOff : Eye} size={17} />
            </button>
          </Row>

          {!signup && (
            <p className="-mt-1 text-right text-meta">
              <Link href="/forgot-password" className="font-medium text-emerald-700 underline decoration-emerald-600/30 underline-offset-4 transition-colors hover:decoration-emerald-600">Forgot password?</Link>
            </p>
          )}

          <p role="alert" aria-live="polite" className="min-h-6">
            {error && (
              <span className="ob-pop inline-flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-meta font-medium text-rose-700 ring-1 ring-inset ring-rose-600/15">
                <Icon icon={CircleAlert} className="mt-[1px]" />{error}
              </span>
            )}
          </p>

          <ObButton type="submit" disabled={busy} className="h-12 w-full text-[15px]">
            {busy ? <><Icon icon={LoaderCircle} className="animate-spin" />{signup ? "Creating account" : "Signing in"}</> : <>{signup ? "Create account" : "Sign in"}<Icon icon={ArrowRight} className="transition-transform duration-150 group-hover:translate-x-0.5" /></>}
          </ObButton>
        </form>

        {signup && (
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            By creating an account you agree to the <Link href="/terms" className="underline underline-offset-2 hover:text-ink">Terms</Link> and the <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">Privacy page</Link>.
          </p>
        )}

        <p className="mt-7 border-t border-black/[0.06] pt-5 text-meta text-muted">
          {signup ? "Already have an account? " : "New to Nori? "}
          <Link href={signup ? "/login" : "/signup"} className="font-semibold text-emerald-700 underline decoration-emerald-600/30 underline-offset-4 transition-colors hover:decoration-emerald-600">
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </div>
  );
}
