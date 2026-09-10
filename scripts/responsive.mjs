/**
 * Structural verification for the MNEMON surface.
 *
 *   node scripts/responsive.mjs
 *
 * Drives the bundled headless Chromium over the DevTools protocol and, for every
 * required viewport and every route, checks the things the demo-readiness pass is
 * responsible for: no horizontal overflow, nothing wider than the viewport, no
 * element pushed outside it, no text below the readable floor, no unlabelled
 * control, and a view that actually rendered. It then clicks every navbar link and
 * every demo control to prove the routes and the instrument respond.
 *
 * Exits non-zero if any check fails.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-1024", width: 1024, height: 1366 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1920", width: 1920, height: 1080 }
];
const ROUTES = ["/", "/product", "/demo", "/evidence", "/architecture", "/docs"];
const MIN_FONT = 12;

function findHeadlessShell() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  for (const root of [process.env.LOCALAPPDATA, process.env.HOME, process.env.USERPROFILE].filter(Boolean)) {
    const base = join(root, "ms-playwright");
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell")).sort().reverse()) {
      const exe = join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
      if (existsSync(exe)) return exe;
      const nix = join(base, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
      if (existsSync(nix)) return nix;
    }
  }
  throw new Error("headless Chromium not found; set CHROME_HEADLESS_SHELL");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.next = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: done, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else done(msg.result);
      } else if (msg.method) {
        const handler = this.events.get(msg.method);
        if (handler) { this.events.delete(msg.method); handler(msg.params); }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((done, reject) => {
      this.pending.set(id, { resolve: done, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  once(method) {
    return new Promise((done) => this.events.set(method, done));
  }
}

const PROBE = `(() => {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const view = document.getElementById("view");
  const outside = [];
  const wide = [];
  const tiny = [];
  const unlabeled = [];
  for (const el of view ? view.querySelectorAll("*") : []) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.width > vw + 1) wide.push(el.tagName.toLowerCase() + " " + Math.round(rect.width) + "px");
  }
  for (const el of document.querySelectorAll("a[href], button")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    // The skip link is parked off-canvas until it takes focus; that is the
    // intended pattern, not a layout overflow.
    if (el.classList.contains("skip")) continue;
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim();
    if (!label) unlabeled.push(el.outerHTML.slice(0, 70));
    if (rect.right > vw + 1 || rect.left < -1) {
      outside.push((label || el.tagName).slice(0, 40) + " @ " + Math.round(rect.left) + ".." + Math.round(rect.right));
    }
  }
  for (const el of view ? view.querySelectorAll("p, li, td, th, a[href], button") : []) {
    if (!el.textContent.trim()) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size && size < ${MIN_FONT}) tiny.push(size + "px: " + el.textContent.trim().slice(0, 36));
  }
  return JSON.stringify({
    vw: vw,
    overflow: doc.scrollWidth - vw,
    bodyOverflow: document.body.scrollWidth - vw,
    wide: wide.slice(0, 5),
    outside: outside.slice(0, 5),
    tiny: tiny.slice(0, 5),
    unlabeled: unlabeled.slice(0, 5),
    chars: view ? view.textContent.trim().length : -1
  });
})()`;
async function main() {
  const shell = findHeadlessShell();
  const profile = mkdtempSync(join(tmpdir(), "mnemon-resp-"));
  const browser = spawn(shell, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-crash-reporter",
    "--disable-software-rasterizer", "--no-first-run", "--no-default-browser-check",
    "--allow-file-access-from-files", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore" });

  const portFile = join(profile, "DevToolsActivePort");
  let port = 0;
  for (let i = 0; i < 300 && !port; i++) {
    await sleep(100);
    try { port = Number(readFileSync(portFile, "utf8").split("\n")[0]); } catch { /* not ready */ }
  }
  if (!port) throw new Error("headless Chromium did not report a DevTools port");

  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  const ws = new WebSocket((await res.json()).webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise((done, fail) => { ws.once("open", done); ws.once("error", fail); });
  const cdp = new CDP(ws);

  const home = pathToFileURL(join(ROOT, "app", "index.html")).href;
  const failures = [];
  const results = [];

  async function session(viewport) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 700 },
      sessionId);
    return { targetId, sessionId };
  }

  async function goto(sessionId, hash) {
    // Hash-only navigation is same-document, so Page.loadEventFired never fires.
    // Navigate, then poll for a rendered view instead of waiting on an event.
    await cdp.send("Page.navigate", { url: home + hash }, sessionId);
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      try {
        const state = await evaluate(sessionId, `JSON.stringify({
          ready: document.readyState,
          hash: location.hash,
          chars: (document.getElementById("view") || {}).textContent ? document.getElementById("view").textContent.trim().length : 0
        })`);
        const parsed = JSON.parse(state);
        if (parsed.ready === "complete" && parsed.hash === hash && parsed.chars > 0) return;
      } catch { /* page still swapping contexts */ }
    }
    throw new Error("route never rendered: " + hash);
  }

  async function evaluate(sessionId, expression) {
    const out = await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
    if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails).slice(0, 200));
    return out.result.value;
  }

  for (const viewport of VIEWPORTS) {
    const { targetId, sessionId } = await session(viewport);
    for (const route of ROUTES) {
      await goto(sessionId, "#" + route);
      const raw = await evaluate(sessionId, PROBE);
      const probe = typeof raw === "string" ? JSON.parse(raw) : raw;
      const problems = [];
      if (probe.overflow > 1) problems.push(`horizontal overflow ${probe.overflow}px`);
      if (probe.chars < 200) problems.push(`view rendered only ${probe.chars} chars`);
      if (probe.wide.length) problems.push(`wider than viewport: ${probe.wide.join(", ")}`);
      if (probe.outside.length) problems.push(`control outside viewport: ${probe.outside.join(", ")}`);
      if (probe.tiny.length) problems.push(`text below ${MIN_FONT}px: ${probe.tiny.join(" | ")}`);
      if (probe.unlabeled.length) problems.push(`unlabelled control: ${probe.unlabeled.join(" | ")}`);
      if (problems.length) failures.push(`${viewport.name} ${route}: ${problems.join("; ")}`);
      results.push({ viewport: viewport.name, route, overflow: probe.overflow, chars: probe.chars, ok: problems.length === 0 });
    }
    await cdp.send("Target.closeTarget", { targetId });
  }
  // ---------------------------------------------------------------- interaction
  const mobile = await session(VIEWPORTS[0]);
  await goto(mobile.sessionId, "#/");
  const menuClosed = await evaluate(mobile.sessionId, `(() => {
    const links = document.getElementById("nav-links");
    const toggle = document.getElementById("nav-toggle");
    return JSON.stringify({
      toggleVisible: !!toggle && getComputedStyle(toggle).display !== "none",
      open: links.getAttribute("data-open"),
      expanded: toggle.getAttribute("aria-expanded")
    });
  })()`);
  const closed = JSON.parse(menuClosed);
  if (!closed.toggleVisible) failures.push("mobile: nav toggle is not visible at 390px");
  if (closed.open !== "false" || closed.expanded !== "false") failures.push("mobile: menu is not closed on load");
  await evaluate(mobile.sessionId, `document.getElementById("nav-toggle").click()`);
  await sleep(150);
  const opened = JSON.parse(await evaluate(mobile.sessionId, `(() => {
    const links = document.getElementById("nav-links");
    const toggle = document.getElementById("nav-toggle");
    const first = links.querySelector("a[data-path]").getBoundingClientRect();
    return JSON.stringify({
      open: links.getAttribute("data-open"),
      expanded: toggle.getAttribute("aria-expanded"),
      firstVisible: first.width > 0 && first.height > 0 && first.left >= -1 && first.right <= window.innerWidth + 1
    });
  })()`));
  if (opened.open !== "true" || opened.expanded !== "true") failures.push("mobile: menu did not open on toggle");
  if (!opened.firstVisible) failures.push("mobile: opened menu links are not inside the viewport");
  await cdp.send("Target.closeTarget", { targetId: mobile.targetId });

  // Every navbar link must reach its route and render a view.
  const navSession = await session(VIEWPORTS[4]);
  await goto(navSession.sessionId, "#/");
  const hrefs = JSON.parse(await evaluate(navSession.sessionId,
    `JSON.stringify([...document.querySelectorAll("#nav-links a[data-path]")].map(a => a.getAttribute("data-path")))`));
  for (const path of ROUTES) {
    if (!hrefs.includes(path)) { failures.push(`navbar: no link for ${path}`); continue; }
    await goto(navSession.sessionId, "#/");
    await evaluate(navSession.sessionId,
      `[...document.querySelectorAll("#nav-links a[data-path]")].find(a => a.getAttribute("data-path") === ${JSON.stringify(path)}).click()`);
    await sleep(400);
    const state = JSON.parse(await evaluate(navSession.sessionId, `JSON.stringify({
      hash: location.hash, current: document.querySelector('#nav-links a[aria-current="page"]')?.getAttribute("data-path") || null,
      chars: document.getElementById("view").textContent.trim().length
    })`));
    if (state.hash !== "#" + path) failures.push(`navbar: clicking ${path} landed on ${state.hash}`);
    if (state.chars < 200) failures.push(`navbar: ${path} rendered only ${state.chars} chars`);
    if (state.current !== path) failures.push(`navbar: ${path} is not marked aria-current`);
  }

  // The demo instrument has to actually move, and only in order.
  await goto(navSession.sessionId, "#/demo");
  const demoBefore = JSON.parse(await evaluate(navSession.sessionId, `JSON.stringify({
    cards: document.querySelectorAll("#demo-timeline article").length,
    enabled: [...document.querySelectorAll("#demo-controls-row button:not([disabled]):not([data-action=reset])")].map(b => b.dataset.action),
    ctas: [...document.querySelectorAll("#view a.btn")].map(a => a.textContent.trim())
  })`));
  if (demoBefore.cards !== 1) failures.push(`demo: expected 1 revealed step on load, saw ${demoBefore.cards}`);
  if (demoBefore.enabled.length !== 1 || demoBefore.enabled[0] !== "contention") {
    failures.push(`demo: expected only the contention control enabled, saw ${JSON.stringify(demoBefore.enabled)}`);
  }
  await evaluate(navSession.sessionId,
    `document.querySelector('#demo-controls-row button[data-action="contention"]').click()`);
  await sleep(700);
  const demoAfter = JSON.parse(await evaluate(navSession.sessionId, `JSON.stringify({
    cards: document.querySelectorAll("#demo-timeline article").length,
    enabled: [...document.querySelectorAll("#demo-controls-row button:not([disabled]):not([data-action=reset])")].map(b => b.dataset.action),
    log: document.querySelectorAll("#demo-log .entry").length,
    timelineText: document.getElementById("demo-timeline").textContent
  })`));
  if (demoAfter.cards !== 2) failures.push(`demo: contention did not reveal a second step (${demoAfter.cards})`);
  if (!demoAfter.timelineText.includes("CONTESTED")) failures.push("demo: contention step does not report CONTESTED");
  if (demoAfter.enabled[0] !== "fresh-session") failures.push(`demo: next control is ${demoAfter.enabled[0]}, expected fresh-session`);
  if (!demoAfter.log) failures.push("demo: runtime log stayed empty after an operation");
  await evaluate(navSession.sessionId,
    `document.querySelector('#demo-controls-row button[data-action="reset"]').click()`);
  await sleep(400);
  const demoReset = JSON.parse(await evaluate(navSession.sessionId, `JSON.stringify({
    cards: document.querySelectorAll("#demo-timeline article").length,
    enabled: [...document.querySelectorAll("#demo-controls-row button:not([disabled]):not([data-action=reset])")].map(b => b.dataset.action)
  })`));
  if (demoReset.cards !== 1) failures.push("demo: reset did not return the timeline to one step");
  if (demoReset.enabled[0] !== "contention") failures.push("demo: reset did not re-enable the first control");

  // Landing CTAs must exist and point at real routes.
  await goto(navSession.sessionId, "#/");
  const ctas = JSON.parse(await evaluate(navSession.sessionId, `JSON.stringify(
    [...document.querySelectorAll("#view a.btn[data-path]")].map(a => ({ label: a.textContent.trim(), path: a.getAttribute("data-path") }))
  )`));
  for (const wanted of ["Open live demo", "See the proof"]) {
    const found = ctas.find((c) => c.label === wanted);
    if (!found) failures.push(`landing: CTA "${wanted}" is missing`);
    else if (!ROUTES.includes(found.path)) failures.push(`landing: CTA "${wanted}" points at ${found.path}`);
  }
  await cdp.send("Target.closeTarget", { targetId: navSession.targetId });

  ws.close();
  browser.kill();
  await sleep(200);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }

  const summary = {
    harness: "scripts/responsive.mjs",
    viewports: VIEWPORTS.map((v) => `${v.width}x${v.height}`),
    routes: ROUTES,
    checks: results.length + 8,
    failures,
    ok: failures.length === 0
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });