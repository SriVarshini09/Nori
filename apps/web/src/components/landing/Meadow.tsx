"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { cx } from "@/components/cx";

/**
 * A daisy meadow at golden hour (or at dusk), painted in code: sky, a low sun, clouds, hazy hills and a tree line in
 * CSS and SVG; the field in canvas. Daisies sway in a breeze and lean away from the pointer.
 *
 * <Meadow> is everything behind the content; <MeadowFront> is the nearest daisies, the light and the floating motes,
 * drawn over the content so Nori stands in the flowers rather than on top of them. Both are still for reduced motion.
 */

export type Variant = "day" | "dusk";

/** Where the field starts, as a share of the height. The hills' SVG is drawn on the same 1440 x 900 grid. */
const FIELD = 0.6;

const LOOK = {
  day: {
    sky: "linear-gradient(180deg,#7aa8d6 0%,#9fc0de 20%,#cad8dc 36%,#f1dcaa 48%,#f8c873 56%,#f3b65a 62%)",
    sun: { x: 12, y: 49, core: "#fffbea", glow: "rgba(255,238,178,0.95)", glow2: "rgba(255,196,96,0.38)" },
    far: ["#b9b6c9", "#e0cda6"],
    mid: ["#e2c97c", "#aea95c"],
    trees: ["#5f8238", "#3b5a24"],
    treeLight: "#a8c25e",
    near: ["#ebebb2", "#c3d684", "#6f9a3f"],
    haze: "rgba(255,238,200,0.6)",
    petal: "#ffffff", petalEdge: "#efe8d6", core: ["#ffe36b", "#f3b41f", "#c4830a"] as const,
    stem: "rgba(70,110,40,0.9)",
    grass: [80, 104] as const, grassLight: [30, 52] as const,
  },
  dusk: {
    sky: "linear-gradient(180deg,#232a52 0%,#3b3d70 18%,#7b4f7c 34%,#c8607a 46%,#f08a5a 56%,#f6a35e 62%)",
    sun: { x: 22, y: 55, core: "#ffe2b0", glow: "rgba(255,170,100,0.9)", glow2: "rgba(240,110,90,0.35)" },
    far: ["#6e5d8c", "#b77e8c"],
    mid: ["#8a6560", "#55493f"],
    trees: ["#33402c", "#1e2a1b"],
    treeLight: "#8b6a44",
    near: ["#9a805e", "#5a6136", "#24301a"],
    haze: "rgba(255,170,130,0.38)",
    petal: "#ffe9de", petalEdge: "#d9b9b0", core: ["#ffd27a", "#e09a2a", "#9a5a10"] as const,
    stem: "rgba(40,55,28,0.95)",
    grass: [70, 96] as const, grassLight: [14, 30] as const,
  },
};

/** Small seeded random, so the field is the same on every visit and in both layers. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One daisy, drawn once at 128 px and stamped many times. */
function daisy(look: (typeof LOOK)[Variant]) {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.translate(S / 2, S / 2);
  const r = rng(11);
  const n = 18;
  for (let i = 0; i < n; i++) {
    g.save();
    g.rotate((i / n) * Math.PI * 2 + (r() - 0.5) * 0.14);
    const len = 42 + r() * 8;
    const grad = g.createLinearGradient(0, -8, 0, -len - 6);
    grad.addColorStop(0, look.petalEdge);
    grad.addColorStop(0.3, look.petal);
    grad.addColorStop(1, look.petal);
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(0, -len / 2 - 5, 7.4, len / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(150,140,110,0.22)";
    g.lineWidth = 0.8;
    g.stroke();
    g.restore();
  }
  const cg = g.createRadialGradient(-5, -6, 2, 0, 0, 17);
  cg.addColorStop(0, look.core[0]);
  cg.addColorStop(0.55, look.core[1]);
  cg.addColorStop(1, look.core[2]);
  g.fillStyle = cg;
  g.beginPath();
  g.arc(0, 0, 15.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(140,80,0,0.35)";
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 13;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.9, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

type Flower = { x: number; y: number; s: number; sy: number; ph: number; sp: number; z: number; rot: number };
type Mote = { x: number; y: number; r: number; vy: number; vx: number; ph: number };

/** Shared pointer, in page coordinates, with a little velocity for the breeze. */
function usePointerField(
  ref: RefObject<HTMLCanvasElement | null>,
  build: (w: number, h: number) => void,
  draw: (t: number, w: number, h: number, p: { x: number; y: number; on: boolean; wind: number }) => void,
) {
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, visible = true, last = 0, lastX = 0;
    const p = { x: -9999, y: -9999, on: false, wind: 0 };
    let windTarget = 0;

    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = r.width; h = r.height;
      cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build(w, h);
      if (reduce || !raf) draw(0, w, h, p);
    };
    const frame = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      windTarget *= 0.94;
      p.wind += (windTarget + Math.sin(now / 3200) * 0.12 - p.wind) * Math.min(1, dt * 3);
      ctx.clearRect(0, 0, w, h);
      draw(now / 1000, w, h, p);
      if (visible) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      p.x = e.clientX - r.left; p.y = e.clientY - r.top;
      p.on = p.y > -60 && p.y < h + 60;
      windTarget = Math.max(-0.7, Math.min(0.7, windTarget + (e.clientX - lastX) * 0.004));
      lastX = e.clientX;
    };
    const onLeave = () => { p.on = false; };

    const ro = new ResizeObserver(size);
    ro.observe(cv);
    size();
    if (reduce) return () => ro.disconnect();
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(cv);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(frame);
    return () => {
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, build, draw]);
}

function drawFlower(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, f: Flower, t: number, p: { x: number; y: number; on: boolean; wind: number }, stem: string) {
  let lean = Math.sin(t * f.sp + f.ph) * 0.07 * (0.5 + f.z) + p.wind * 0.45 * f.z;
  if (p.on) {
    const R = 120 + f.z * 90;
    const dx = f.x - p.x, dy = f.y - p.y, d = Math.hypot(dx, dy);
    if (d < R) lean += (dx >= 0 ? 1 : -1) * (1 - d / R) * 0.55;
  }
  const len = f.s * 2.6;
  const bx = f.x, by = f.y + len;
  const fx = f.x + Math.sin(lean) * len, fy = f.y + (1 - Math.cos(lean)) * len;
  if (f.s > 3.5) {
    ctx.strokeStyle = stem;
    ctx.lineWidth = Math.max(0.7, f.s * 0.075);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx, (by + fy) / 2, fx, fy);
    ctx.stroke();
  }
  const size = f.s * 2;
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(lean * 0.7 + f.rot);
  ctx.scale(1, f.sy);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/* ------------------------------------------------------------------ back */

export function Meadow({ variant = "day", className }: { variant?: Variant; className?: string }) {
  const look = LOOK[variant];
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ img: HTMLCanvasElement | null; still: HTMLCanvasElement | null; flowers: Flower[] }>({ img: null, still: null, flowers: [] });

  const build = useCallback((w: number, h: number) => {
    const s = state.current;
    s.img ??= daisy(look);
    const top = h * FIELD, depth = h - top;
    const r = rng(variant === "day" ? 3 : 5);
    const k = Math.max(0.45, w / 1440);

    // the far field and the grass, painted once
    const still = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    still.width = Math.max(1, Math.round(w * dpr)); still.height = Math.max(1, Math.round(h * dpr));
    const g = still.getContext("2d")!;
    g.scale(dpr, dpr);
    for (let i = 0; i < 3200 * k; i++) {
      const z = 0.08 + Math.pow(r(), 0.9) * 0.92;
      const y = top + depth * Math.pow(z, 1.3);
      const x = r() * w;
      const len = 2 + z * 30;
      g.strokeStyle = `hsla(${look.grass[0] + r() * (look.grass[1] - look.grass[0])}, ${38 + r() * 18}%, ${look.grassLight[0] + r() * (look.grassLight[1] - look.grassLight[0])}%, ${0.35 + z * 0.4})`;
      g.lineWidth = 0.6 + z * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (r() - 0.5) * len * 0.3, y - len / 2, x + (r() - 0.5) * len * 0.5, y - len);
      g.stroke();
    }
    for (let i = 0; i < 4200 * k; i++) {
      const z = Math.pow(r(), 1.9) * 0.5;
      const y = top + depth * Math.pow(z, 1.25) - 2;
      const x = r() * w;
      const rad = 0.5 + z * 4.2;
      g.fillStyle = variant === "day" ? `rgba(255,255,250,${0.55 + r() * 0.4})` : `rgba(255,225,215,${0.35 + r() * 0.35})`;
      g.beginPath();
      g.ellipse(x, y, rad, rad * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      if (rad > 2) {
        g.fillStyle = look.core[1];
        g.beginPath();
        g.arc(x, y, rad * 0.32, 0, Math.PI * 2);
        g.fill();
      }
    }
    s.still = still;

    // the swaying daisies, back to front
    const count = Math.round(320 * k);
    s.flowers = Array.from({ length: count }, () => {
      const z = 0.32 + r() * 0.56;
      return { x: r() * w, y: top + depth * Math.pow(z, 1.2), s: 2.5 + Math.pow(z, 2.4) * 30, sy: 0.55 + r() * 0.35, ph: r() * 6.28, sp: 0.7 + r() * 0.8, z, rot: (r() - 0.5) * 0.4 };
    }).sort((a, b) => a.z - b.z);
  }, [look, variant]);

  const draw = useCallback((t: number, w: number, h: number, p: { x: number; y: number; on: boolean; wind: number }) => {
    const ctx = ref.current?.getContext("2d");
    const s = state.current;
    if (!ctx || !s.img || !s.still) return;
    ctx.drawImage(s.still, 0, 0, w, h);
    for (const f of s.flowers) drawFlower(ctx, s.img, f, t, p, look.stem);
  }, [look]);

  usePointerField(ref, build, draw);

  return (
    <div aria-hidden="true" className={cx("absolute inset-0 overflow-hidden", className)}>
      <div className="absolute inset-0" style={{ background: look.sky }} />
      {variant === "dusk" && <div className="ln-stars absolute inset-x-0 top-0 h-[45%]" />}
      {/* the sun, its glow and slow rays */}
      <div className="absolute" style={{ left: `${look.sun.x}%`, top: `${look.sun.y}%` }}>
        <div className="ln-rays absolute h-[130vmax] w-[130vmax]" />
        <div className="absolute h-[90vmin] w-[90vmin] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `radial-gradient(closest-side, ${look.sun.glow}, ${look.sun.glow2} 38%, transparent 72%)` }} />
        <div className="absolute h-[9vmin] w-[9vmin] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: look.sun.core, boxShadow: `0 0 40px 18px ${look.sun.glow}` }} />
      </div>
      {/* clouds: gold underneath, drifting */}
      <div className="ln-cloud absolute right-[6%] top-[6%] h-[16%] w-[38%]" style={{ ["--d" as string]: "0s" }} />
      <div className="ln-cloud absolute right-[26%] top-[16%] h-[10%] w-[26%] opacity-80" style={{ ["--d" as string]: "-20s" }} />
      <div className="ln-cloud absolute left-[22%] top-[4%] h-[8%] w-[30%] opacity-60" style={{ ["--d" as string]: "-40s" }} />
      <div className="ln-wisp absolute left-[2%] top-[10%] h-[4%] w-[34%]" />
      <div className="ln-wisp absolute left-[36%] top-[24%] h-[3%] w-[28%] opacity-70" />

      <svg viewBox="0 0 1440 900" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`m-far-${variant}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={look.far[0]} /><stop offset="1" stopColor={look.far[1]} /></linearGradient>
          <linearGradient id={`m-mid-${variant}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={look.mid[0]} /><stop offset="1" stopColor={look.mid[1]} /></linearGradient>
          <linearGradient id={`m-tree-${variant}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={look.trees[0]} /><stop offset="1" stopColor={look.trees[1]} /></linearGradient>
          <linearGradient id={`m-near-${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={look.near[0]} /><stop offset="0.3" stopColor={look.near[1]} /><stop offset="1" stopColor={look.near[2]} />
          </linearGradient>
          <linearGradient id={`m-haze-${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={look.haze} stopOpacity="0" /><stop offset="0.5" stopColor={look.haze} /><stop offset="1" stopColor={look.haze} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`m-crest-${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff8d8" stopOpacity={variant === "day" ? 0.55 : 0.18} /><stop offset="1" stopColor="#fff8d8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* far hills, blue with distance */}
        <path d="M0 452C170 428 330 446 470 438C640 428 770 452 910 440C1070 426 1230 414 1440 398V560H0Z" fill={`url(#m-far-${variant})`} />
        {/* sunlit middle hills on the left */}
        <path d="M0 492C130 468 270 466 400 484C540 504 650 498 790 486V580H0Z" fill={`url(#m-mid-${variant})`} opacity=".92" />
        {/* the tree line on the right, its tops catching the light */}
        <path d="M720 520C770 492 820 500 860 478C900 458 950 474 990 456C1040 436 1090 462 1140 444C1190 428 1240 448 1290 430C1340 414 1390 428 1440 416V620H720Z" fill={`url(#m-tree-${variant})`} />
        <path d="M760 506C800 490 836 494 870 478C902 464 946 476 986 462C1030 446 1080 464 1132 450C1180 436 1236 452 1286 436C1330 424 1384 432 1440 424" fill="none" stroke={look.treeLight} strokeWidth="7" strokeLinecap="round" opacity=".45" />
        <rect x="0" y="400" width="1440" height="200" fill={`url(#m-haze-${variant})`} />
        {/* the near meadow, rolling */}
        <path d="M0 548C200 512 420 520 600 540C780 560 980 524 1160 512C1280 504 1380 510 1440 514V900H0Z" fill={`url(#m-near-${variant})`} />
        <path d="M0 600C250 566 520 580 760 604C980 626 1210 592 1440 582V680C1200 690 980 712 760 690C520 668 250 650 0 676Z" fill={`url(#m-crest-${variant})`} />
      </svg>
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/* ------------------------------------------------------------------ front */

export function MeadowFront({ variant = "day", className }: { variant?: Variant; className?: string }) {
  const look = LOOK[variant];
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ img: HTMLCanvasElement | null; flowers: Flower[]; motes: Mote[] }>({ img: null, flowers: [], motes: [] });

  const build = useCallback((w: number, h: number) => {
    const s = state.current;
    s.img ??= daisy(look);
    const r = rng(variant === "day" ? 9 : 13);
    const k = Math.max(0.5, w / 1440);
    const big = w < 640 ? 0.6 : 1;
    s.flowers = Array.from({ length: Math.round(22 * k) + 4 }, () => {
      const z = 0.9 + r() * 0.12;
      return { x: r() * w, y: h * (0.9 + r() * 0.12), s: (30 + (z - 0.9) * 280) * big, sy: 0.6 + r() * 0.3, ph: r() * 6.28, sp: 0.5 + r() * 0.6, z, rot: (r() - 0.5) * 0.5 };
    }).sort((a, b) => a.y - b.y);
    s.motes = Array.from({ length: variant === "day" ? 46 : 38 }, () => ({
      x: r() * w,
      y: variant === "day" ? h * (0.25 + r() * 0.5) : h * (0.55 + r() * 0.42),
      r: 0.8 + r() * 2,
      vy: -(4 + r() * 10),
      vx: (r() - 0.5) * 6,
      ph: r() * 6.28,
    }));
  }, [look, variant]);

  const draw = useCallback((t: number, w: number, h: number, p: { x: number; y: number; on: boolean; wind: number }) => {
    const ctx = ref.current?.getContext("2d");
    const s = state.current;
    if (!ctx || !s.img) return;
    for (const f of s.flowers) drawFlower(ctx, s.img, f, t, p, look.stem);
    for (const m of s.motes) {
      const y = ((m.y + m.vy * t) % h + h) % h;
      const x = (((m.x + m.vx * t + Math.sin(t * 0.6 + m.ph) * 14) % w) + w) % w;
      const a = variant === "day" ? 0.35 + Math.sin(t * 1.4 + m.ph) * 0.25 : Math.max(0, Math.sin(t * 1.8 + m.ph)) * 0.9;
      const rad = variant === "day" ? m.r : m.r * 2.4;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 3);
      g.addColorStop(0, variant === "day" ? `rgba(255,246,214,${a})` : `rgba(230,255,140,${a})`);
      g.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [look, variant]);

  usePointerField(ref, build, draw);

  return (
    <div aria-hidden="true" className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      {/* warm light falling from the sun across everything */}
      <div className="absolute inset-0 mix-blend-soft-light" style={{ background: `radial-gradient(ellipse 70% 60% at ${look.sun.x}% ${look.sun.y}%, ${variant === "day" ? "rgba(255,214,140,0.65)" : "rgba(255,140,90,0.5)"}, transparent 70%)` }} />
    </div>
  );
}
