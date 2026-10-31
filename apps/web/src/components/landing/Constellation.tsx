"use client";

import { useEffect, useRef } from "react";

type Node = { x: number; y: number; vx: number; vy: number; r: number; kind: 0 | 1 | 2 };

/** Seaweed, sprout and a warm grey: roles, results, skills. */
const COLORS = ["11, 63, 49", "34, 197, 139", "142, 135, 125"];

/**
 * A career graph drifting behind the hero: facts as dots, the links between them as hairlines. Near the pointer the
 * graph wakes up and reaches toward it. One canvas, paused off screen, a single still frame for reduced motion.
 */
export function Constellation({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true;
    let nodes: Node[] = [];
    const pointer = { x: -9999, y: -9999, on: false };

    const seed = () => {
      const count = Math.round(Math.min(64, Math.max(22, (w * h) / 22000)));
      nodes = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: i % 7 === 0 ? 3.2 : 1.6 + Math.random() * 1.2,
        kind: (i % 7 === 0 ? 0 : i % 3 === 0 ? 1 : 2) as Node["kind"],
      }));
    };
    const size = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const link = Math.min(150, Math.max(90, w / 9));
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > link) continue;
          const near = pointer.on ? Math.max(0, 1 - Math.hypot((a.x + b.x) / 2 - pointer.x, (a.y + b.y) / 2 - pointer.y) / 220) : 0;
          ctx.strokeStyle = `rgba(11, 63, 49, ${(1 - d / link) * (0.1 + near * 0.35)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      for (const n of nodes) {
        const near = pointer.on ? Math.max(0, 1 - Math.hypot(n.x - pointer.x, n.y - pointer.y) / 180) : 0;
        if (near > 0.15) {
          ctx.strokeStyle = `rgba(34, 197, 139, ${near * 0.5})`;
          ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(pointer.x, pointer.y); ctx.stroke();
        }
        ctx.fillStyle = `rgba(${COLORS[n.kind]}, ${0.35 + near * 0.6})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + near * 2, 0, Math.PI * 2); ctx.fill();
      }
    };

    const step = () => {
      raf = 0;
      for (const n of nodes) {
        if (pointer.on) {
          const dx = pointer.x - n.x, dy = pointer.y - n.y, d = Math.hypot(dx, dy);
          if (d < 200 && d > 1) { n.vx += (dx / d) * 0.006; n.vy += (dy / d) * 0.006; }
        }
        n.vx *= 0.985; n.vy *= 0.985;
        // a floor on speed so the graph never freezes
        if (Math.hypot(n.vx, n.vy) < 0.05) { n.vx += (Math.random() - 0.5) * 0.04; n.vy += (Math.random() - 0.5) * 0.04; }
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
      }
      draw();
      if (visible) raf = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
      pointer.on = pointer.y > -40 && pointer.y < h + 40;
    };
    const onLeave = () => { pointer.on = false; };

    size();
    if (reduce) { draw(); return; }
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(step);
    });
    io.observe(cv);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(step);
    return () => {
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
