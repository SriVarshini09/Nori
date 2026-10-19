"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert, LogIn, UserRoundPlus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Frame, Icon, IndexLabel, inputClass } from "./ui";

/** Only same-site paths are honoured as a post-login destination. */
const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = mode === "signup";

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
    <Frame className="w-full max-w-[420px] p-6 sm:p-8">
      <IndexLabel index="01" marker>{signup ? "Create account" : "Sign in"}</IndexLabel>
      <h1 className="mt-5 font-display text-[2.25rem] font-medium leading-[1] tracking-[-0.04em] text-ink sm:text-[2.75rem]">
        {signup ? <>Start your<br />search.</> : <>Welcome<br />back.</>}
      </h1>
      <form onSubmit={submit} className="mt-8 space-y-5">
        {signup && (
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </Field>
        )}
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Password" hint={signup ? "At least 8 characters." : undefined}>
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 8 : undefined}
            required
          />
        </Field>
        <p role="alert" aria-live="polite" className="flex min-h-5 items-start gap-2 text-meta text-accent-ink">
          {error && <><Icon icon={CircleAlert} className="mt-[1px]" />{error}</>}
        </p>
        <Button type="submit" variant="primary" icon={signup ? UserRoundPlus : LogIn} disabled={busy} className="w-full">
          {busy ? (signup ? "Creating account..." : "Signing in...") : signup ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 border-t border-line pt-5 text-meta text-muted">
        {signup ? "Already have an account? " : "New to Nori? "}
        <Link href={signup ? "/login" : "/signup"} className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </Frame>
  );
}
