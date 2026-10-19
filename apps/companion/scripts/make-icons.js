// Generates the tray icons in ../assets with pngjs (no native toolchain).
// Mark: a filled square (the jobgraph wordmark glyph). The "dot" variant punches a gap in the
// top-right corner and places a dot there to signal items awaiting review.
// Files ending in Template are black-on-transparent, which macOS recolours for light/dark.
// icon-light* are white versions for dark Windows/Linux trays.
const { PNG } = require("pngjs");
const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "..", "assets");
fs.mkdirSync(out, { recursive: true });
const SS = 4; // supersampling for antialiasing

function render(size, withDot, rgb) {
  const png = new PNG({ width: size, height: size });
  const u = size / 16; // design unit = 1 px at 16 px
  const sq = { x0: 3 * u, y0: 4 * u, x1: 12 * u, y1: 13 * u };
  const dot = { cx: 12.5 * u, cy: 3.5 * u, r: 2.6 * u, gap: 4.1 * u };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          let on = px >= sq.x0 && px <= sq.x1 && py >= sq.y0 && py <= sq.y1;
          if (withDot) {
            const d = Math.hypot(px - dot.cx, py - dot.cy);
            if (d <= dot.r) on = true;
            else if (d <= dot.gap) on = false;
          }
          if (on) cover++;
        }
      }
      const i = (y * size + x) * 4;
      png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2];
      png.data[i + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  return PNG.sync.write(png);
}

const variants = [
  ["iconTemplate", false, [0, 0, 0]],
  ["iconDotTemplate", true, [0, 0, 0]],
  ["icon-light", false, [255, 255, 255]],
  ["icon-light-dot", true, [255, 255, 255]],
  ["icon-dark", false, [20, 20, 20]],
  ["icon-dark-dot", true, [20, 20, 20]],
];
for (const [name, dot, rgb] of variants) {
  fs.writeFileSync(path.join(out, `${name}.png`), render(16, dot, rgb));
  fs.writeFileSync(path.join(out, `${name}@2x.png`), render(32, dot, rgb));
}
console.log("wrote", variants.length * 2, "icons to", out);
