"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BadgeCheck, Check, FileUp, ListChecks, Plug, SlidersHorizontal, UserRound, type LucideIcon,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ONBOARDING_STEPS, type IngestResult, type Integration, type ModelSettings, type OnboardingStep, type OnboardingStepId, type Profile } from "@/lib/types";
import { Icon, IndexLabel, Notice, cx, idx } from "../ui";
import { IntegrationsStep } from "./IntegrationsStep";
import { ResumeStep } from "./ResumeStep";
import { AuthorizationStep, ContactStep, PreferencesStep, ScreeningStep } from "./steps";

type Meta = { id: OnboardingStepId; label: string; icon: LucideIcon; title: [string, string]; lead: string };

export const STEP_META: Meta[] = [
  { id: "resume", label: "Resume", icon: FileUp, title: ["Start with", "your resume."], lead: "Your career graph is built from it." },
  { id: "contact", label: "Contact", icon: UserRound, title: ["How employers", "reach you."], lead: "Prefilled from your resume." },
  { id: "authorization", label: "Authorization", icon: BadgeCheck, title: ["Where you", "can work."], lead: "Every US form asks these." },
  { id: "screening", label: "Screening", icon: ListChecks, title: ["Answers forms", "always ask."], lead: "Set once, reused on every application." },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal, title: ["What you", "want next."], lead: "Shapes discovery, scoring and the agent." },
  { id: "integrations", label: "Integrations", icon: Plug, title: ["Pick a model,", "connect your tools."], lead: "Optional. You can do this later in Settings." },
];

/** Index of the first unfinished step; "done" sits one past the last so every step reads as complete. */
const stepIndex = (s: OnboardingStep) => (s === "done" ? ONBOARDING_STEPS.length : Math.max(0, ONBOARDING_STEPS.indexOf(s)));

/** Fills empty profile fields from the resume's contact block. */
function withPatch(p: Profile, patch: IngestResult["profilePatch"]): Profile {
  const next = { ...p } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) if (v && !next[k]) next[k] = v;
  return next as Profile;
}

function Rail({ current, furthest, onSelect }: { current: number; furthest: number; onSelect: (i: number) => void }) {
  return (
    <>
      {/* phones: one summary line and six segments */}
      <div className="lg:hidden">
        <p className="flex items-baseline gap-2 text-meta">
          <span className="text-label font-medium uppercase text-faint tnum">Step {idx(current + 1)} / {idx(STEP_META.length)}</span>
          <span className="font-medium text-ink">{STEP_META[current].label}</span>
        </p>
        <ol className="mt-3 grid grid-cols-6 gap-1.5" aria-label="Onboarding steps">
          {STEP_META.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                aria-label={`${idx(i + 1)} ${s.label}`}
                aria-current={i === current ? "step" : undefined}
                disabled={i > furthest}
                onClick={() => onSelect(i)}
                className={cx("block h-[3px] w-full", i === current ? "bg-accent" : i < furthest ? "bg-ink" : "bg-line")}
              />
            </li>
          ))}
        </ol>
      </div>

      {/* desktop: numbered rail */}
      <nav aria-label="Onboarding steps" className="hidden lg:block">
        <IndexLabel marker>Setup</IndexLabel>
        <ol className="mt-6 border-t border-line">
          {STEP_META.map((s, i) => {
            const isCurrent = i === current;
            const isDone = i < furthest || i < current;
            const reachable = i <= furthest;
            return (
              <li key={s.id} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  disabled={!reachable}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cx(
                    "group relative flex w-full items-center gap-3 py-3.5 text-left transition-colors duration-150",
                    isCurrent ? "text-ink" : reachable ? "text-ink-2 hover:text-ink" : "text-faint",
                  )}
                >
                  <span aria-hidden="true" className={cx("absolute -left-4 top-1/2 h-[6px] w-[6px] -translate-y-1/2 bg-accent transition-opacity duration-150", isCurrent ? "opacity-100" : "opacity-0")} />
                  <span className="w-5 text-label font-medium text-faint tnum">{idx(i + 1)}</span>
                  <span
                    className={cx(
                      "flex h-7 w-7 items-center justify-center rounded-full border transition-colors duration-150",
                      isCurrent ? "border-ink bg-paper" : isDone ? "border-ink bg-ink text-paper" : "border-line",
                    )}
                  >
                    <Icon icon={isDone && !isCurrent ? Check : s.icon} />
                  </span>
                  <span className={cx("text-body-sm", isCurrent && "font-medium")}>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}

export function OnboardingWizard({ initialStep, serverStep, profile: initialProfile, integrations, model }: {
  initialStep: OnboardingStepId;
  serverStep: OnboardingStep;
  profile: Profile;
  integrations: Integration[];
  model: ModelSettings | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(ONBOARDING_STEPS.indexOf(initialStep));
  const [furthest, setFurthest] = useState(Math.max(stepIndex(serverStep), ONBOARDING_STEPS.indexOf(initialStep)));
  const [profile, setProfile] = useState(initialProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = STEP_META[current];

  function go(i: number) {
    setCurrent(i);
    setError(null);
    window.history.replaceState(null, "", `/onboarding?step=${ONBOARDING_STEPS[i]}`);
    window.scrollTo({ top: 0 });
  }

  async function save(data: Record<string, unknown>, base: Profile = profile): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveOnboarding(meta.id, data);
      setProfile({ ...base, ...data, ...(res?.profile ?? {}) } as Profile);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndNext(data: Record<string, unknown>, base?: Profile) {
    if (!(await save(data, base))) return;
    const next = Math.min(current + 1, STEP_META.length - 1);
    setFurthest((f) => Math.max(f, next));
    go(next);
  }

  // Skip and Finish both close the wizard; connections made in the other tab are already stored server-side.
  async function finish() {
    if (!(await save({}))) return;
    router.push("/dashboard");
    router.refresh();
  }

  const back = current > 0 ? () => go(current - 1) : undefined;
  const status = error ? <Notice tone="red">{error}</Notice> : undefined;
  const common = { profile, busy, onBack: back, status, onSubmit: (d: Record<string, unknown>) => saveAndNext(d) };

  return (
    <div className="grid grid-cols-12 gap-x-6 gap-y-10">
      <aside className="col-span-12 lg:sticky lg:top-24 lg:col-span-3 lg:self-start">
        <Rail current={current} furthest={furthest} onSelect={(i) => i <= furthest && go(i)} />
      </aside>

      <section className="col-span-12 min-w-0 lg:col-span-9 xl:col-span-8">
        <header>
          <div className="hidden lg:block"><IndexLabel index={`${idx(current + 1)} / ${idx(STEP_META.length)}`} marker>{meta.label}</IndexLabel></div>
          <h1 className="font-display lg:mt-5 text-[2.375rem] font-medium leading-[1] tracking-[-0.04em] text-ink sm:text-display-xl">
            {meta.title[0]}<br />{meta.title[1]}
          </h1>
          <p className="mt-4 text-body-sm text-muted">{meta.lead}</p>
        </header>

        <div className="mt-10" key={meta.id}>
          {meta.id === "resume" && (
            <>
              <ResumeStep
                hasResume={!!profile.rawResumeText}
                busy={busy}
                onDone={(r) => saveAndNext({}, r ? withPatch({ ...profile, rawResumeText: profile.rawResumeText ?? "uploaded" }, r.profilePatch) : profile)}
              />
              {error && <div className="mt-5"><Notice tone="red">{error}</Notice></div>}
            </>
          )}
          {meta.id === "contact" && <ContactStep {...common} />}
          {meta.id === "authorization" && <AuthorizationStep {...common} />}
          {meta.id === "screening" && <ScreeningStep {...common} />}
          {meta.id === "preferences" && <PreferencesStep {...common} />}
          {meta.id === "integrations" && (
            <>
              <IntegrationsStep initial={integrations} model={model} busy={busy} onBack={back} onFinish={finish} />
              {error && <div className="mt-5"><Notice tone="red">{error}</Notice></div>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
