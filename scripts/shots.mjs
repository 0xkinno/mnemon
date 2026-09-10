/**
 * Regenerate the README assets (banner + 2x2 screenshot grid) from app/.
 *
 * The app is a routed static surface, so each screenshot is a deterministic
 * render of one real route. This harness drives the bundled headless Chromium
 * over the DevTools protocol, captures the viewport only (never the full
 * scrollable page), and forces every screenshot to the exact same dimensions.
 *
 * Usage:  node scripts/shots.mjs
 * Override the browser with CHROME_HEADLESS_SHELL=/path/to/chrome-headless-shell
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCALE = 2;

// Every README screenshot is the same landscape frame: 1440x900 CSS at 2x, so
// all four land at 2880x1800. Nothing is captured beyond the viewport, so no
// frame can ever come out oversized or portrait.
const FRAME = { width: 1440, height: 900 };
const SHOTS = [
  { file: "banner.png", html: "banner.html", width: 1600, height: 520 },
  { file: "screenshot-01.png", html: "index.html", hash: "#/", ...FRAME },
  { file: "screenshot-02.png", html: "index.html", hash: "#/demo", ...FRAME },
  { file: "screenshot-03.png", html: "index.html", hash: "#/evidence", ...FRAME },
  { file: "screenshot-04.png", html: "index.html", hash: "#/architecture", ...FRAME },
];

function findHeadlessShell() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  const roots = [process.env.LOCALAPPDATA, process.env.HOME, process.env.USERPROFILE].filter(Boolean);
  for (const root of roots) {
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

async function main() {
  const shell = findHeadlessShell();
  const profile = mkdtempSync(join(tmpdir(), "mnemon-shots-"));
  const browser = spawn(shell, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-crash-reporter",
    "--disable-software-rasterizer", "--no-first-run", "--no-default-browser-check",
    "--allow-file-access-from-files", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
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

  const written = [];
  for (const shot of SHOTS) {
    const url = pathToFileURL(join(ROOT, "app", shot.html)).href + (shot.hash || "");
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: shot.width, height: shot.height, deviceScaleFactor: SCALE, mobile: false }, sessionId);
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url }, sessionId);
    await loaded;
    await sleep(600);
    const { data } = await cdp.send("Page.captureScreenshot",
      { format: "png", fromSurface: true, captureBeyondViewport: false }, sessionId);
    const out = join(ROOT, "assets", shot.file);
    writeFileSync(out, Buffer.from(data, "base64"));
    written.push({ file: shot.file, size: `${shot.width * SCALE}x${shot.height * SCALE}` });
    await cdp.send("Target.closeTarget", { targetId });
  }

  ws.close();
  browser.kill();
  await sleep(200);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(JSON.stringify({ assets: written, scale: SCALE }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });