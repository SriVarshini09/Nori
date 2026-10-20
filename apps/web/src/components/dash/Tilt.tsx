"use client";

import { useRef, type ReactNode } from "react";

/** Card that leans toward the pointer and carries a soft glare. Flat on touch devices and with reduced motion. */
export function Tilt({ children, className, max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLElement>(null);

  function move(e: React.PointerEvent<HTMLElement>) {
    const el = ref.current;
    if (!el || e.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-(py - 0.5) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    el.style.setProperty("--glow", "1");
  }
  function leave() {
    const el = ref.current;
    if (!el) return;
    for (const k of ["--rx", "--ry", "--glow"]) el.style.removeProperty(k);
  }

  return (
    <article ref={ref} onPointerMove={move} onPointerLeave={leave} className={className}>
      {children}
    </article>
  );
}
