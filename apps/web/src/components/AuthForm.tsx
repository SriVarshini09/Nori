import { Sparkles, Star, UserRound, Zap } from "lucide-react";
import { AuthCard } from "./landing/AuthCard";
import { NoriBuddy } from "./landing/meadow";

const PERKS = [[UserRound, "Personalized", "career graph"], [Star, "Curated", "opportunities"], [Zap, "Tailored", "applications"]] as const;
const GOLD = "bg-gradient-to-r from-[#f7b500] to-[#f39a00] bg-clip-text text-transparent";

/** /login and /signup: Nori says hi on the left, the account card on the right. */
export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const signup = mode === "signup";
  return (
    <div className="grid w-full gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,480px)] lg:items-center">
      <div className="order-2 lg:order-1">
        <p className="ob-rise inline-flex items-center gap-2 rounded-full bg-[#fff3c4]/90 px-4 py-2 text-[13.5px] font-medium text-[#6b4a10] shadow-sm">
          <Sparkles size={15} aria-hidden="true" className="text-[#f2a900]" />{signup ? "Your career, your way" : "Your queue is waiting"}
        </p>
        <h1 className="mt-5 font-display text-[3rem] font-semibold leading-[0.9] tracking-[-0.04em] text-[#4a2410] sm:text-[4.7rem]">
          {signup ? <>Hi there,<br /><span className={GOLD}>new friend.</span></> : <>Welcome back,<br /><span className={GOLD}>friend.</span></>}
        </h1>
        <p className="ob-rise mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[#5b4630]" style={{ ["--i" as string]: 6 }}>
          {signup ? "Create your account and I will build your career graph, find roles and tailor every application." : "Sign in to see what I found while you were away."}
        </p>
        {signup && (
          <ul className="ob-rise mt-5 grid max-w-[560px] gap-3 sm:grid-cols-3" style={{ ["--i" as string]: 8 }}>
            {PERKS.map(([Ic, a, b]) => (
              <li key={a} className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#fff0b8] text-[#e59a00] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"><Ic size={22} aria-hidden="true" fill={a === "Personalized" ? "none" : "currentColor"} /></span>
                <span className="text-[14px] leading-tight text-[#4a3722]"><span className="block">{a}</span><span className="block">{b}</span></span>
              </li>
            ))}
          </ul>
        )}
        <NoriBuddy
          className="mx-auto mt-4 hidden w-full max-w-[440px] lg:-ml-2 lg:block"
          signText={signup ? ["Your", "growth", "starts", "here."] : ["Welcome", "back", "friend!"]}
          note={signup ? ["Takes about", "30 seconds."] : ["Your queue", "is waiting."]}
        />
      </div>
      <div className="order-1 lg:order-2"><AuthCard mode={mode} next={next} /></div>
    </div>
  );
}
