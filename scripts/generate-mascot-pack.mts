/**
 * Generates the complete Nori Mascot Asset Pack under `apps/web/public/mascot/`:
 *   - 3D transparent 1024x1024 PNG renders (`apps/web/public/mascot/3d/*.png`) rendered via Three.js + RoomEnvironment PBR
 *   - Vector SVG expressions & brand marks (`apps/web/public/mascot/svg/*.svg`)
 *   - `apps/web/public/mascot/manifest.json`
 *   - `apps/web/public/mascot/index.html` (interactive visual contact sheet & download gallery)
 *
 * Run: npx tsx scripts/generate-mascot-pack.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "apps/web/public/mascot");
const OUT_3D = path.join(OUT_DIR, "3d");
const OUT_SVG = path.join(OUT_DIR, "svg");

export type PoseId = "idle" | "wave" | "celebrate" | "shy" | "typing" | "curious" | "wink" | "sleeping";

export const POSES: { id: PoseId; title: string; description: string }[] = [
  { id: "idle", title: "Idle / Default", description: "Friendly standing pose with soft smile and perked sprout." },
  { id: "wave", title: "Excited Wave", description: "Right arm raised waving hello with bright eyes and wider smile." },
  { id: "celebrate", title: "Celebrate / Hop", description: "Mid-air joyful hop with both arms up and 3D sparkles." },
  { id: "shy", title: "Shy / Password Privacy", description: "Both hands covering eyes with deeper cheek blush (used on password inputs)." },
  { id: "typing", title: "Typing / Taking Notes", description: "Leaning forward attentively with hands in note-taking motion." },
  { id: "curious", title: "Curious Head-Tilt", description: "Tilted head with inquisitive expression and swayed sprout." },
  { id: "wink", title: "Playful Wink", description: "One glossy eye open, one happy wink arc, waving arm." },
  { id: "sleeping", title: "Sleeping / Off-Duty", description: "Closed restful eyes, drooping sprout, peaceful expression." },
];

function buildSvgPose(pose: PoseId): string {
  const tilt = pose === "curious" ? "rotate(8 128 136)" : pose === "typing" ? "translate(0 4)" : pose === "celebrate" ? "translate(0 -12)" : "";
  const sproutRot = pose === "curious" ? "rotate(-12 128 38)" : pose === "sleeping" ? "rotate(14 128 38)" : pose === "celebrate" ? "scale(1.08) translate(-10 -4)" : "";

  const eyesSvg = (() => {
    if (pose === "shy" || pose === "sleeping") {
      return `
        <path d="M92 120 Q102 128 112 120" fill="none" stroke="#121210" stroke-width="5" stroke-linecap="round"/>
        <path d="M144 120 Q154 128 164 120" fill="none" stroke="#121210" stroke-width="5" stroke-linecap="round"/>
      `;
    }
    if (pose === "wink") {
      return `
        <ellipse cx="102" cy="118" rx="9.5" ry="12" fill="#121210"/>
        <circle cx="105" cy="113" r="3.2" fill="#ffffff"/>
        <circle cx="99" cy="122" r="1.6" fill="#ffffff"/>
        <path d="M144 119 Q154 110 164 119" fill="none" stroke="#121210" stroke-width="5" stroke-linecap="round"/>
      `;
    }
    return `
      <ellipse cx="102" cy="118" rx="9.5" ry="12" fill="#121210"/>
      <circle cx="105" cy="113" r="3.2" fill="#ffffff"/>
      <circle cx="99" cy="122" r="1.6" fill="#ffffff"/>
      <ellipse cx="154" cy="118" rx="9.5" ry="12" fill="#121210"/>
      <circle cx="157" cy="113" r="3.2" fill="#ffffff"/>
      <circle cx="151" cy="122" r="1.6" fill="#ffffff"/>
    `;
  })();

  const mouthSvg = (() => {
    if (pose === "celebrate" || pose === "wave") {
      return `<path d="M116 135 Q128 150 140 135 Z" fill="#3b1f1c"/>`;
    }
    if (pose === "shy") {
      return `<ellipse cx="128" cy="138" rx="5" ry="3.5" fill="#3b1f1c"/>`;
    }
    if (pose === "curious") {
      return `<circle cx="130" cy="138" r="4.5" fill="#3b1f1c"/>`;
    }
    return `<path d="M118 136 Q128 146 138 136" fill="none" stroke="#3b1f1c" stroke-width="4.5" stroke-linecap="round"/>`;
  })();

  const armsSvg = (() => {
    if (pose === "shy") {
      return `
        <ellipse cx="96" cy="126" rx="16" ry="11" transform="rotate(-28 96 126)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
        <ellipse cx="160" cy="126" rx="16" ry="11" transform="rotate(28 160 126)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
      `;
    }
    if (pose === "wave" || pose === "wink") {
      return `
        <ellipse cx="46" cy="112" rx="11" ry="18" transform="rotate(-38 46 112)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
        <ellipse cx="208" cy="146" rx="11" ry="18" transform="rotate(-18 208 146)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
      `;
    }
    if (pose === "celebrate") {
      return `
        <ellipse cx="44" cy="104" rx="11" ry="18" transform="rotate(-45 44 104)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
        <ellipse cx="212" cy="104" rx="11" ry="18" transform="rotate(45 212 104)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
      `;
    }
    if (pose === "typing") {
      return `
        <ellipse cx="68" cy="154" rx="15" ry="10" transform="rotate(15 68 154)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
        <ellipse cx="188" cy="154" rx="15" ry="10" transform="rotate(-15 188 154)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
      `;
    }
    return `
      <ellipse cx="48" cy="146" rx="11" ry="18" transform="rotate(18 48 146)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
      <ellipse cx="208" cy="146" rx="11" ry="18" transform="rotate(-18 208 146)" fill="url(#rice)" stroke="#0a1b15" stroke-opacity="0.12" stroke-width="2"/>
    `;
  })();

  const extrasSvg = (() => {
    if (pose === "celebrate") {
      return `
        <g fill="#ffc83d">
          <polygon points="36,52 40,62 50,66 40,70 36,80 32,70 22,66 32,62"/>
          <polygon points="220,48 223,56 231,59 223,62 220,70 217,62 209,59 217,56"/>
        </g>
        <circle cx="62" cy="36" r="5" fill="#22c58b"/>
        <circle cx="196" cy="34" r="4.5" fill="#ff7898"/>
      `;
    }
    if (pose === "sleeping") {
      return `
        <text x="182" y="64" font-family="system-ui, sans-serif" font-weight="700" font-size="22" fill="#17896a" opacity="0.85">Z</text>
        <text x="200" y="46" font-family="system-ui, sans-serif" font-weight="700" font-size="16" fill="#17896a" opacity="0.6">z</text>
      `;
    }
    return "";
  })();

  const bodyPath = "M128 46 C108 46 90 60 68 106 C48 146 32 168 32 194 C32 220 56 232 84 232 H172 C200 232 224 220 224 194 C224 168 208 146 188 106 C166 60 148 46 128 46 Z";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512" role="img" aria-label="Nori mascot (${pose})">
  <defs>
    <linearGradient id="rice" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffefa"/>
      <stop offset="1" stop-color="#f0e7d0"/>
    </linearGradient>
    <linearGradient id="nori" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17896a"/>
      <stop offset="1" stop-color="#07372b"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#22c58b"/>
      <stop offset="1" stop-color="#c4f26a"/>
    </linearGradient>
    <clipPath id="bodyClip">
      <path d="${bodyPath}"/>
    </clipPath>
  </defs>
  <ellipse cx="128" cy="240" rx="${pose === "celebrate" ? 56 : 72}" ry="10" fill="#0a1b15" opacity="${pose === "celebrate" ? 0.12 : 0.2}"/>
  ${extrasSvg}
  <g transform="${tilt}">
    <!-- Feet -->
    <ellipse cx="92" cy="232" rx="18" ry="10" fill="url(#nori)"/>
    <ellipse cx="164" cy="232" rx="18" ry="10" fill="url(#nori)"/>
    <!-- Arms (behind when not shy) -->
    ${pose !== "shy" ? armsSvg : ""}
    <!-- Rice body -->
    <path d="${bodyPath}" fill="url(#rice)"/>
    <g clip-path="url(#bodyClip)">
      <path d="M0 174 C80 154 176 154 256 174 V256 H0 Z" fill="url(#nori)"/>
      <path d="M0 174 C80 154 176 154 256 174" fill="none" stroke="#5be8b0" stroke-opacity="0.6" stroke-width="4.5"/>
      <ellipse cx="88" cy="86" rx="18" ry="32" transform="rotate(24 88 86)" fill="#ffffff" opacity="0.55"/>
    </g>
    <path d="${bodyPath}" fill="none" stroke="#0a1b15" stroke-opacity="0.16" stroke-width="3"/>
    <!-- Sprout -->
    <g transform="${sproutRot}">
      <path d="M128 46 V26" stroke="#18a874" stroke-width="7" stroke-linecap="round"/>
      <path d="M128 26 C108 4 80 8 74 22 C92 38 118 38 128 26 Z" fill="url(#leaf)"/>
      <path d="M128 26 C148 2 176 4 182 18 C164 34 138 36 128 26 Z" fill="url(#leaf)"/>
    </g>
    <!-- Face -->
    <ellipse cx="78" cy="136" rx="13" ry="8.5" fill="#ff7898" opacity="${pose === "shy" || pose === "celebrate" ? 0.85 : 0.62}"/>
    <ellipse cx="178" cy="136" rx="13" ry="8.5" fill="#ff7898" opacity="${pose === "shy" || pose === "celebrate" ? 0.85 : 0.62}"/>
    ${eyesSvg}
    ${mouthSvg}
    <!-- Hands in front when shy -->
    ${pose === "shy" ? armsSvg : ""}
  </g>
</svg>`;
}

function buildRenderHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    canvas { width: 1024px; height: 1024px; display: block; }
  </style>
  <script type="importmap">
    {
      "imports": {
        "three": "/node_modules/three/build/three.module.js"
      }
    }
  </script>
</head>
<body>
  <canvas id="c" width="1024" height="1024"></canvas>
  <script type="module">
    import * as THREE from "three";
    import { RoomEnvironment } from "/node_modules/three/examples/jsm/environments/RoomEnvironment.js";

    const canvas = document.getElementById("c");
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1024, 1024, false);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.14;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.85;

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    camera.position.set(0, 0.08, 6.4);
    camera.lookAt(0, -0.02, 0);

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

    const riceMat = new THREE.MeshPhysicalMaterial({
      color: 0xfffbf2, roughness: 0.36, sheen: 0.65, sheenColor: new THREE.Color(0xffffff),
      sheenRoughness: 0.45, clearcoat: 0.38, clearcoatRoughness: 0.4,
    });
    const wrapMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d6b4f, emissive: 0x04281f, roughness: 0.4, sheen: 0.9,
      sheenColor: new THREE.Color(0x7dffc4), sheenRoughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.35,
    });
    const inkMat = new THREE.MeshPhysicalMaterial({ color: 0x121210, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const blushMat = new THREE.MeshBasicMaterial({ color: 0xff7898, transparent: true, opacity: 0.78 });
    const leafMat = new THREE.MeshPhysicalMaterial({ color: 0x7ee85a, emissive: 0x16420b, roughness: 0.28, clearcoat: 0.65 });
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x3b1f1c });

    const sculptOnigiri = (g, grow = 1) => {
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const t = (1 - y) / 2;
        const w = (0.78 + 0.32 * t) * grow;
        p.setXYZ(k, x * w, y * 0.96 * grow, z * w * 0.9);
      }
      g.computeVertexNormals();
      return g;
    };

    const root = new THREE.Group();
    scene.add(root);

    const body = new THREE.Mesh(sculptOnigiri(new THREE.SphereGeometry(1, 64, 48)), riceMat);
    root.add(body);
    const wrapCap = new THREE.Mesh(sculptOnigiri(new THREE.SphereGeometry(1, 64, 36, 0, Math.PI * 2, 1.92, Math.PI - 1.92), 1.032), wrapMat);
    root.add(wrapCap);
    const edgeRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.022, 10, 64), new THREE.MeshPhysicalMaterial({ color: 0x1cc98e, roughness: 0.35 }));
    edgeRing.rotation.x = Math.PI / 2;
    edgeRing.position.y = -0.56;
    edgeRing.scale.set(1.0, 0.9, 1.0);
    root.add(edgeRing);

    const face = new THREE.Group();
    face.position.set(0, 0.23, 0.85);
    root.add(face);

    const eyeGeo = new THREE.SphereGeometry(0.098, 24, 18);
    const hiGeo = new THREE.SphereGeometry(0.032, 12, 10);
    const eyes = [];
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

      const blush = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 12), blushMat);
      blush.scale.set(1.28, 0.68, 0.25);
      blush.position.set(s * 0.49, -0.15, -0.11);
      blush.rotation.y = s * 0.52;
      face.add(blush);
    }

    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.016, 10, 28, Math.PI), mouthMat);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -0.135, 0.025);
    face.add(mouth);

    const armGeo = new THREE.CapsuleGeometry(0.115, 0.21, 8, 16);
    const makeArm = (s) => {
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

    const footGeo = new THREE.SphereGeometry(0.195, 22, 16);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, wrapMat);
      f.scale.set(1.15, 0.64, 1.35);
      f.position.set(s * 0.41, -0.97, 0.28);
      root.add(f);
    }

    const sprout = new THREE.Group();
    sprout.position.set(0, 0.92, 0);
    root.add(sprout);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.23, 10), leafMat);
    stem.position.y = 0.1;
    sprout.add(stem);
    const leafGeo = new THREE.SphereGeometry(0.155, 20, 14);
    const leaves = [-1, 1].map((s) => {
      const l = new THREE.Mesh(leafGeo, leafMat);
      l.scale.set(1.52, 0.3, 0.78);
      l.position.set(s * 0.19, 0.24, 0);
      l.rotation.z = s * 0.48;
      sprout.add(l);
      return l;
    });

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const sx = shadowCanvas.getContext("2d");
    const grd = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, "rgba(15, 20, 18, 0.38)");
    grd.addColorStop(1, "rgba(15, 20, 18, 0)");
    sx.fillStyle = grd;
    sx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -1.18, 0.05);
    scene.add(shadow);

    const sparkGeo = new THREE.OctahedronGeometry(0.085);
    const sparkCols = [0x22c58b, 0xffc83d, 0xff7898, 0x5ba8ff, 0xa8f06a];
    const sparkGroup = new THREE.Group();
    scene.add(sparkGroup);
    const sparkPositions = [
      [-1.05, 0.85, 0.3], [1.08, 0.82, 0.3], [-0.85, 1.18, 0.2], [0.88, 1.15, 0.2],
      [-1.18, 0.25, 0.4], [1.18, 0.32, 0.4], [0, 1.38, 0.1], [-0.48, 1.28, 0.25], [0.52, 1.28, 0.25]
    ];
    sparkPositions.forEach((pos, idx) => {
      const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: sparkCols[idx % sparkCols.length] }));
      m.position.set(pos[0], pos[1], pos[2]);
      m.rotation.set(idx * 0.7, idx * 1.1, idx * 0.4);
      sparkGroup.add(m);
    });

    window.renderPose = (pose) => {
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      root.scale.set(1, 1, 1);
      eyes[0].scale.set(1, 1, 1);
      eyes[1].scale.set(1, 1, 1);
      armL.rotation.set(0, 0, -0.18);
      armR.rotation.set(0, 0, 0.18);
      mouth.scale.set(1, 1, 1);
      sprout.rotation.set(0, 0, 0);
      leaves[0].rotation.z = -0.48;
      leaves[1].rotation.z = 0.48;
      blushMat.opacity = 0.75;
      shadow.scale.setScalar(1);
      sparkGroup.visible = false;

      if (pose === "wave") {
        root.rotation.y = 0.14;
        root.rotation.z = -0.05;
        armL.rotation.z = -2.35;
        mouth.scale.set(1.22, 1.22, 1);
        blushMat.opacity = 0.88;
      } else if (pose === "celebrate") {
        root.position.y = 0.22;
        root.scale.set(0.96, 1.06, 0.96);
        armL.rotation.z = -2.45;
        armR.rotation.z = 2.45;
        mouth.scale.set(1.3, 1.3, 1);
        blushMat.opacity = 0.92;
        shadow.scale.setScalar(0.82);
        sparkGroup.visible = true;
      } else if (pose === "shy") {
        root.rotation.x = 0.16;
        eyes[0].scale.y = 0.08;
        eyes[1].scale.y = 0.08;
        armL.rotation.set(-0.65, 0, -1.95);
        armR.rotation.set(-0.65, 0, 1.95);
        mouth.scale.set(0.7, 0.7, 1);
        blushMat.opacity = 0.95;
      } else if (pose === "typing") {
        root.rotation.x = 0.18;
        root.rotation.y = -0.12;
        armL.rotation.set(-0.4, 0, -0.65);
        armR.rotation.set(-0.4, 0, 0.45);
        sprout.rotation.z = 0.1;
      } else if (pose === "curious") {
        root.rotation.z = 0.18;
        root.rotation.y = 0.22;
        sprout.rotation.z = -0.22;
        mouth.scale.set(0.8, 0.95, 1);
      } else if (pose === "wink") {
        root.rotation.y = -0.15;
        root.rotation.z = 0.06;
        eyes[1].scale.y = 0.09;
        armL.rotation.z = -2.25;
        mouth.scale.set(1.18, 1.18, 1);
      } else if (pose === "sleeping") {
        root.rotation.x = 0.14;
        root.rotation.z = 0.08;
        eyes[0].scale.y = 0.07;
        eyes[1].scale.y = 0.07;
        sprout.rotation.z = 0.25;
        leaves[0].rotation.z = -0.25;
        leaves[1].rotation.z = 0.25;
        mouth.scale.set(0.65, 0.65, 1);
      }
      renderer.render(scene, camera);
    };
    window.__ready = true;
  </script>
</body>
</html>`;
}

function buildShowcaseHtml(): string {
  const cards = POSES.map(
    (p) => `
      <div class="card">
        <div class="stage">
          <img src="./3d/nori-3d-${p.id}.png" alt="Nori 3D ${p.title}" loading="lazy" />
        </div>
        <div class="meta">
          <div class="row">
            <h2>${p.title}</h2>
            <span class="tag">${p.id}</span>
          </div>
          <p>${p.description}</p>
          <div class="actions">
            <a href="./3d/nori-3d-${p.id}.png" download="nori-3d-${p.id}.png" class="btn primary">3D PNG (1024px)</a>
            <a href="./svg/nori-${p.id}.svg" download="nori-${p.id}.svg" class="btn">Vector SVG</a>
          </div>
        </div>
      </div>`,
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nori Mascot Asset Pack (3D & SVG)</title>
  <style>
    :root {
      --bg: #f7f5f0;
      --surface: #ffffff;
      --sunken: #efece6;
      --ink: #141413;
      --ink-2: #4a4843;
      --muted: #78756e;
      --line: #e2ded6;
      --accent: #17896a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--ink);
      padding: 48px 24px 80px;
    }
    .wrap { max-width: 1160px; margin: 0 auto; }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 28px;
      border-bottom: 1px solid var(--line);
    }
    h1 { font-size: 2rem; margin: 0; letter-spacing: -0.02em; }
    header p { margin: 8px 0 0; color: var(--ink-2); font-size: 1rem; max-width: 60ch; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 20px;
      margin-top: 32px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .stage {
      background: radial-gradient(circle at 50% 45%, #ffffff 0%, var(--sunken) 100%);
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      border-bottom: 1px solid var(--line);
    }
    .stage img { width: 100%; height: 100%; object-fit: contain; }
    .meta { padding: 16px; display: flex; flex-direction: column; flex: 1; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h2 { font-size: 1rem; margin: 0; }
    .tag {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.75rem;
      background: var(--sunken);
      color: var(--ink-2);
      padding: 2px 8px;
      border-radius: 999px;
    }
    .meta p { font-size: 0.85rem; color: var(--ink-2); margin: 8px 0 16px; line-height: 1.45; flex: 1; }
    .actions { display: flex; gap: 8px; }
    .btn {
      flex: 1;
      text-align: center;
      text-decoration: none;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--line);
      color: var(--ink);
      background: var(--surface);
    }
    .btn.primary {
      background: var(--ink);
      color: #ffffff;
      border-color: var(--ink);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Nori Mascot Asset Pack</h1>
        <p>Official 3D clay-vinyl PBR renders (1024×1024 transparent PNG) and vector SVG expressions for Nori.</p>
      </div>
      <a href="./manifest.json" class="btn">View manifest.json</a>
    </header>
    <div class="grid">
      ${cards}
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  await mkdir(OUT_3D, { recursive: true });
  await mkdir(OUT_SVG, { recursive: true });

  // 1. Write all SVG assets
  for (const pose of POSES) {
    const svg = buildSvgPose(pose.id);
    await writeFile(path.join(OUT_SVG, `nori-${pose.id}.svg`), svg, "utf8");
  }

  // 2. Serve ROOT temporarily so Three.js ESM modules load cleanly in headless Chromium
  const renderHtml = buildRenderHtml();
  const server = createServer(async (req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0]!;
    if (urlPath === "/" || urlPath === "/render.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderHtml);
      return;
    }
    const filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const { readFile } = await import("node:fs/promises");
      const data = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === ".js" ? "application/javascript" : ext === ".json" ? "application/json" : "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/render.html`, { waitUntil: "networkidle" });
    await page.waitForFunction("window.__ready === true", { timeout: 15_000 });

    for (const pose of POSES) {
      await page.evaluate((p) => (window as any).renderPose(p), pose.id);
      await page.waitForTimeout(80);
      const outPath = path.join(OUT_3D, `nori-3d-${pose.id}.png`);
      await page.locator("#c").screenshot({ path: outPath, omitBackground: true });
      console.log(`Rendered 3D PNG: apps/web/public/mascot/3d/nori-3d-${pose.id}.png`);
    }

    await browser.close();
  } finally {
    server.close();
  }

  // 3. Write manifest.json and index.html showcase
  const manifest = {
    name: "Nori Mascot Asset Pack",
    version: "1.0.0",
    character: "Nori (clay-vinyl rice ball in emerald nori wrap with two-leaf sprout)",
    colors: {
      riceLight: "#fffefa",
      riceWarm: "#f0e7d0",
      noriEmerald: "#0d6b4f",
      noriDark: "#07372b",
      noriRim: "#1cc98e",
      sproutGreen: "#7ee85a",
      blushPink: "#ff7898",
      eyeInk: "#121210",
    },
    poses: POSES.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      png3d: `/mascot/3d/nori-3d-${p.id}.png`,
      svg2d: `/mascot/svg/nori-${p.id}.svg`,
    })),
  };

  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(path.join(OUT_DIR, "index.html"), buildShowcaseHtml(), "utf8");
  console.log("Asset pack generated in apps/web/public/mascot/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
