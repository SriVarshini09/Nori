"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Nori", the mascot: a clay-vinyl rice ball in a seaweed wrap, built from three.js primitives.
 * Looks at your cursor, blinks, waves now and then, squashes and sparkles when poked, and talks about the numbers.
 */
export function Doll({ messages, cheer = 0, shy = false }: { messages: string[]; cheer?: number; shy?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const poke = useRef<() => void>(() => {});
  const shyRef = useRef(shy);
  const setNote = useRef<(text: string) => void>(() => {});
  const latest = useRef(messages[0] ?? "");
  const [i, setI] = useState(0);
  const [ready, setReady] = useState(false);
  const count = messages.length;
  const key = messages.join("");

  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), 5200);
    return () => clearInterval(t);
  }, [count]);

  useEffect(() => {
    const text = key.split("")[i % Math.max(1, count)] ?? "";
    latest.current = text;
    setNote.current(text);
  }, [i, key, count]);

  useEffect(() => { shyRef.current = shy; }, [shy]);

  // a parent can make the doll hop and throw sparkles by bumping `cheer`
  const lastCheer = useRef(cheer);
  useEffect(() => {
    if (cheer !== lastCheer.current) { lastCheer.current = cheer; poke.current(); }
  }, [cheer]);

  useEffect(() => {
    const el = canvas.current;
    const wrap = host.current;
    if (!el || !wrap) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true, powerPreference: "high-performance" });
      } catch {
        return; // no WebGL: the page still works without the doll
      }
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.12;

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.85;

      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      camera.position.set(0.5, 0.2, 7);
      camera.lookAt(0.5, 0.05, 0);

      scene.add(new THREE.HemisphereLight(0xfff6e6, 0x9a86e8, 1.25));
      const key = new THREE.DirectionalLight(0xffefd2, 3.1);
      key.position.set(3, 4.5, 5);
      scene.add(key);
      const rimJade = new THREE.PointLight(0x4ff0b0, 46, 14);
      rimJade.position.set(-4, 1.5, -2.5);
      scene.add(rimJade);
      const rimViolet = new THREE.PointLight(0xff7ab8, 40, 14);
      rimViolet.position.set(4.2, 0.5, -2);
      scene.add(rimViolet);

      const disposables: { dispose(): void }[] = [pmrem];
      const mat = <T extends import("three").Material>(m: T) => { disposables.push(m); return m; };
      const geo = <T extends import("three").BufferGeometry>(g: T) => { disposables.push(g); return g; };

      const rice = mat(new THREE.MeshPhysicalMaterial({ color: 0xfffaf0, roughness: 0.38, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 }));
      const wrapMat = mat(new THREE.MeshPhysicalMaterial({ color: 0x0d6b4f, emissive: 0x04281f, roughness: 0.42, sheen: 0.9, sheenColor: new THREE.Color(0x7dffc4), sheenRoughness: 0.4, clearcoat: 0.35, clearcoatRoughness: 0.35 }));
      const ink = mat(new THREE.MeshPhysicalMaterial({ color: 0x10100f, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }));
      const white = mat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const blushMat = mat(new THREE.MeshBasicMaterial({ color: 0xff7f9f, transparent: true, opacity: 0.8 }));
      const leafMat = mat(new THREE.MeshPhysicalMaterial({ color: 0x9cf06b, emissive: 0x1c4a0e, roughness: 0.3, clearcoat: 0.7 }));
      const mouthMat = mat(new THREE.MeshBasicMaterial({ color: 0x3b1f1c }));

      /** Rounded-triangle onigiri: a sphere that widens toward the bottom. */
      const onigiri = (g: import("three").SphereGeometry, grow = 1) => {
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
          const t = (1 - y) / 2;
          const w = (0.8 + 0.3 * t) * grow;
          p.setXYZ(k, x * w, y * 0.96 * grow, z * w * 0.92);
        }
        g.computeVertexNormals();
        return g;
      };

      const root = new THREE.Group();
      scene.add(root);

      const body = new THREE.Mesh(geo(onigiri(new THREE.SphereGeometry(1, 72, 56))), rice);
      root.add(body);
      // seaweed wrap: the lower cap of the same shape, a hair larger
      const wrapCap = new THREE.Mesh(geo(onigiri(new THREE.SphereGeometry(1, 72, 40, 0, Math.PI * 2, 1.95, Math.PI - 1.95), 1.03)), wrapMat);
      root.add(wrapCap);
      // little paper edge where the wrap ends
      const edge = new THREE.Mesh(geo(new THREE.TorusGeometry(0.88, 0.022, 10, 72)), mat(new THREE.MeshPhysicalMaterial({ color: 0x14a67a, roughness: 0.4 })));
      edge.rotation.x = Math.PI / 2;
      edge.position.y = -0.58;
      edge.scale.set(1.0, 0.9, 1.0);
      root.add(edge);

      // face
      const face = new THREE.Group();
      face.position.set(0, 0.24, 0.86);
      root.add(face);
      const eyeGeo = geo(new THREE.SphereGeometry(0.095, 28, 20));
      const hiGeo = geo(new THREE.SphereGeometry(0.03, 12, 10));
      const eyes: import("three").Group[] = [];
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(s * 0.33, 0, 0);
        const e = new THREE.Mesh(eyeGeo, ink);
        e.scale.set(1, 1.3, 0.7);
        const h1 = new THREE.Mesh(hiGeo, white);
        h1.position.set(0.03, 0.06, 0.07);
        const h2 = new THREE.Mesh(hiGeo, white);
        h2.scale.setScalar(0.5);
        h2.position.set(-0.03, -0.045, 0.07);
        g.add(e, h1, h2);
        face.add(g);
        eyes.push(g);
        const blush = new THREE.Mesh(geo(new THREE.SphereGeometry(0.1, 20, 14)), blushMat);
        blush.scale.set(1.25, 0.7, 0.25);
        blush.position.set(s * 0.5, -0.16, -0.12);
        blush.rotation.y = s * 0.55;
        face.add(blush);
      }
      const mouth = new THREE.Mesh(geo(new THREE.TorusGeometry(0.075, 0.015, 10, 28, Math.PI)), mouthMat);
      mouth.rotation.z = Math.PI;
      mouth.position.set(0, -0.14, 0.02);
      face.add(mouth);

      // arms and feet
      const armGeo = geo(new THREE.CapsuleGeometry(0.12, 0.2, 8, 16));
      const mkArm = (s: number) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.93, -0.12, 0.1);
        const arm = new THREE.Mesh(armGeo, rice);
        arm.position.set(s * 0.1, -0.14, 0);
        arm.rotation.z = s * 0.25;
        pivot.add(arm);
        root.add(pivot);
        return pivot;
      };
      const armL = mkArm(-1);
      const armR = mkArm(1);
      armR.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0.55, 0.3, 0.78).normalize());
      const footGeo = geo(new THREE.SphereGeometry(0.2, 24, 16));
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(footGeo, wrapMat);
        f.scale.set(1.15, 0.65, 1.35);
        f.position.set(s * 0.42, -0.98, 0.3);
        root.add(f);
      }


      // sticky note held in the right hand
      const noteCv = document.createElement("canvas");
      noteCv.width = noteCv.height = 640;
      const nx = noteCv.getContext("2d")!;
      const noteTex = new THREE.CanvasTexture(noteCv);
      noteTex.colorSpace = THREE.SRGBColorSpace;
      noteTex.anisotropy = 4;
      disposables.push(noteTex);
      const drawNote = (text: string) => {
        const W = 640;
        const bg = nx.createLinearGradient(0, 0, W, W);
        bg.addColorStop(0, "#ffee5c");
        bg.addColorStop(1, "#ffc61f");
        nx.fillStyle = bg;
        nx.fillRect(0, 0, W, W);
        nx.fillStyle = "rgba(255,255,255,0.35)";
        nx.fillRect(0, 0, W, 78);
        nx.fillStyle = "#d9731a";
        nx.font = "700 30px ui-monospace, Menlo, Consolas, monospace";
        nx.textBaseline = "middle";
        nx.fillText("NORI SAYS", 40, 40);
        nx.fillStyle = "#e0541f";
        nx.font = "700 34px sans-serif";
        nx.fillText("✦", W - 74, 40);
        nx.fillStyle = "#3a2608";
        nx.font = "700 62px 'Segoe Print','Bradley Hand','Comic Sans MS','Marker Felt',cursive";
        const words = text.split(" ");
        const lines: string[] = [];
        let cur = "";
        for (const w of words) {
          const t = cur ? cur + " " + w : w;
          if (nx.measureText(t).width > W - 140 && cur) { lines.push(cur); cur = w; } else cur = t;
        }
        if (cur) lines.push(cur);
        const lh = 76;
        const top = 78 + (W - 78 - lines.length * lh) / 2 + lh / 2 - 12;
        lines.forEach((ln, k) => nx.fillText(ln, 84, top + k * lh));
        const fold = nx.createLinearGradient(W - 150, W - 150, W, W);
        fold.addColorStop(0, "rgba(0,0,0,0)");
        fold.addColorStop(1, "rgba(120,70,0,0.28)");
        const vg = nx.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W * 0.78);
        vg.addColorStop(0, "rgba(160,90,0,0)");
        vg.addColorStop(1, "rgba(160,90,0,0.16)");
        nx.fillStyle = vg;
        nx.fillRect(0, 0, W, W);
        nx.fillStyle = fold;
        nx.fillRect(W - 150, W - 150, 150, 150);
        noteTex.needsUpdate = true;
      };
      const noteGeo = geo(new THREE.PlaneGeometry(1.7, 1.7, 14, 14));
      {
        const p = noteGeo.attributes.position;
        for (let k = 0; k < p.count; k++) {
          const x = p.getX(k), y = p.getY(k);
          p.setZ(k, x * x * 0.05 + Math.max(0, x + y - 0.9) * 0.18 - y * 0.04);
        }
        noteGeo.computeVertexNormals();
      }
      const noteMat = mat(new THREE.MeshBasicMaterial({ map: noteTex, toneMapped: false, side: THREE.DoubleSide }));
      const noteMesh = new THREE.Mesh(noteGeo, noteMat);
      const noteG = new THREE.Group();
      noteG.add(noteMesh);
      noteG.position.set(1.62, 0.36, 0.7);
      noteG.rotation.set(0.04, -0.22, -0.1);
      // fingertip pinching the note's lower-left edge
      const pinch = new THREE.Mesh(geo(new THREE.SphereGeometry(0.12, 20, 16)), rice);
      pinch.scale.set(1.1, 1.3, 0.8);
      pinch.position.set(-0.8, -0.38, 0.07);
      noteG.add(pinch);
      root.add(noteG);
      let noteAnim = 0;
      setNote.current = (text: string) => { drawNote(text); noteAnim = 1; if (reduce) renderer.render(scene, camera); };
      drawNote(latest.current);

      // sprout on top
      const sprout = new THREE.Group();
      sprout.position.set(0, 0.93, 0);
      root.add(sprout);
      const stem = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.018, 0.028, 0.22, 10)), leafMat);
      stem.position.y = 0.1;
      sprout.add(stem);
      const leafGeo = geo(new THREE.SphereGeometry(0.15, 20, 14));
      const leaves = [-1, 1].map((s) => {
        const l = new THREE.Mesh(leafGeo, leafMat);
        l.scale.set(1.5, 0.3, 0.75);
        l.position.set(s * 0.19, 0.24, 0);
        l.rotation.z = s * 0.5;
        sprout.add(l);
        return l;
      });

      // soft ground shadow
      const sc = document.createElement("canvas");
      sc.width = sc.height = 128;
      const sx = sc.getContext("2d")!;
      const grd = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
      grd.addColorStop(0, "rgba(0,0,0,0.55)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      sx.fillStyle = grd;
      sx.fillRect(0, 0, 128, 128);
      const shTex = new THREE.CanvasTexture(sc);
      disposables.push(shTex);
      const shadow = new THREE.Mesh(geo(new THREE.PlaneGeometry(2.8, 2.8)), mat(new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false })));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(-0.55, -1.2, 0.1);
      scene.add(shadow);

      // sparkles
      const sparkGeo = geo(new THREE.OctahedronGeometry(0.07));
      const sparkCols = [0x6ef0b3, 0xffd27a, 0xffffff, 0xa99bff, 0xff9c7a];
      const sparks = Array.from({ length: 16 }, (_, n) => {
        const m = new THREE.Mesh(sparkGeo, mat(new THREE.MeshBasicMaterial({ color: sparkCols[n % sparkCols.length], transparent: true, opacity: 0 })));
        m.visible = false;
        scene.add(m);
        return { m, v: new THREE.Vector3(), life: 0 };
      });

      // state
      const target = { x: 0, y: 0 };
      const look = { x: 0, y: 0 };
      let eyeShut = 0;
      let vy = 0, jump = 0, squash = 0, nextBlink = 1.5, blinkT = -1, waveStart = 2.5, hasPointer = false;
      let visible = true, raf = 0, last = performance.now(), time = 0;

      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        hasPointer = true;
        target.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.45)));
        target.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.45)));
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      poke.current = () => {
        if (jump <= 0.001) vy = 3.4;
        squash = 1;
        waveStart = time;
        for (const s of sparks) {
          s.life = 1;
          s.m.visible = true;
          s.m.position.set((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.8, 0.4);
          s.v.set((Math.random() - 0.5) * 3.2, 1.8 + Math.random() * 2.4, (Math.random() - 0.2) * 1.5);
        }
      };

      const resize = () => {
        const w = wrap.clientWidth, h = wrap.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // fit the doll and the note: half-width 2.2, half-height 1.9 (world units), 30deg fov
        const tan = Math.tan(Math.PI / 12);
        camera.position.z = Math.max(2.2 / (tan * camera.aspect), 1.9 / tan);
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(() => { resize(); if (reduce) renderer.render(scene, camera); });
      ro.observe(wrap);
      resize();

      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
      io.observe(wrap);

      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (!visible || document.hidden) { last = now; return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        time += dt;

        if (!hasPointer) { target.x = Math.sin(time * 0.6) * 0.45; target.y = Math.cos(time * 0.45) * 0.15; }
        look.x += (target.x - look.x) * Math.min(1, dt * 6);
        look.y += (target.y - look.y) * Math.min(1, dt * 6);
        root.rotation.y = look.x * 0.5;
        root.rotation.x = look.y * 0.22 + eyeShut * 0.14;
        for (const e of eyes) e.position.y = -look.y * 0.04;
        face.position.x = look.x * 0.06;

        // jump physics
        if (jump > 0 || vy > 0) {
          vy -= 9.5 * dt;
          jump += vy * dt;
          if (jump <= 0) { jump = 0; vy = 0; squash = Math.max(squash, 0.8); }
        }
        squash = Math.max(0, squash - dt * 2.2);
        const bob = Math.sin(time * 1.7) * 0.06;
        const stretch = 1 + Math.sin(time * 3.4) * 0.012 + (jump > 0 ? 0.08 : 0) - Math.sin(squash * Math.PI) * 0.14 * (jump > 0 ? 0 : 1);
        root.position.set(-0.55, bob + jump, 0);
        root.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
        const lift = Math.max(0, bob + jump);
        shadow.scale.setScalar(1 - lift * 0.22);
        (shadow.material as import("three").MeshBasicMaterial).opacity = 1 - lift * 0.3;

        // blink
        nextBlink -= dt;
        if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2.2 + Math.random() * 3; }
        let blink = 1;
        if (blinkT >= 0) { blinkT += dt; blink = 1 - Math.sin(Math.min(1, blinkT / 0.18) * Math.PI) * 0.92; if (blinkT > 0.18) blinkT = -1; }
        eyeShut += ((shyRef.current ? 1 : 0) - eyeShut) * Math.min(1, dt * 14);
        blink *= 1 - eyeShut * 0.93;
        for (const e of eyes) e.scale.y = blink;

        // wave and idle arms
        const waving = time - waveStart > 0 && time - waveStart < 1.7;
        if (!waving && time - waveStart >= 1.7) waveStart = time + 5.5 + Math.random() * 3;
        const la = waving ? -2.3 + Math.sin(time * 13) * 0.35 : -0.15 - Math.sin(time * 1.7 + 1) * 0.05;
        armL.rotation.z += (la - armL.rotation.z) * Math.min(1, dt * 12);
        armR.position.y = -0.12 + Math.sin(time * 1.7) * 0.012;
        const pop = noteAnim > 0 ? (noteAnim -= dt * 2.4, Math.max(0, noteAnim)) : 0;
        noteG.rotation.z = -0.1 + Math.sin(time * 1.7 + 0.6) * 0.012 + Math.sin(pop * Math.PI * 2) * 0.1;
        noteG.scale.setScalar(0.92 * (1 + Math.sin(pop * Math.PI) * 0.1));
        const sm = 1 + Math.sin(time * 5) * 0.03;
        mouth.scale.set(sm, sm, 1);

        // sprout sways with the head
        sprout.rotation.z = -look.x * 0.35 + Math.sin(time * 2.1) * 0.08;
        leaves[0].rotation.z = -0.5 + Math.sin(time * 3) * 0.08;
        leaves[1].rotation.z = 0.5 - Math.sin(time * 3 + 1) * 0.08;

        for (const s of sparks) {
          if (s.life <= 0) continue;
          s.life -= dt * 0.9;
          s.v.y -= 6 * dt;
          s.m.position.addScaledVector(s.v, dt);
          s.m.rotation.x += dt * 6;
          s.m.rotation.y += dt * 5;
          (s.m.material as import("three").MeshBasicMaterial).opacity = Math.max(0, s.life);
          s.m.scale.setScalar(Math.max(0.01, s.life * 1.2));
          if (s.life <= 0) s.m.visible = false;
        }

        renderer.render(scene, camera);
      };

      if (reduce) renderer.render(scene, camera);
      else raf = requestAnimationFrame(frame);
      setReady(true);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        ro.disconnect();
        io.disconnect();
        for (const d of disposables) d.dispose();
        renderer.dispose();
      };
    })();

    return () => { disposed = true; cleanup(); };
  }, []);

  function onClick() {
    poke.current();
    if (count > 1) setI((n) => (n + 1) % count);
  }

  return (
    <div ref={host} className="relative h-full w-full select-none">
      <canvas ref={canvas} onClick={onClick} aria-hidden="true" className={"h-full w-full cursor-pointer transition-opacity duration-700 " + (ready ? "opacity-100" : "opacity-0")} />
      <p className="sr-only" role="status" aria-live="polite">{messages[i % Math.max(1, count)]}</p>
    </div>
  );
}
