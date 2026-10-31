"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Motion helpers for the landing page. Everything here is still under prefers-reduced-motion. */

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeReduce = (cb: () => void) => {
  const m = window.matchMedia(REDUCE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** True when the person asked for less motion. False during server render. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE).matches, () => false);
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Where `p` sits between `from` and `to`, as 0..1. */
export const span = (p: number, from: number, to: number) => clamp((p - from) / (to - from));

/** Ease out cubic: quick start, soft landing. */
export const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);

/** The first `t` share of `text`, for scrubbed typing. */
export const typed = (text: string, t: number) => text.slice(0, Math.round(text.length * clamp(t)));

/** True once the element has been on screen (or every time, with `once: false`). */
export function useInView(ref: RefObject<Element | null>, { once = true, margin = "0px 0px -12% 0px" } = {}) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true);
        if (once) io.disconnect();
      } else if (!once) setSeen(false);
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, margin]);
  return seen;
}

/**
 * How far the page has scrolled through a tall element, 0 at its top reaching the top of the viewport and 1 when its
 * bottom reaches the bottom. React only re-renders when the value moves.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let last = -1;
    // Scroll events already arrive at most once per frame, so read straight away: waiting for an animation frame
    // would freeze the value in a background tab.
    const read = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const next = travel > 0 ? clamp(-r.top / travel) : r.top <= 0 ? 1 : 0;
      if (Math.abs(next - last) > 0.0008) { last = next; setP(next); }
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [ref]);
  return p;
}

/** How far the whole page has scrolled, 0..1. */
export function usePageProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const read = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setP(max > 0 ? clamp(window.scrollY / max) : 0);
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);
  return p;
}
