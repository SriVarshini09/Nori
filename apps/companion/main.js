// jobgraph companion: menu-bar (macOS) / tray (Windows, Linux) popover for the agent.
// Electron for the hackathon; a Tauri port is in the backlog.
const { app, Menu, Notification, nativeImage, nativeTheme, session, shell } = require("electron");
const { menubar } = require("menubar");
const fs = require("node:fs");
const path = require("node:path");

const WEB_URL = (process.env.WEB_URL || "http://localhost:3000").replace(/\/$/, "");
const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const COMPANION_URL = `${WEB_URL}/companion`;
const POLL_MS = 60_000;
const ASSETS = path.join(__dirname, "assets");
const IS_MAC = process.platform === "darwin";

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId("dev.jobgraph.companion");

// ---------- small persisted state in userData (seen approval ids, cap to restore on resume) ----------
const statePath = () => path.join(app.getPath("userData"), "companion-state.json");
function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); } catch { return {}; }
}
function saveState(patch) {
  const next = { ...loadState(), ...patch };
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
  } catch (e) { console.error("[companion] could not save state:", e.message); }
  return next;
}

// ---------- icons ----------
function iconFor(hasDot) {
  const base = IS_MAC
    ? (hasDot ? "iconDotTemplate" : "iconTemplate")
    : `${nativeTheme.shouldUseDarkColors ? "icon-light" : "icon-dark"}${hasDot ? "-dot" : ""}`;
  const img = nativeImage.createFromPath(path.join(ASSETS, `${base}.png`));
  const hi = path.join(ASSETS, `${base}@2x.png`);
  if (fs.existsSync(hi)) img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(hi) });
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

// ---------- API (uses the Electron session, so it carries the sign-in cookie; localhost cookies ignore ports) ----------
async function api(method, route, body) {
  const res = await session.defaultSession.fetch(`${API_URL}${route}`, {
    method,
    credentials: "include",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}`);
  return json;
}

let status = null; // last good /api/agent/status
let apiDown = false;
let mb;

function plural(n) { return n === 1 ? "1 application is" : `${n} applications are`; }

function applyBadge() {
  if (!mb || !mb.tray || mb.tray.isDestroyed()) return;
  const n = status?.awaitingReview?.length ?? 0;
  mb.tray.setImage(iconFor(n > 0));
  if (IS_MAC) mb.tray.setTitle(n > 0 ? String(n) : "");
  const paused = status && status.dailyCap === 0;
  const tip = apiDown ? "jobgraph (agent offline)"
    : n > 0 ? `jobgraph: ${n} waiting for your approval`
    : paused ? "jobgraph (agent paused)" : "jobgraph";
  mb.tray.setToolTip(tip);
}

function notifyNew(items) {
  const seen = new Set(loadState().seenIds ?? []);
  const fresh = items.filter((i) => !seen.has(i.applicationId));
  // Keep only ids that are still waiting, so an item that comes back later notifies again.
  saveState({ seenIds: items.map((i) => i.applicationId) });
  if (fresh.length === 0 || !Notification.isSupported()) return;
  const body = fresh.length === 1 && fresh[0].title
    ? `${plural(1)} waiting for your approval: ${fresh[0].title}${fresh[0].companyName ? ` at ${fresh[0].companyName}` : ""}`
    : `${plural(fresh.length)} waiting for your approval`;
  const n = new Notification({ title: "Nori", body });
  n.on("click", () => mb && mb.showWindow());
  n.show();
}

async function poll() {
  try {
    status = await api("GET", "/api/agent/status");
    apiDown = false;
    notifyNew(status.awaitingReview ?? []);
  } catch (e) {
    // 401 (signed out) or API not running: keep the last badge state, just flag offline.
    apiDown = !/-> 40[13]/.test(e.message);
    if (apiDown) console.warn("[companion] status poll failed:", e.message);
  }
  applyBadge();
}

// ---------- menu actions ----------
async function runNow() {
  mb.tray.setToolTip("jobgraph: agent running...");
  try { await api("POST", "/api/agent/tick"); } catch (e) { console.error("[companion] run now failed:", e.message); }
  await poll();
}

async function togglePause() {
  try {
    if (!status) await poll();
    const cap = status?.dailyCap ?? 0;
    if (cap > 0) {
      saveState({ previousCap: cap });
      await api("PUT", "/api/profile", { settings: { autoApplyDailyCap: 0 } });
    } else {
      const prev = loadState().previousCap;
      const restore = prev > 0 ? prev : 3;
      await api("PUT", "/api/profile", { settings: { autoApplyDailyCap: restore } });
    }
  } catch (e) { console.error("[companion] pause/resume failed:", e.message); }
  await poll();
}

function contextMenu() {
  const paused = status && status.dailyCap === 0;
  return Menu.buildFromTemplate([
    { label: "Open dashboard", click: () => shell.openExternal(`${WEB_URL}/agent`) },
    { label: "Run now", click: runNow },
    { label: paused ? "Resume agent" : "Pause agent", click: togglePause },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

// ---------- popover plumbing ----------
const OFFLINE_HTML = (url) => "data:text/html;charset=utf-8," + encodeURIComponent(
  "<!doctype html><meta charset=utf-8>" +
  "<body style=\"font:14px system-ui;margin:24px;color:#222;background:#fff\">" +
  "<p><b>jobgraph is not reachable.</b></p>" +
  "<p>Start the app with <code>npm run demo</code>, then <a href=\"" + url + "\">retry</a>.</p></body>");

function wirePopover(win) {
  const wc = win.webContents;
  const origin = new URL(WEB_URL).origin;
  let sawLogin = false;

  // Anything that is not our web app opens in the real browser.
  wc.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => {
    if (url.startsWith("data:")) return;
    if (new URL(url).origin !== origin) { e.preventDefault(); shell.openExternal(url); }
  });

  // Sign-in happens inside the popover: /companion redirects to /login, and after login we return to /companion.
  wc.on("did-navigate", (_e, url) => {
    let p;
    try { p = new URL(url); } catch { return; }
    if (p.origin !== origin) return;
    if (p.pathname.startsWith("/login")) { sawLogin = true; return; }
    if (sawLogin && !p.pathname.startsWith("/companion")) {
      sawLogin = false;
      wc.loadURL(COMPANION_URL);
      setTimeout(poll, 1500);
    }
  });
  wc.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* aborted */) wc.loadURL(OFFLINE_HTML(COMPANION_URL));
  });
}

app.on("second-instance", () => mb && mb.showWindow());

mb = menubar({
  index: COMPANION_URL,
  icon: iconFor(false),
  tooltip: "Nori",
  preloadWindow: true,
  showDockIcon: false,
  browserWindow: {
    width: 360,
    height: 560,
    resizable: false,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  },
});

mb.on("ready", () => {
  mb.tray.on("right-click", () => mb.tray.popUpContextMenu(contextMenu()));
  nativeTheme.on("updated", applyBadge);
  poll();
  setInterval(poll, POLL_MS);
});

mb.on("after-create-window", () => wirePopover(mb.window));

// Returning to the popover after being signed out or offline: reload and refresh the badge.
mb.on("after-show", () => {
  const url = mb.window.webContents.getURL();
  if (url.startsWith("data:") || /\/login/.test(url)) mb.window.webContents.loadURL(COMPANION_URL);
  poll();
});

// Tray-only app: closing the popover must not quit.
app.on("window-all-closed", () => {});

process.on("uncaughtException", (e) => console.error("[companion] uncaught:", e));
process.on("unhandledRejection", (e) => console.error("[companion] unhandled:", e));
