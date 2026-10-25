"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/cx";
import { NoriMark } from "@/components/Logo";

export type NoriMood = "idle" | "shy" | "typing" | "excited" | "curious" | "celebrate";

export type NoriReactionEvent = {
  mood?: NoriMood;
  message?: string;
};

/** Dispatch a custom reaction to Nori from anywhere in the app. */
export function triggerNoriReaction(detail: NoriReactionEvent) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<NoriReactionEvent>("nori:react", { detail }));
  }
}

const ROUTE_GREETINGS: Record<string, string[]> = {
  "/dashboard": [
    "Ready for today's roles!",
    "Nothing is sent without your OK.",
    "Click me for a lucky hop!",
  ],
  "/jobs": [
    "Sniffing out fresh postings!",
    "Every match is scored from your graph.",
    "Paste any job link to pull it in.",
  ],
  "/applications": [
    "Tracking every application step.",
    "Review forms before they go out.",
  ],
  "/agent": [
    "Set your lanes & daily cap here.",
    "11 safety checks guard Autopilot.",
  ],
  "/graph": [
    "Every node is a verified fact about you.",
    "Add a plain-English fact any time!",
  ],
  "/resume": [
    "One page, ATS-ready, zero invented claims.",
    "Every bullet traces back to your graph.",
  ],
  "/inbox": [
    "Watching for replies & verification codes!",
  ],
  "/chat": [
    "Tell me what roles to look for!",
  ],
  "/profile": [
    "Your profile powers instant form answers.",
  ],
  "/settings": [
    "Nori's model is included—no keys needed.",
  ],
};

function defaultMessagesForPath(pathname: string, needsYouCount = 0): string[] {
  if (needsYouCount > 0) {
    return [
      `${needsYouCount} item${needsYouCount === 1 ? "" : "s"} waiting on your OK!`,
      "Review & approve when you're ready.",
      ...(ROUTE_GREETINGS[pathname] ?? ["Hi! I'm Nori, your job agent."]),
    ];
  }
  for (const [prefix, msgs] of Object.entries(ROUTE_GREETINGS)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return msgs;
  }
  return [
    "Hi! I'm Nori, your career-graph agent.",
    "Every resume line traces to a real fact.",
    "Nothing is sent until you approve it!",
  ];
}

function classifyInteractiveTarget(el: HTMLElement | null): { mood: NoriMood; message?: string } | null {
  if (!el) return null;
  const control = el.closest("button, a, [role='button'], input, textarea, select") as HTMLElement | null;
  if (!control) return null;

  if (control instanceof HTMLInputElement && control.type === "password") {
    return { mood: "shy", message: "Eyes closed! Not peeking at your password." };
  }

  const label = (
    control.getAttribute("aria-label") ||
    control.textContent ||
    (control as HTMLInputElement).placeholder ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!label) return null;

  if (/approve|submit|send|apply|run now|create account|sign up|sign in|log in|save|discover|find jobs|connect|keep/i.test(label)) {
    if (/approve/i.test(label)) return { mood: "excited", message: "Ready to approve? Checked every line!" };
    if (/run now/i.test(label)) return { mood: "excited", message: "Let's run a cycle and find matches!" };
    if (/apply/i.test(label)) return { mood: "excited", message: "I'll tailor your resume & fill the form!" };
    if (/create account|sign up/i.test(label)) return { mood: "excited", message: "Let's build your career graph!" };
    return { mood: "excited" };
  }

  if (/skip|delete|remove|revert|cancel|disconnect|logout|sign out/i.test(label)) {
    if (/skip/i.test(label)) return { mood: "curious", message: "Skipping this one? Got it!" };
    if (/revert/i.test(label)) return { mood: "curious", message: "Keeping your original wording!" };
    return { mood: "curious" };
  }

  return null;
}

export interface NoriMascot3DProps {
  /** Custom rotating messages; defaults to route-aware messages. */
  messages?: string[];
  /** Number of items waiting on the user (for contextual bubble). */
  needsYouCount?: number;
  /** Force shy mode (covers eyes). */
  shy?: boolean;
  /** Bump this counter to trigger a celebratory hop & sparkles. */
  cheer?: number;
  /** Size variant. */
  variant?: "rail" | "hero" | "auth" | "floating";
  /** Show the speech bubble next to Nori. */
  showBubble?: boolean;
  className?: string;
}

/**
 * Interactive 3D clay-vinyl Nori mascot built with Three.js primitives.
 * - Tracks the cursor smoothly (head, eyes, face, and counter-swaying sprout)
 * - Reacts to page interactions:
 *   - Password inputs -> covers eyes with both hands & blushes ("shy")
 *   - Typing in inputs/textareas -> leans in & wiggles arms like taking notes ("typing")
 *   - Hovering primary CTA / Approve / Apply buttons -> perks up & waves ("excited")
 *   - Hovering Skip / Revert / Delete buttons -> tilts head ("curious")
 *   - Clicking primary actions or clicking Nori -> hops with squash-and-stretch physics & bursts 3D sparkles ("celebrate")
 * - Pauses off-screen via IntersectionObserver, respects prefers-reduced-motion, and falls back to SVG when WebGL is absent.
 */
export function NoriMascot3D({
  messages: customMessages,
  needsYouCount = 0,
  shy: forcedShy = false,
  cheer = 0,
  variant = "hero",
  showBubble = true,
  className,
}: NoriMascot3DProps) {
  const pathname = usePathname() || "/";
  const baseMessages = customMessages?.length ? customMessages : defaultMessagesForPath(pathname, needsYouCount);

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pokeRef = useRef<() => void>(() => {});
  const moodRef = useRef<NoriMood>(forcedShy ? "shy" : "idle");

  const [ready, setReady] = useState(false);
  const [mood, setMood] = useState<NoriMood>(forcedShy ? "shy" : "idle");
  const [msgIndex, setMsgIndex] = useState(0);
  const [transientMsg, setTransientMsg] = useState<string | null>(null);

  useEffect(() => {
    moodRef.current = forcedShy ? "shy" : mood;
  }, [forcedShy, mood]);

  // Rotate baseline messages
  useEffect(() => {
    if (baseMessages.length < 2) return;
    const timer = setInterval(() => {
      setMsgIndex((n) => (n + 1) % baseMessages.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [baseMessages.length]);

  // External cheer trigger
  const lastCheer = useRef(cheer);
  useEffect(() => {
    if (cheer !== lastCheer.current) {
      lastCheer.current = cheer;
      pokeRef.current();
    }
  }, [cheer]);

  // Listen to page-wide user interactions (focus, typing, hover, click, scroll, custom events)
  useEffect(() => {
    let typingTimeout: ReturnType<typeof setTimeout> | undefined;
    let transientTimeout: ReturnType<typeof setTimeout> | undefined;

    const showTempMessage = (text: string, durationMs = 3200) => {
      setTransientMsg(text);
      if (transientTimeout) clearTimeout(transientTimeout);
      transientTimeout = setTimeout(() => setTransientMsg(null), durationMs);
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t instanceof HTMLInputElement && t.type === "password") {
        moodRef.current = "shy";
        setMood("shy");
        showTempMessage("Eyes closed! Not peeking at your password.", 5000);
      } else if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) {
        moodRef.current = "typing";
        setMood("typing");
      }
    };

    const onFocusOut = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) {
        moodRef.current = forcedShy ? "shy" : "idle";
        setMood(forcedShy ? "shy" : "idle");
        setTransientMsg(null);
      }
    };

    const onInput = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t instanceof HTMLInputElement && t.type === "password") {
        moodRef.current = "shy";
        setMood("shy");
        return;
      }
      moodRef.current = "typing";
      setMood("typing");
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        if (moodRef.current === "typing") {
          moodRef.current = forcedShy ? "shy" : "idle";
          setMood(forcedShy ? "shy" : "idle");
        }
      }, 1200);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (moodRef.current === "shy" || moodRef.current === "typing" || moodRef.current === "celebrate") return;
      const hit = classifyInteractiveTarget(e.target as HTMLElement | null);
      if (hit) {
        moodRef.current = hit.mood;
        setMood(hit.mood);
        if (hit.message) showTempMessage(hit.message, 2600);
      }
    };

    const onPointerOut = (e: PointerEvent) => {
      if (moodRef.current === "excited" || moodRef.current === "curious") {
        const related = e.relatedTarget as HTMLElement | null;
        if (!classifyInteractiveTarget(related)) {
          moodRef.current = forcedShy ? "shy" : "idle";
          setMood(forcedShy ? "shy" : "idle");
        }
      }
    };

    const onClick = (e: MouseEvent) => {
      const hit = classifyInteractiveTarget(e.target as HTMLElement | null);
      if (hit?.mood === "excited") {
        pokeRef.current();
        showTempMessage("On it! Let's go!", 2800);
      }
    };

    const onCustomReact = (e: Event) => {
      const detail = (e as CustomEvent<NoriReactionEvent>).detail;
      if (!detail) return;
      if (detail.mood) {
        moodRef.current = detail.mood;
        setMood(detail.mood);
        if (detail.mood === "celebrate") pokeRef.current();
      }
      if (detail.message) showTempMessage(detail.message, 3500);
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("click", onClick, { passive: true });
    window.addEventListener("nori:react", onCustomReact);

    return () => {
      if (typingTimeout) clearTimeout(typingTimeout);
      if (transientTimeout) clearTimeout(transientTimeout);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("click", onClick);
      window.removeEventListener("nori:react", onCustomReact);
    };
  }, [forcedShy]);

  // Three.js 3D scene setup & animation loop
  useEffect(() => {
    const el = canvasRef.current;
    const wrap = hostRef.current;
    if (!el || !wrap) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: el,
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
      } catch {
        return; // WebGL unavailable: static SVG fallback stays visible
      }

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.14;

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.85;

      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
      camera.position.set(0, 0.12, 6.2);
      camera.lookAt(0, 0.02, 0);

      scene.add(new THREE.HemisphereLight(0xfff8eb, 0xd8d0c5, 1.35));
      const keyLight = new THREE.DirectionalLight(0xfff1d6, 3.0);
      keyLight.position.set(3.2, 4.5, 5.2);
      scene.add(keyLight);

      const rimJade = new THREE.PointLight(0x4ff0b0, 38, 14);
      rimJade.position.set(-3.8, 1.6, -2.2);
      scene.add(rimJade);

      const rimWarm = new THREE.PointLight(0xffb07a, 32, 14);
      rimWarm.position.set(3.8, 0.8, -2.0);
      scene.add(rimWarm);

      const disposables: { dispose(): void }[] = [pmrem];
      const mat = <T extends import("three").Material>(m: T) => {
        disposables.push(m);
        return m;
      };
      const geo = <T extends import("three").BufferGeometry>(g: T) => {
        disposables.push(g);
        return g;
      };

      const riceMat = mat(
        new THREE.MeshPhysicalMaterial({
          color: 0xfffbf2,
          roughness: 0.36,
          sheen: 0.65,
          sheenColor: new THREE.Color(0xffffff),
          sheenRoughness: 0.45,
          clearcoat: 0.38,
          clearcoatRoughness: 0.4,
        }),
      );
      const wrapMat = mat(
        new THREE.MeshPhysicalMaterial({
          color: 0x0d6b4f,
          emissive: 0x04281f,
          roughness: 0.4,
          sheen: 0.9,
          sheenColor: new THREE.Color(0x7dffc4),
          sheenRoughness: 0.38,
          clearcoat: 0.4,
          clearcoatRoughness: 0.35,
        }),
      );
      const inkMat = mat(
        new THREE.MeshPhysicalMaterial({
          color: 0x121210,
          roughness: 0.1,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
        }),
      );
      const whiteMat = mat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const blushMat = mat(new THREE.MeshBasicMaterial({ color: 0xff7898, transparent: true, opacity: 0.78 }));
      const leafMat = mat(
        new THREE.MeshPhysicalMaterial({
          color: 0x7ee85a,
          emissive: 0x16420b,
          roughness: 0.28,
          clearcoat: 0.65,
        }),
      );
      const mouthMat = mat(new THREE.MeshBasicMaterial({ color: 0x3b1f1c }));

      /** Sculpt a sphere into a rounded onigiri rice-ball (wider base, soft triangular crown). */
      const sculptOnigiri = (g: import("three").SphereGeometry, grow = 1) => {
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const x = p.getX(k);
          const y = p.getY(k);
          const z = p.getZ(k);
          const t = (1 - y) / 2;
          const w = (0.78 + 0.32 * t) * grow;
          p.setXYZ(k, x * w, y * 0.96 * grow, z * w * 0.9);
        }
        g.computeVertexNormals();
        return g;
      };

      const root = new THREE.Group();
      scene.add(root);

      // Rice body
      const body = new THREE.Mesh(geo(sculptOnigiri(new THREE.SphereGeometry(1, 64, 48))), riceMat);
      root.add(body);

      // Nori seaweed wrap (lower band)
      const wrapCap = new THREE.Mesh(
        geo(sculptOnigiri(new THREE.SphereGeometry(1, 64, 36, 0, Math.PI * 2, 1.92, Math.PI - 1.92), 1.032)),
        wrapMat,
      );
      root.add(wrapCap);

      // Crisp emerald rim at top of the nori wrap
      const edgeRing = new THREE.Mesh(
        geo(new THREE.TorusGeometry(0.88, 0.022, 10, 64)),
        mat(new THREE.MeshPhysicalMaterial({ color: 0x1cc98e, roughness: 0.35 })),
      );
      edgeRing.rotation.x = Math.PI / 2;
      edgeRing.position.y = -0.56;
      edgeRing.scale.set(1.0, 0.9, 1.0);
      root.add(edgeRing);

      // Face group
      const face = new THREE.Group();
      face.position.set(0, 0.23, 0.85);
      root.add(face);

      const eyeGeo = geo(new THREE.SphereGeometry(0.098, 24, 18));
      const hiGeo = geo(new THREE.SphereGeometry(0.032, 12, 10));
      const eyes: import("three").Group[] = [];
      const blushes: import("three").Mesh[] = [];

      for (const s of [-1, 1]) {
        const eg = new THREE.Group();
        eg.position.set(s * 0.32, 0, 0);
        const eyeMesh = new THREE.Mesh(eyeGeo, inkMat);
        eyeMesh.scale.set(1, 1.28, 0.7);
        const h1 = new THREE.Mesh(hiGeo, whiteMat);
        h1.position.set(0.03, 0.058, 0.072);
        const h2 = new THREE.Mesh(hiGeo, whiteMat);
        h2.scale.setScalar(0.48);
        h2.position.set(-0.028, -0.042, 0.072);
        eg.add(eyeMesh, h1, h2);
        face.add(eg);
        eyes.push(eg);

        const blush = new THREE.Mesh(geo(new THREE.SphereGeometry(0.105, 18, 12)), blushMat);
        blush.scale.set(1.28, 0.68, 0.25);
        blush.position.set(s * 0.49, -0.15, -0.11);
        blush.rotation.y = s * 0.52;
        face.add(blush);
        blushes.push(blush);
      }

      const mouth = new THREE.Mesh(geo(new THREE.TorusGeometry(0.076, 0.016, 10, 28, Math.PI)), mouthMat);
      mouth.rotation.z = Math.PI;
      mouth.position.set(0, -0.135, 0.025);
      face.add(mouth);

      // Stubby arms & feet
      const armGeo = geo(new THREE.CapsuleGeometry(0.115, 0.21, 8, 16));
      const makeArm = (s: number) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.92, -0.1, 0.12);
        const arm = new THREE.Mesh(armGeo, riceMat);
        arm.position.set(s * 0.09, -0.14, 0);
        arm.rotation.z = s * 0.25;
        pivot.add(arm);
        root.add(pivot);
        return pivot;
      };
      const armL = makeArm(-1);
      const armR = makeArm(1);

      const footGeo = geo(new THREE.SphereGeometry(0.195, 22, 16));
      const feet: import("three").Mesh[] = [];
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(footGeo, wrapMat);
        f.scale.set(1.15, 0.64, 1.35);
        f.position.set(s * 0.41, -0.97, 0.28);
        root.add(f);
        feet.push(f);
      }

      // Two-leaf sprout on top of Nori's head
      const sprout = new THREE.Group();
      sprout.position.set(0, 0.92, 0);
      root.add(sprout);
      const stem = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.02, 0.03, 0.23, 10)), leafMat);
      stem.position.y = 0.1;
      sprout.add(stem);
      const leafGeo = geo(new THREE.SphereGeometry(0.155, 20, 14));
      const leaves = [-1, 1].map((s) => {
        const l = new THREE.Mesh(leafGeo, leafMat);
        l.scale.set(1.52, 0.3, 0.78);
        l.position.set(s * 0.19, 0.24, 0);
        l.rotation.z = s * 0.48;
        sprout.add(l);
        return l;
      });

      // Soft ground shadow
      const shadowCanvas = document.createElement("canvas");
      shadowCanvas.width = shadowCanvas.height = 128;
      const sx = shadowCanvas.getContext("2d")!;
      const grd = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
      grd.addColorStop(0, "rgba(15, 20, 18, 0.42)");
      grd.addColorStop(1, "rgba(15, 20, 18, 0)");
      sx.fillStyle = grd;
      sx.fillRect(0, 0, 128, 128);
      const shadowTex = new THREE.CanvasTexture(shadowCanvas);
      disposables.push(shadowTex);
      const shadow = new THREE.Mesh(
        geo(new THREE.PlaneGeometry(2.6, 2.6)),
        mat(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, -1.18, 0.05);
      scene.add(shadow);

      // 3D Sparkles for hops & celebrations
      const sparkGeo = geo(new THREE.OctahedronGeometry(0.075));
      const sparkCols = [0x22c58b, 0xffc83d, 0xff7898, 0x5ba8ff, 0xa8f06a];
      const sparks = Array.from({ length: 18 }, (_, n) => {
        const m = new THREE.Mesh(
          sparkGeo,
          mat(new THREE.MeshBasicMaterial({ color: sparkCols[n % sparkCols.length], transparent: true, opacity: 0 })),
        );
        m.visible = false;
        scene.add(m);
        return { m, v: new THREE.Vector3(), life: 0 };
      });

      // Animation state
      const target = { x: 0, y: 0 };
      const look = { x: 0, y: 0 };
      let eyeShut = 0;
      let vy = 0;
      let jump = 0;
      let squash = 0;
      let scrollTilt = 0;
      let lastScrollY = window.scrollY;
      let nextBlink = 1.6;
      let blinkT = -1;
      let waveStart = 2.0;
      let hasPointer = false;
      let visible = true;
      let raf = 0;
      let last = performance.now();
      let time = 0;

      const onPointerMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        hasPointer = true;
        target.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.42)));
        target.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.42)));
      };

      const onScroll = () => {
        const dy = window.scrollY - lastScrollY;
        lastScrollY = window.scrollY;
        scrollTilt = Math.max(-0.25, Math.min(0.25, scrollTilt + dy * 0.0025));
      };

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });

      pokeRef.current = () => {
        if (jump <= 0.001) vy = 3.5;
        squash = 1;
        waveStart = time;
        for (const s of sparks) {
          s.life = 1;
          s.m.visible = true;
          s.m.position.set((Math.random() - 0.5) * 0.7, 0.25 + Math.random() * 0.75, 0.45);
          s.v.set((Math.random() - 0.5) * 3.4, 1.9 + Math.random() * 2.5, (Math.random() - 0.2) * 1.6);
        }
      };

      const resize = () => {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const tan = Math.tan((camera.fov * Math.PI) / 360);
        camera.position.z = Math.max(1.55 / (tan * camera.aspect), 1.65 / tan);
        camera.updateProjectionMatrix();
      };

      const ro = new ResizeObserver(() => {
        resize();
        if (reduce) renderer.render(scene, camera);
      });
      ro.observe(wrap);
      resize();

      const io = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
      });
      io.observe(wrap);

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (!visible || document.hidden) {
          last = now;
          return;
        }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        time += dt;

        const currentMood = moodRef.current;

        if (!hasPointer) {
          target.x = Math.sin(time * 0.65) * 0.38;
          target.y = Math.cos(time * 0.48) * 0.14;
        }
        look.x += (target.x - look.x) * Math.min(1, dt * 6.5);
        look.y += (target.y - look.y) * Math.min(1, dt * 6.5);
        scrollTilt *= Math.pow(0.04, dt);

        // Head orientation by mood + pointer + scroll
        const curiousTilt = currentMood === "curious" ? 0.18 : currentMood === "excited" ? -0.06 : 0;
        const typingLean = currentMood === "typing" ? 0.16 : 0;
        root.rotation.y = look.x * 0.52 + (currentMood === "typing" ? Math.sin(time * 9) * 0.06 : 0);
        root.rotation.x = look.y * 0.22 + eyeShut * 0.16 + typingLean + scrollTilt;
        root.rotation.z += (curiousTilt - root.rotation.z) * Math.min(1, dt * 8);

        for (const e of eyes) {
          e.position.y = -look.y * 0.042;
        }
        face.position.x = look.x * 0.065;

        // Jump & squash-stretch physics
        if (jump > 0 || vy > 0) {
          vy -= 9.8 * dt;
          jump += vy * dt;
          if (jump <= 0) {
            jump = 0;
            vy = 0;
            squash = Math.max(squash, 0.82);
          }
        }
        squash = Math.max(0, squash - dt * 2.4);

        const bobSpeed = currentMood === "excited" ? 3.2 : currentMood === "typing" ? 4.5 : 1.8;
        const bobAmp = currentMood === "excited" ? 0.085 : currentMood === "typing" ? 0.045 : 0.055;
        const bob = Math.sin(time * bobSpeed) * bobAmp;
        const stretch =
          1 +
          Math.sin(time * bobSpeed * 2) * 0.014 +
          (jump > 0 ? 0.085 : 0) -
          Math.sin(squash * Math.PI) * 0.15 * (jump > 0 ? 0 : 1);

        root.position.set(0, bob + jump, 0);
        root.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));

        const lift = Math.max(0, bob + jump);
        shadow.scale.setScalar(1 - lift * 0.22);
        (shadow.material as import("three").MeshBasicMaterial).opacity = 1 - lift * 0.3;

        // Blinking & shy eye-cover
        nextBlink -= dt;
        if (nextBlink <= 0 && blinkT < 0) {
          blinkT = 0;
          nextBlink = 2.0 + Math.random() * 2.8;
        }
        let blink = 1;
        if (blinkT >= 0) {
          blinkT += dt;
          blink = 1 - Math.sin(Math.min(1, blinkT / 0.16) * Math.PI) * 0.92;
          if (blinkT > 0.16) blinkT = -1;
        }
        const wantShut = currentMood === "shy" ? 1 : 0;
        eyeShut += (wantShut - eyeShut) * Math.min(1, dt * 14);
        blink *= 1 - eyeShut * 0.94;
        for (const e of eyes) {
          e.scale.y = blink;
        }

        // Cheek blush intensity
        blushMat.opacity = currentMood === "shy" || currentMood === "excited" ? 0.92 : 0.72;

        // Arm animations based on mood
        const waving = currentMood === "excited" || (time - waveStart > 0 && time - waveStart < 1.6);
        if (!waving && time - waveStart >= 1.6) {
          waveStart = time + 5.0 + Math.random() * 3.5;
        }

        if (currentMood === "shy") {
          // Both hands come up toward the eyes
          armL.rotation.z += (-1.95 - armL.rotation.z) * Math.min(1, dt * 12);
          armL.rotation.x += (-0.65 - armL.rotation.x) * Math.min(1, dt * 12);
          armR.rotation.z += (1.95 - armR.rotation.z) * Math.min(1, dt * 12);
          armR.rotation.x += (-0.65 - armR.rotation.x) * Math.min(1, dt * 12);
        } else if (currentMood === "typing") {
          // Rapid little typing motion with both arms
          const targetL = -0.55 + Math.sin(time * 18) * 0.22;
          const targetR = 0.55 + Math.cos(time * 18) * 0.22;
          armL.rotation.z += (targetL - armL.rotation.z) * Math.min(1, dt * 16);
          armL.rotation.x += (-0.35 - armL.rotation.x) * Math.min(1, dt * 12);
          armR.rotation.z += (targetR - armR.rotation.z) * Math.min(1, dt * 16);
          armR.rotation.x += (-0.35 - armR.rotation.x) * Math.min(1, dt * 12);
        } else {
          const targetL = waving ? -2.35 + Math.sin(time * 14) * 0.36 : -0.18 - Math.sin(time * 1.8 + 1) * 0.06;
          const targetR = currentMood === "excited" ? 2.25 + Math.cos(time * 14) * 0.3 : 0.18 + Math.sin(time * 1.8) * 0.06;
          armL.rotation.z += (targetL - armL.rotation.z) * Math.min(1, dt * 12);
          armL.rotation.x += (0 - armL.rotation.x) * Math.min(1, dt * 10);
          armR.rotation.z += (targetR - armR.rotation.z) * Math.min(1, dt * 12);
          armR.rotation.x += (0 - armR.rotation.x) * Math.min(1, dt * 10);
        }

        // Happy feet tap when excited or typing
        feet[0]!.position.y = -0.97 + (currentMood === "excited" ? Math.max(0, Math.sin(time * 10)) * 0.05 : 0);
        feet[1]!.position.y = -0.97 + (currentMood === "excited" ? Math.max(0, -Math.sin(time * 10)) * 0.05 : 0);

        // Mouth expression
        const smileScale = currentMood === "excited" ? 1.22 : currentMood === "shy" ? 0.72 : 1 + Math.sin(time * 4.5) * 0.04;
        mouth.scale.set(smileScale, smileScale, 1);

        // Sprout sways with head and perks up when excited
        sprout.rotation.z = -look.x * 0.35 + Math.sin(time * 2.3) * 0.09;
        leaves[0]!.rotation.z = -0.48 + Math.sin(time * 3.2) * (currentMood === "excited" ? 0.18 : 0.08);
        leaves[1]!.rotation.z = 0.48 - Math.sin(time * 3.2 + 1) * (currentMood === "excited" ? 0.18 : 0.08);

        // Sparkle particle physics
        for (const s of sparks) {
          if (s.life <= 0) continue;
          s.life -= dt * 0.95;
          s.v.y -= 5.8 * dt;
          s.m.position.addScaledVector(s.v, dt);
          s.m.rotation.x += dt * 6;
          s.m.rotation.y += dt * 5;
          (s.m.material as import("three").MeshBasicMaterial).opacity = Math.max(0, s.life);
          s.m.scale.setScalar(Math.max(0.01, s.life * 1.15));
          if (s.life <= 0) s.m.visible = false;
        }

        renderer.render(scene, camera);
      };

      if (reduce) renderer.render(scene, camera);
      else raf = requestAnimationFrame(frame);
      setReady(true);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("scroll", onScroll);
        ro.disconnect();
        io.disconnect();
        for (const d of disposables) d.dispose();
        renderer.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  const activeMessage = transientMsg ?? baseMessages[msgIndex % Math.max(1, baseMessages.length)] ?? "Hi, I'm Nori!";

  const handlePoke = () => {
    pokeRef.current();
    if (!transientMsg && baseMessages.length > 1) {
      setMsgIndex((n) => (n + 1) % baseMessages.length);
    }
  };

  if (variant === "rail") {
    return (
      <div className={cx("rounded-card border border-line bg-surface p-2.5", className)}>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handlePoke}
            aria-label="Poke Nori the 3D mascot"
            className="relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-control bg-sunken/60 transition-transform active:scale-95"
          >
            <div ref={hostRef} className="h-full w-full">
              <canvas
                ref={canvasRef}
                aria-hidden="true"
                className={cx("h-full w-full transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")}
              />
              {!ready && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <NoriMark size={34} />
                </span>
              )}
            </div>
          </button>
          {showBubble && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {mood === "shy"
                    ? "Eyes closed"
                    : mood === "typing"
                      ? "Listening..."
                      : mood === "excited"
                        ? "Ready!"
                        : "Nori"}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-2" role="status" aria-live="polite">
                {activeMessage}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        "relative flex items-center gap-3 rounded-card border border-line bg-surface p-3",
        variant === "hero" ? "sm:p-3.5" : "",
        className,
      )}
    >
      <button
        type="button"
        onClick={handlePoke}
        aria-label="Poke Nori the 3D mascot to make it hop"
        className={cx(
          "relative shrink-0 cursor-pointer overflow-hidden rounded-control bg-sunken/60 transition-transform active:scale-95",
          variant === "hero" ? "h-20 w-20 sm:h-24 sm:w-24" : "h-20 w-20",
        )}
      >
        <div ref={hostRef} className="h-full w-full">
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cx("h-full w-full transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")}
          />
          {!ready && (
            <span className="absolute inset-0 flex items-center justify-center">
              <NoriMark size={48} />
            </span>
          )}
        </div>
      </button>
      {showBubble && (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            <span className="text-[11.5px] font-semibold text-muted">
              {mood === "shy"
                ? "Nori · Eyes closed"
                : mood === "typing"
                  ? "Nori · Taking notes"
                  : mood === "excited"
                    ? "Nori · Excited"
                    : "Nori · Click me to hop"}
            </span>
          </div>
          <p className="mt-1 text-[13.5px] font-medium leading-snug text-ink" role="status" aria-live="polite">
            {activeMessage}
          </p>
        </div>
      )}
    </div>
  );
}
