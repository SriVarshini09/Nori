"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Hash, Laptop, Mail, MessageCircle, RotateCcw, Send, type LucideIcon } from "lucide-react";
import { cx } from "@/components/cx";
import { NoriMark } from "@/components/Logo";
import { useInView, useReducedMotion } from "./motion";

type Line = { who: "me" | "nori"; text: string; actions?: boolean };

/** The commands are the real ones (see the README); the replies are a sample run. */
const SCRIPT: Line[] = [
  { who: "me", text: "find senior frontend remote" },
  { who: "nori", text: "Found 6 in your lane. Best: Tidewater, Frontend Engineer, 92%." },
  { who: "me", text: "apply 1" },
  { who: "nori", text: "Resume ready. 3 lines changed, each from your graph.", actions: true },
  { who: "me", text: "Approve" },
  { who: "nori", text: "Form filled: 7 fields, 0 guesses. Send it?", actions: true },
  { who: "me", text: "status" },
  { who: "nori", text: "1 sent today, 1 waiting on you. Next look in 18 min." },
];

const CHANNELS: { icon: LucideIcon; name: string; line: string }[] = [
  { icon: Send, name: "Telegram", line: "Approve from your phone" },
  { icon: MessageCircle, name: "WhatsApp", line: "Updates where you already are" },
  { icon: Hash, name: "Slack", line: "A DM, like a teammate" },
  { icon: Mail, name: "Email", line: "Replies and codes, read for you" },
  { icon: Laptop, name: "Companion", line: "A small Nori beside your clock" },
  { icon: Bot, name: "MCP", line: "Let your own agent drive it" },
];

export function Anywhere() {
  const reduce = useReducedMotion();
  const phone = useRef<HTMLDivElement>(null);
  const seen = useInView(phone);
  const [n, setN] = useState(0);
  const [typing, setTyping] = useState(false);
  const [run, setRun] = useState(0);
  const shown = reduce ? SCRIPT.length : n;

  // Play the conversation once it is on screen: Nori "types" before each of its lines.
  useEffect(() => {
    if (!seen || reduce) return;
    const timers: number[] = [];
    let at = 500;
    SCRIPT.forEach((line, i) => {
      if (line.who === "nori") {
        timers.push(window.setTimeout(() => setTyping(true), at));
        at += 900;
      }
      timers.push(window.setTimeout(() => { setTyping(false); setN(i + 1); }, at));
      at += line.who === "me" ? 700 : 1300;
    });
    return () => timers.forEach(clearTimeout);
  }, [seen, reduce, run]);

  const replay = () => { setN(0); setTyping(false); setRun((r) => r + 1); };

  return (
    <section id="anywhere" aria-labelledby="anywhere-title" className="relative scroll-mt-16 overflow-hidden">
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-14 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:px-8">
        <div className="relative mx-auto w-full max-w-[340px]">
          <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-[120%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(196,242,106,0.45),transparent)] blur-2xl" />
          <div ref={phone} className="relative rounded-[46px] bg-[#1d1b18] p-3 shadow-[0_50px_80px_-40px_rgba(11,63,49,0.6)]">
            <div className="overflow-hidden rounded-[36px] bg-[#f4efe2]">
              <div className="flex items-center gap-2.5 border-b border-black/5 bg-white/80 px-4 pb-3 pt-7 backdrop-blur">
                <NoriMark size={34} />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-ink">Nori</p>
                  <p className="text-[11.5px] text-[var(--sprout-ink)]">{typing ? "typing…" : "online"}</p>
                </div>
              </div>
              <div className="flex h-[440px] flex-col justify-end gap-2 overflow-hidden px-3 pb-4 pt-3" aria-live="polite">
                {SCRIPT.slice(0, shown).map((l, i) => (
                  <div key={`${run}-${i}`} className={cx("ln-pop flex flex-col", l.who === "me" ? "items-end" : "items-start")}>
                    <p className={cx("max-w-[82%] rounded-[18px] px-3.5 py-2 text-[13.5px] leading-snug", l.who === "me" ? "rounded-br-[6px] bg-[var(--nori)] font-mono text-[12.5px] text-[var(--rice)]" : "rounded-bl-[6px] bg-white text-ink shadow-[0_1px_0_rgba(0,0,0,0.04)]")}>
                      {l.text}
                    </p>
                    {l.actions && (
                      <div className="mt-1.5 flex gap-1.5">
                        <span className={cx("rounded-full px-3 py-1 text-[12px] font-semibold", SCRIPT[i + 1]?.text === "Approve" && shown > i + 1 ? "bg-[var(--sprout)] text-[var(--nori)]" : "bg-white text-ink")}>Approve</span>
                        <span className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-ink-2">Skip</span>
                      </div>
                    )}
                  </div>
                ))}
                {typing && (
                  <div className="ln-pop self-start rounded-[18px] rounded-bl-[6px] bg-white px-3.5 py-3 text-[var(--nori-mid)]">
                    <span className="ln-typing flex gap-1"><span /><span /><span /></span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {!reduce && shown === SCRIPT.length && (
            <button type="button" onClick={replay} className="ln-pop absolute -bottom-12 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-muted transition-colors hover:bg-[var(--rice-2)] hover:text-ink">
              <RotateCcw size={13} aria-hidden="true" />Play it again
            </button>
          )}
        </div>

        <div>
          <p className="text-[13px] font-semibold text-[var(--sprout-ink)]">Talk to it</p>
          <h2 id="anywhere-title" className="mt-2 text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[3.2rem]">
            Approve from the bus. <span className="font-serif-display italic text-[var(--nori)]">Or the couch.</span>
          </h2>
          <p className="mt-4 max-w-[48ch] text-[17px] leading-relaxed text-ink-2">
            Text it the way you would text a friend. The same short commands work everywhere, and every message that needs you comes with Approve and Skip.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {CHANNELS.map((c) => (
              <li key={c.name} className="ln-lift flex items-center gap-3 rounded-[16px] border border-[var(--rice-line)] bg-white px-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[var(--rice-2)] text-[var(--nori)]"><c.icon size={19} aria-hidden="true" /></span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-ink">{c.name}</span>
                  <span className="block text-[13px] text-muted">{c.line}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
