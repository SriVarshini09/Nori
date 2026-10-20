"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";

/** Number that counts up from zero on mount. Final value is rendered on the server so it never reads as 0 without JS. */
export function CountUp({ value, decimals = 0, duration = 1100 }: { value: number; decimals?: number; duration?: number }) {
  const el = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = el.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        node.textContent = (value * (1 - Math.pow(1 - t, 4))).toFixed(decimals);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    node.textContent = (0).toFixed(decimals);
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting) { io.disconnect(); run(); }
    });
    io.observe(node);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, decimals, duration]);

  return <span ref={el} className="tnum">{value.toFixed(decimals)}</span>;
}

/** Creates an application for a job and jumps to its review page. */
export function DashApply({ jobId, label = "Apply" }: { jobId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const app = await api.createApplication(jobId);
      router.push(`/applications/${app.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={go} disabled={busy} className="dash-btn group inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13px] font-medium disabled:opacity-60">
        {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}
        {busy ? "Starting" : label}
        {!busy && <ArrowRight size={15} aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-0.5" />}
      </button>
      {error && <span className="max-w-[14rem] text-right text-[12px] text-rose-600">{error}</span>}
    </span>
  );
}
