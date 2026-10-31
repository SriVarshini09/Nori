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
 * bottom reaches the bottom. Read once per frame; React only re-renders when the value moves.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let frame = 0;
    let last = -1;
    const read = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const next = travel > 0 ? clamp(-r.top / travel) : r.top <= 0 ? 1 : 0;
      if (Math.abs(next - last) > 0.0008) { last = next; setP(next); }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
  return p;
}

/** How far the whole page has scrolled, 0..1. */
export function usePageProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setP(max > 0 ? clamp(window.scrollY / max) : 0);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return p;
}
