"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, BadgeCheck, Check, FileText, FileUp, ListChecks, Network, Plug, ShieldCheck, SlidersHorizontal, UserRound, type LucideIcon,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { ONBOARDING_STEPS, type IngestResult, type Integration, type ModelPresetsInfo, type ModelSettings, type OnboardingStep, type OnboardingStepId, type Profile } from "@/lib/types";
import { Icon, Notice, cx } from "../ui";
import { Doll } from "../dash/Doll";
import { Letters } from "../Letters";
import { IntegrationsStep } from "./IntegrationsStep";
import { ResumeStep } from "./ResumeStep";
import { AuthorizationStep, ContactStep, PreferencesStep, ScreeningStep } from "./steps";

type Meta = { id: OnboardingStepId; label: string; icon: LucideIcon; title: [string, string]; lead: string; note: string };

export const STEP_META: Meta[] = [
  { id: "resume", label: "Resume", icon: FileUp, title: ["Start with", "your resume."], lead: "Your career graph is built from it.", note: "Drop your resume and I will read it." },
  { id: "contact", label: "Contact", icon: UserRound, title: ["How employers", "reach you."], lead: "Prefilled from your resume.", note: "Quick check: is this how they reach you?" },
  { id: "authorization", label: "Authorization", icon: BadgeCheck, title: ["Where you", "can work."], lead: "Every US form asks these.", note: "Forms always ask this. Answer once." },
  { id: "screening", label: "Screening", icon: ListChecks, title: ["Answers forms", "always ask."], lead: "Set once, reused on every application.", note: "Set once, reused on every form." },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal, title: ["What you", "want next."], lead: "Shapes discovery, scoring and the agent.", note: "Tell me what you want next." },
  { id: "integrations", label: "Integrations", icon: Plug, title: ["Pick a model,", "connect your tools."], lead: "Optional. You can do this later in Settings.", note: "Last step! Connect your tools." },
];

/** Index of the first unfinished step; "done" sits one past the last so every step reads as complete. */
const stepIndex = (s: OnboardingStep) => (s === "done" ? ONBOARDING_STEPS.length : Math.max(0, ONBOARDING_STEPS.indexOf(s)));

/** Fills empty profile fields from the resume's contact block. */
function withPatch(p: Profile, patch: IngestResult["profilePatch"]): Profile {
  const next = { ...p } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) if (v && !next[k]) next[k] = v;
  return next as Profile;
}

const PROMISES: { icon: LucideIcon; title: string; text: string; grad: string }[] = [
  { icon: Network, title: "Career graph", text: "Your history becomes facts I can prove.", grad: "from-emerald-400 to-teal-500" },
  { icon: FileText, title: "Tailored resumes", text: "One page, every line traced to you.", grad: "from-amber-300 to-orange-500" },
  { icon: ShieldCheck, title: "You stay in charge", text: "I stop at every form until you say go.", grad: "from-fuchsia-400 to-violet-500" },
];

function Stage({ message, cheer, className }: { message: string[]; cheer: number; className: string }) {
  return (
    <div className={cx("relative", className)}>
      <span aria-hidden="true" className="absolute left-1/2 top-[48%] h-[75%] w-[75%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,214,150,0.4),rgba(255,122,184,0.18)_55%,transparent)] blur-2xl" />
      <Doll messages={message} cheer={cheer} />
    </div>
  );
}

function Path({ current, furthest, onSelect }: { current: number; furthest: number; onSelect: (i: number) => void }) {
  return (
    <>
      {/* phones: a summary line and six segments */}
      <div className="mt-2 lg:hidden">
        <p className="flex items-baseline gap-2 text-[13px] text-white/60">
          <span className="tnum">Step {current + 1} of {STEP_META.length}</span>
          <span className="font-medium text-white">{STEP_META[current].label}</span>
        </p>
        <ol className="mt-3 grid grid-cols-6 gap-1.5" aria-label="Onboarding steps">
          {STEP_META.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                aria-label={`${i + 1} ${s.label}`}
                aria-current={i === current ? "step" : undefined}
                disabled={i > furthest}
                onClick={() => onSelect(i)}
                className={cx("block h-1.5 w-full rounded-full transition-colors duration-300", i === current ? "bg-gradient-to-r from-[#6ef0b3] to-[#ffb347]" : i < furthest ? "bg-white/70" : "bg-white/15")}
              />
            </li>
          ))}
        </ol>
      </div>

      {/* desktop: glass path with a line that fills as you go */}
      <nav aria-label="Onboarding steps" className="dash-glass mt-4 hidden rounded-3xl p-5 lg:block">
        <ol>
          {STEP_META.map((s, i) => {
            const isCurrent = i === current;
            const isDone = i < furthest || i < current;
            const reachable = i <= furthest;
            const last = i === STEP_META.length - 1;
            return (
              <li key={s.id} className={cx("relative", !last && "pb-4")}>
                {!last && (
                  <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-[2px] overflow-hidden rounded-full bg-white/15">
                    <span className="ob-line absolute inset-0 bg-gradient-to-b from-[#6ef0b3] to-[#ffb347]" style={{ transform: `scaleY(${i < Math.max(furthest, current) ? 1 : 0})` }} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  disabled={!reachable}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cx("group flex w-full items-center gap-3 text-left transition-colors duration-150", isCurrent ? "text-white" : reachable ? "text-white/75 hover:text-white" : "text-white/35")}
                >
                  <span
                    className={cx(
                      "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300",
                      isCurrent ? "bg-gradient-to-br from-[#6ef0b3] to-[#ffb347] text-[#06221b] shadow-[0_0_0_5px_rgba(110,240,179,0.18)]" : isDone ? "bg-white text-[#06221b]" : "bg-white/10 ring-1 ring-inset ring-white/20",
                    )}
                  >
                    <Icon icon={isDone && !isCurrent ? Check : s.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className={cx("block text-[14px]", isCurrent && "font-semibold")}>{s.label}</span>
                    {isCurrent && <span className="block truncate text-[12px] text-white/55">{s.lead}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}

const CONFETTI = ["#6ef0b3", "#ffb347", "#ff7ab8", "#a99bff", "#5ec2ff", "#ffffff"];

function Confetti() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 44 }, (_, i) => (
        <span
          key={i}
          className="ob-confetti"
          style={{
            left: `${(i * 37) % 100}%`,
            background: CONFETTI[i % CONFETTI.length],
            width: 6 + (i % 4) * 3,
            height: 10 + (i % 3) * 5,
            animationDuration: `${3.4 + (i % 6) * 0.55}s`,
            animationDelay: `${((i * 23) % 30) / 10}s`,
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}

export function OnboardingWizard({ initialStep, serverStep, profile: initialProfile, integrations, model, presets, replayWelcome = false }: {
  initialStep: OnboardingStepId;
  serverStep: OnboardingStep;
  profile: Profile;
  integrations: Integration[];
  model: ModelSettings | null;
  presets: ModelPresetsInfo;
  /** `/onboarding?welcome=1` plays the intro again. */
  replayWelcome?: boolean;
}) {
  const router = useRouter();
  const fresh = serverStep === "resume" && initialStep === "resume" && !initialProfile.rawResumeText;
  const [welcome, setWelcome] = useState(fresh || replayWelcome);
  const [done, setDone] = useState(false);
  const [current, setCurrent] = useState(ONBOARDING_STEPS.indexOf(initialStep));
  const [furthest, setFurthest] = useState(Math.max(stepIndex(serverStep), ONBOARDING_STEPS.indexOf(initialStep)));
  const [profile, setProfile] = useState(initialProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cheer, setCheer] = useState(0);
  const [found, setFound] = useState<number | null>(null);
  const meta = STEP_META[current];
  const first = (profile.fullName ?? "").trim().split(/\s+/)[0] || "there";

  const welcomeNotes = useMemo(() => [`Hi ${first}! I am Nori.`, "Let me learn about you.", "I never invent a thing."], [first]);
  const stepNote = useMemo(
    () => [meta.id === "resume" && found != null ? `Found ${found} facts about you. Nice!` : meta.note],
    [meta.id, meta.note, found],
  );
  const doneNotes = useMemo(() => [`All set, ${first}!`, "Let us go find your next role."], [first]);

  // the mascot keeps celebrating on the finish screen
  useEffect(() => {
    if (!done) return;
    const t = setInterval(() => setCheer((c) => c + 1), 1800);
    return () => clearInterval(t);
  }, [done]);

  function go(i: number) {
    setCurrent(i);
    setError(null);
    window.history.replaceState(null, "", `/onboarding?step=${ONBOARDING_STEPS[i]}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    setCheer((c) => c + 1);
    go(next);
  }

  // Skip and Finish both close the wizard; connections made in the other tab are already stored server-side.
  async function finish() {
    if (!(await save({}))) return;
    router.prefetch("/dashboard");
    setDone(true);
    window.scrollTo({ top: 0 });
  }

  function open() {
    router.push("/dashboard");
    router.refresh();
  }

  const back = current > 0 ? () => go(current - 1) : undefined;
  const status = error ? <Notice tone="red">{error}</Notice> : undefined;
  const common = { profile, busy, onBack: back, status, onSubmit: (d: Record<string, unknown>) => saveAndNext(d) };

  // ---------------------------------------------------------------- finish
  if (done) {
    return (
      <div className="relative grid min-h-[calc(100vh-9rem)] items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Confetti />
        <div>
          <h1 className="font-display text-[3rem] font-medium leading-[0.95] tracking-[-0.05em] sm:text-[5rem]" aria-label={`You are all set, ${first}`}>
            <Letters text="You are" /><br />
            <Letters text={`all set, ${first}.`} from={7} grad />
          </h1>
          <p className="ob-rise mt-6 max-w-lg text-[17px] leading-relaxed text-white/70" style={{ ["--i" as string]: 8 }}>
            Your career graph is ready. I will start finding roles, and I will always ask before anything gets sent.
          </p>
          <button type="button" onClick={open} className="dash-btn-sun ob-rise group mt-8 inline-flex h-14 items-center gap-3 rounded-full px-9 text-[16px] font-semibold transition-transform duration-150 hover:-translate-y-0.5" style={{ ["--i" as string]: 10 }}>
            Open my dashboard
            <Icon icon={ArrowRight} size={19} className="transition-transform duration-150 group-hover:translate-x-1" />
          </button>
        </div>
        <Stage message={doneNotes} cheer={cheer} className="h-[360px] sm:h-[520px]" />
      </div>
    );
  }

  // ---------------------------------------------------------------- welcome
  if (welcome) {
    return (
      <div className="grid min-h-[calc(100vh-9rem)] items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <span className="ob-rise inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-[12.5px] font-medium text-emerald-100/90 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" /> Setup takes about 3 minutes
          </span>
          <h1 className="mt-6 font-display text-[3.6rem] font-medium leading-[0.92] tracking-[-0.055em] sm:text-[6.5rem]" aria-label={`Hi, ${first}!`}>
            <Letters text="Hi," /><br />
            <Letters text={`${first}!`} from={3} grad />
            <span className="ob-wave ml-3 align-top text-[0.7em]" aria-hidden="true">&#128075;</span>
          </h1>
          <p className="ob-rise mt-6 max-w-xl text-[17px] leading-relaxed text-white/70" style={{ ["--i" as string]: 6 }}>
            I am Nori, your job agent. Six quick steps and I will know enough to find roles, tailor your resume and fill the forms.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {PROMISES.map((p, i) => (
              <li key={p.title} className="dash-glass ob-rise rounded-2xl p-4 transition-colors duration-200 hover:bg-white/[0.14]" style={{ ["--i" as string]: 8 + i }}>
                <span className={cx("flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg", p.grad)}><Icon icon={p.icon} size={18} /></span>
                <p className="mt-3 text-[14.5px] font-semibold text-white">{p.title}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-white/55">{p.text}</p>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => { setWelcome(false); setCheer((c) => c + 1); }} className="dash-btn-sun ob-rise group mt-9 inline-flex h-14 items-center gap-3 rounded-full px-9 text-[16px] font-semibold transition-transform duration-150 hover:-translate-y-0.5" style={{ ["--i" as string]: 12 }}>
            Let us get started
            <Icon icon={ArrowRight} size={19} className="transition-transform duration-150 group-hover:translate-x-1" />
          </button>
        </div>
        <Stage message={welcomeNotes} cheer={cheer} className="h-[360px] sm:h-[540px]" />
      </div>
    );
  }

  // ---------------------------------------------------------------- steps
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,370px)_minmax(0,1fr)] lg:gap-12">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Stage message={stepNote} cheer={cheer} className="h-[250px] sm:h-[310px] lg:h-[330px] lg:[@media(max-height:760px)]:h-[230px]" />
        <Path current={current} furthest={furthest} onSelect={(i) => i <= furthest && go(i)} />
      </aside>

      <section className="ob-card min-w-0 p-6 text-ink sm:p-10">
        <div key={meta.id} className="ob-step-in">
          <header>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/15">
              <Icon icon={meta.icon} size={14} />
              Step {current + 1} of {STEP_META.length} &middot; {meta.label}
            </span>
            <h2 className="mt-5 font-display text-[2.2rem] font-medium leading-[1] tracking-[-0.04em] text-ink sm:text-[3rem]">
              {meta.title[0]}<br />{meta.title[1]}
            </h2>
            <p className="mt-3 text-body text-muted">{meta.lead}</p>
          </header>

          <div className="mt-9">
            {meta.id === "resume" && (
              <>
                <ResumeStep
                  hasResume={!!profile.rawResumeText}
                  busy={busy}
                  onResult={(r) => { setFound(r.nodesCreated); setCheer((c) => c + 1); }}
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
                <IntegrationsStep initial={integrations} model={model} presets={presets} busy={busy} onBack={back} onFinish={finish} />
                {error && <div className="mt-5"><Notice tone="red">{error}</Notice></div>}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
