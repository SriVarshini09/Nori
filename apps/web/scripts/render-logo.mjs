/**
 * Renders the logo PNGs, the .ico and the reversed lockup from the SVG sources in public/logo.
 *   node apps/web/scripts/render-logo.mjs
 * Needs Playwright's Chromium (npx playwright install chromium).
 */
import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const logo = path.resolve(here, "../public/logo");
const app = path.resolve(here, "../src/app");

const light = (await readFile(path.join(logo, "nori-logo.svg"), "utf8")).replaceAll('stroke="#0a1b15" stroke-width="6"', 'stroke="#ffffff" stroke-width="6"');
await writeFile(path.join(logo, "nori-logo-light.svg"), light);
await copyFile(path.join(logo, "nori-favicon.svg"), path.join(app, "icon.svg"));

const browser = await chromium.launch();
async function png(svgText, width, height, out) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${width}px;height:${height}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svgText).toString("base64")}">`);
  const buf = await page.screenshot({ omitBackground: true, type: "png" });
  await page.close();
  if (out) await writeFile(out, buf);
  return buf;
}
const read = (f) => readFile(path.join(logo, f), "utf8");

await png(await read("nori-icon.svg"), 512, 512, path.join(logo, "nori-icon-512.png"));
await png(await read("nori-icon.svg"), 192, 192, path.join(logo, "nori-icon-192.png"));
await png(await read("nori-icon.svg"), 180, 180, path.join(app, "apple-icon.png"));
await png(await read("nori-mark.svg"), 512, 512, path.join(logo, "nori-mark.png"));
await png(await read("nori-logo.svg"), 1200, 456, path.join(logo, "nori-logo.png"));
await png(light, 1200, 456, path.join(logo, "nori-logo-light.png"));

// favicon.ico: PNG-compressed 16, 32 and 48 px images (supported by every current browser)
const fav = await read("nori-favicon.svg");
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await png(fav, s, s));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
await writeFile(path.join(app, "favicon.ico"), Buffer.concat([head, ...entries, ...pngs]));
await browser.close();
console.log("logo assets written");
