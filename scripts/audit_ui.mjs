/**
 * Full functional audit of the MNEMON surface.
 *
 *   node scripts/audit_ui.mjs
 *   MNEMON_BASE_URL=https://mnemon-ochre.vercel.app node scripts/audit_ui.mjs
 *
 * This is the "does it actually work" gate, as opposed to the structural gate in
 * responsive.mjs. For every route and every required viewport it records console
 * errors, unhandled exceptions, failed requests, layout overflow and any literal
 * markup that leaked into rendered text. It then asserts route-specific content,
 * resolves every link, and walks the entire demo sequence -- all five controls --
 * asserting the real verdict and action after each step.
 *
 * Exits non-zero if anything fails.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROUTES = ["/", "/product", "/demo", "/evidence", "/architecture", "/docs"];
const VIEWPORTS = [
  { name: "desktop-1920", width: 1920, height: 1080 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "laptop-1024", width: 1024, height: 1366 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "mobile-390", width: 390, height: 844 }
];
const SHOTS = [
  { file: "screenshot-01.png", route: "/" },
  { file: "screenshot-02.png", route: "/demo" },
  { file: "screenshot-03.png", route: "/evidence" },
  { file: "screenshot-04.png", route: "/architecture" }
];

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
    this.listeners = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: done, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else done(msg.result);
      } else if (msg.method) {
        for (const handler of this.listeners.get(msg.method) || []) handler(msg.params, msg.sessionId);
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
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }
}


const PROBE = `(() => {
  const vw = window.innerWidth;
  const view = document.getElementById("view");
  const text = view ? view.innerText : "";
  const leaks = [];
  for (const needle of ['<div', '</div', 'class="', 'undefined', 'NaN', '[object Object]', '&amp;', '&lt;']) {
    if (text.includes(needle)) leaks.push(needle);
  }
  const wide = [];
  for (const el of view ? view.querySelectorAll("*") : []) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.width > vw + 1) wide.push(el.tagName.toLowerCase() + " " + Math.round(r.width) + "px");
  }
  const dead = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const h = a.getAttribute("href");
    if (h === "#" || h.startsWith("javascript:")) dead.push((a.textContent || "").trim().slice(0, 40) || h);
  }
  const unlabeled = [];
  for (const el of document.querySelectorAll("a[href], button")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (!(el.getAttribute("aria-label") || el.textContent || "").trim()) unlabeled.push(el.outerHTML.slice(0, 60));
  }
  const badge = document.querySelector(".nav-status-badge");
  const headings = [...document.querySelectorAll("#view h1, #view h2")].map((h) => h.textContent.trim()).slice(0, 6);
  return JSON.stringify({
    vw: vw,
    overflow: document.documentElement.scrollWidth - vw,
    chars: text.trim().length,
    leaks: leaks,
    wide: wide.slice(0, 4),
    dead: dead.slice(0, 4),
    unlabeled: unlabeled.slice(0, 4),
    badge: badge ? badge.textContent.replace(/\s+/g, " ").trim() : null,
    brand: (document.querySelector(".brand") || {}).textContent || null,
    headings: headings
  });
})()`;

const readRouteExpr = (remote) => remote
  ? '(location.pathname.replace(/\\/$/, "") || "/")'
  : '(location.hash.replace(/^#/, "") || "/")';

async function main() {
  const shell = findHeadlessShell();
  const profile = mkdtempSync(join(tmpdir(), "mnemon-audit-"));
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

  const remote = process.env.MNEMON_BASE_URL ? process.env.MNEMON_BASE_URL.replace(/\/$/, "") : null;
  const home = remote || pathToFileURL(join(ROOT, "app", "index.html")).href;
  const urlFor = (route) => (remote ? home + route : home + "#" + route);
  const readRoute = readRouteExpr(Boolean(remote));

  const failures = [];
  const log = [];
  let consoleErrors = [];
  let requestFailures = [];

  async function session(viewport) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    cdp.on("Runtime.exceptionThrown", (p) => {
      if (p && p.exceptionDetails && p.exceptionDetails.text) consoleErrors.push("exception: " + p.exceptionDetails.text);
    });
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p && p.type === "error") {
        consoleErrors.push("console.error: " + (p.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 200));
      }
    });
    cdp.on("Network.loadingFailed", (p) => {
      if (!p || p.canceled) return;
      requestFailures.push(String(p.errorText || "failed") + " " + String(p.type || ""));
    });
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 700 }, sessionId);
    return { targetId, sessionId };
  }

  async function goto(sessionId, route) {
    consoleErrors = [];
    requestFailures = [];
    await cdp.send("Page.navigate", { url: urlFor(route) }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      try {
        const parsed = JSON.parse(await evaluate(sessionId, `JSON.stringify({
          ready: document.readyState,
          route: ${readRoute},
          chars: (document.getElementById("view") || {}).textContent ? document.getElementById("view").textContent.trim().length : 0
        })`));
        if (parsed.ready === "complete" && parsed.route === route && parsed.chars > 0) { await sleep(250); return; }
      } catch { /* context still swapping */ }
    }
    throw new Error("route never rendered: " + route);
  }

  async function evaluate(sessionId, expression) {
    const out = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (out.exceptionDetails) {
      const d = out.exceptionDetails.exception && out.exceptionDetails.exception.description;
      throw new Error((d || out.exceptionDetails.text || "evaluate failed") + " :: " + String(expression).replace(/\s+/g, " ").slice(0, 160));
    }
    return out.result.value;
  }


  // ------------------------------------------------------------ route content
  const headingsByRoute = new Map();

  for (const viewport of VIEWPORTS) {
    const { targetId, sessionId } = await session(viewport);
    for (const route of ROUTES) {
      await goto(sessionId, route);
      const probe = JSON.parse(await evaluate(sessionId, PROBE));
      const at = `${viewport.name} ${route}`;

      if (probe.overflow > 1) failures.push(`${at}: horizontal overflow ${probe.overflow}px`);
      if (probe.chars < 400) failures.push(`${at}: view rendered only ${probe.chars} chars`);
      if (probe.leaks.length) failures.push(`${at}: literal markup in rendered text: ${probe.leaks.join(", ")}`);
      if (probe.wide.length) failures.push(`${at}: element wider than viewport: ${probe.wide.join(", ")}`);
      if (probe.dead.length) failures.push(`${at}: dead link: ${probe.dead.join(", ")}`);
      if (probe.unlabeled.length) failures.push(`${at}: unlabelled control: ${probe.unlabeled.join(" | ")}`);
      if (consoleErrors.length) failures.push(`${at}: console error: ${consoleErrors.slice(0, 2).join(" | ")}`);
      if (requestFailures.length) failures.push(`${at}: failed request: ${requestFailures.slice(0, 2).join(" | ")}`);
      if (!viewport.name.startsWith("mobile") && probe.brand && probe.brand.trim() !== "mnemon.") {
        failures.push(`${at}: wordmark renders as ${JSON.stringify(probe.brand.trim())}`);
      }
      if (viewport.name === "desktop-1440") headingsByRoute.set(route, probe.headings.join(" | "));
      log.push({ at, overflow: probe.overflow, chars: probe.chars, badge: probe.badge, ok: true });
    }
    await cdp.send("Target.closeTarget", { targetId });
  }

  // Every route must render its own content, not a shared fallback.
  const seen = new Map();
  for (const [route, headings] of headingsByRoute) {
    if (!headings) failures.push(`route ${route} rendered no headings`);
    if (seen.has(headings)) failures.push(`routes ${seen.get(headings)} and ${route} render identical headings`);
    seen.set(headings, route);
  }

  // A route that does not exist must not silently impersonate the landing page.
  const unknown = await session(VIEWPORTS[1]);
  let unknownProbe = null;
  try {
    await goto(unknown.sessionId, "/definitely-not-a-route");
    unknownProbe = JSON.parse(await evaluate(unknown.sessionId, PROBE));
  } catch { /* a real host may answer with its own not-found document */ }
  if (unknownProbe) {
    if (!/does not exist|not found/i.test(unknownProbe.headings.join(" ") + unknownProbe.brand)) {
      failures.push("unknown route does not render a not-found view: " + unknownProbe.headings.join(" | "));
    }
  } else if (remote) {
    // Vercel answers an unknown path with its own 404 rather than letting the
    // router render one, so assert the status instead of the markup.
    const res = await fetch(remote + "/definitely-not-a-route");
    if (res.status !== 404) {
      failures.push("unknown route answered " + res.status + " and rendered no not-found view");
    }
  } else {
    failures.push("unknown route rendered nothing");
  }
  await cdp.send("Target.closeTarget", { targetId: unknown.targetId });


  // -------------------------------------------------------------- demo walk
  const SEQUENCE = [
    { action: "contention", verdict: "CONTESTED", consequence: "BLOCKED" },
    { action: "fresh-session", verdict: "CONTESTED", consequence: "BLOCKED" },
    { action: "delete-memory", verdict: "UNWITNESSED", consequence: "BLOCKED" },
    { action: "restore-memory", verdict: "CLEAN", consequence: "ALLOWED" },
    { action: "rerun-flow", verdict: "CLEAN", consequence: "ALLOWED" }
  ];

  const demoState = `JSON.stringify({
    cards: document.querySelectorAll("#demo-timeline article").length,
    last: (document.querySelector("#demo-timeline article:last-of-type") || {}).innerText || "",
    enabled: [...document.querySelectorAll("#demo-controls-row button:not([disabled]):not([data-action=reset])")].map((b) => b.dataset.action),
    badges: document.querySelectorAll("#demo-timeline .badge, #demo-timeline span").length,
    log: document.querySelectorAll("#demo-log .entry, #demo-log > *").length,
    status: (document.getElementById("demo-status-line") || {}).innerText || "",
    engine: (document.getElementById("nav-engine-label") || {}).textContent || ""
  })`;

  async function walk(label, sessionId, expectLive) {
    await goto(sessionId, "/demo");
    // The engine probe is a real network call. Wait for the badge to settle
    // rather than racing it, or a slow instrument reads as still "checking".
    for (let i = 0; i < 40; i++) {
      const badgeText = await evaluate(sessionId, `(document.getElementById("nav-engine-label") || {}).textContent || ""`);
      if (String(badgeText).trim() !== "CHECKING ENGINE") break;
      await sleep(150);
    }
    let state = JSON.parse(await evaluate(sessionId, demoState));
    if (state.cards !== 1) failures.push(`${label}: demo opens with ${state.cards} revealed steps, expected 1`);
    if (state.enabled.length !== 1 || state.enabled[0] !== "contention") {
      failures.push(`${label}: expected only the contention control enabled, saw ${JSON.stringify(state.enabled)}`);
    }
    const wanted = expectLive ? "LIVE ENGINE" : "RECORDED RUN";
    if (state.engine.trim() !== wanted) {
      failures.push(`${label}: engine badge reads ${JSON.stringify(state.engine.trim())}, expected ${wanted}`);
    }
    if (expectLive && !/live/i.test(state.status)) failures.push(`${label}: status line does not report a live instrument`);
    if (!expectLive && !/recorded/i.test(state.status)) failures.push(`${label}: status line does not report a recorded run`);

    for (let i = 0; i < SEQUENCE.length; i++) {
      const step = SEQUENCE[i];
      const before = JSON.parse(await evaluate(sessionId, demoState));
      if (before.enabled[0] !== step.action) {
        failures.push(`${label}: step ${i + 1} expects ${step.action} enabled, saw ${JSON.stringify(before.enabled)}`);
      }
      const clicked = await evaluate(sessionId, `(() => {
        const row = document.getElementById("demo-controls-row");
        const btn = row && row.querySelector('button[data-action="${step.action}"]');
        if (!btn) return "missing:" + (row ? row.innerText.replace(/\\s+/g, " ").slice(0, 160) : "no row");
        if (btn.disabled) return "disabled";
        btn.click();
        return "ok";
      })()`);
      if (clicked !== "ok") { failures.push(`${label}: ${step.action} could not be clicked (${clicked})`); break; }
      let after = null;
      for (let tries = 0; tries < 60; tries++) {
        await sleep(150);
        after = JSON.parse(await evaluate(sessionId, demoState));
        if (after.cards > before.cards) break;
      }
      if (after.cards !== before.cards + 1) {
        failures.push(`${label}: ${step.action} revealed ${after.cards - before.cards} steps`);
        break;
      }
      if (!after.last.includes(step.verdict)) failures.push(`${label}: ${step.action} did not render ${step.verdict}`);
      if (!after.last.includes(step.consequence)) failures.push(`${label}: ${step.action} did not render ${step.consequence}`);
    }

    const done = JSON.parse(await evaluate(sessionId, demoState));
    if (done.cards !== 6) failures.push(`${label}: full walk revealed ${done.cards} steps, expected 6`);
    if (done.log < 5) failures.push(`${label}: runtime log has ${done.log} entries after 5 operations`);

    const resetClicked = await evaluate(sessionId, `(() => {
      const row = document.getElementById("demo-controls-row");
      const btn = row && row.querySelector('button[data-action="reset"]');
      if (!btn) return "missing@" + (row ? row.outerHTML.replace(/\\s+/g, " ").slice(0, 300) : "no-row");
      btn.click();
      return "ok";
    })()`);
    if (resetClicked !== "ok") failures.push(`${label}: reset control unavailable (${resetClicked})`);
    await sleep(500);
    const reset = JSON.parse(await evaluate(sessionId, demoState));
    if (reset.cards !== 1) failures.push(`${label}: reset left ${reset.cards} revealed steps`);
    if (reset.enabled[0] !== "contention") failures.push(`${label}: reset did not re-arm the first control`);

    log.push({ at: label, cards: done.cards, logEntries: done.log, engine: done.engine, ok: true });
  }

  // MNEMON_BASE_URL + MNEMON_EXPECT_LIVE=1 runs the same walk against a host with
  // the instrument API running, which is the only way to exercise the live path.
  const expectLive = process.env.MNEMON_EXPECT_LIVE === "1";
  const walkSession = await session(VIEWPORTS[1]);
  await walk(expectLive ? "live-engine" : "recorded-run", walkSession.sessionId, expectLive);
  await cdp.send("Target.closeTarget", { targetId: walkSession.targetId });


  // ------------------------------------------------------ mobile navigation
  const mobile = await session(VIEWPORTS[4]);
  await goto(mobile.sessionId, "/");
  const menu = JSON.parse(await evaluate(mobile.sessionId, `(() => {
    const toggle = document.getElementById("nav-toggle");
    const links = document.getElementById("nav-links");
    if (!toggle || !links) return JSON.stringify({ ok: false, why: "no toggle or link list" });
    if (toggle.getBoundingClientRect().width === 0) {
      return JSON.stringify({ ok: false, why: "menu toggle is not visible at " + window.innerWidth + "px" });
    }
    if (!(toggle.getAttribute("aria-label") || "").trim()) {
      return JSON.stringify({ ok: false, why: "menu toggle has no accessible label" });
    }
    toggle.click();
    const opened = {
      expanded: toggle.getAttribute("aria-expanded"),
      open: links.getAttribute("data-open"),
      visible: [...links.querySelectorAll("a")].filter((a) => a.getBoundingClientRect().height > 0).length
    };
    toggle.click();
    const closed = { expanded: toggle.getAttribute("aria-expanded"), open: links.getAttribute("data-open") };
    return JSON.stringify({ ok: true, opened: opened, closed: closed });
  })()`));
  if (!menu.ok) {
    failures.push("mobile-430 menu: " + menu.why);
  } else {
    if (menu.opened.expanded !== "true" || menu.opened.open !== "true") {
      failures.push("mobile-430 menu did not open: " + JSON.stringify(menu.opened));
    }
    if (menu.opened.visible < 6) failures.push("mobile-430 menu opened with " + menu.opened.visible + " visible links");
    if (menu.closed.expanded !== "false" || menu.closed.open !== "false") {
      failures.push("mobile-430 menu did not close: " + JSON.stringify(menu.closed));
    }
  }
  log.push({ at: "mobile-430 menu", visible: menu.ok ? menu.opened.visible : 0, ok: Boolean(menu.ok) });
  await cdp.send("Target.closeTarget", { targetId: mobile.targetId });


  // ------------------------------------------------------------- screenshots
  if (process.env.MNEMON_SHOTS === "1") {
    const outDir = join(ROOT, "assets");
    mkdirSync(outDir, { recursive: true });
    const shot = await session(VIEWPORTS[1]);
    // README screenshots are captured at 2x so they stay crisp when scaled down.
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: VIEWPORTS[1].width, height: VIEWPORTS[1].height, deviceScaleFactor: 2, mobile: false }, shot.sessionId);
    for (const item of SHOTS) {
      await goto(shot.sessionId, item.route);
      await sleep(400);
      const { data } = await cdp.send("Page.captureScreenshot",
        { format: "png", fromSurface: true, captureBeyondViewport: false }, shot.sessionId);
      writeFileSync(join(outDir, item.file), Buffer.from(data, "base64"));
      log.push({ shot: item.file, route: item.route, size: `${VIEWPORTS[1].width * 2}x${VIEWPORTS[1].height * 2}` });
    }
    await cdp.send("Target.closeTarget", { targetId: shot.targetId });
  }

  ws.close();
  browser.kill();
  await sleep(200);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(JSON.stringify({
    audit: "full functional UI audit",
    target: remote || "local file://",
    routes: ROUTES,
    viewports: VIEWPORTS.map((v) => v.name),
    checks: log.length,
    failures,
    ok: failures.length === 0
  }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((err) => { console.log(JSON.stringify({ fatal: String((err && err.message) || err) }, null, 2)); process.exit(1); });
