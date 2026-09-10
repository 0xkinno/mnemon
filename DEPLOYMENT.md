# Deployment

MNEMON ships two independent surfaces, and only one of them is deployable to a public host.

## Live

| Item | Value |
|---|---|
| Production URL | <https://mnemon-ochre.vercel.app> |
| Team-scoped URL | <https://mnemon-kinnoskis-projects.vercel.app> |
| Vercel project | `kinnoskis-projects/mnemon` |
| Repository | <https://github.com/0xkinno/mnemon> |
| Framework setting | Other (the static surface, not a Python service) |

The Vercel build runs `node scripts/build_check.mjs` as its build command, so a deployment cannot go out if the page has drifted from `proof/`. Deep links resolve because the build emits a real entry file per route (`app/product.html`, `app/demo.html`, `app/evidence.html`, `app/architecture.html`, `app/docs.html`), each a byte-identical copy of `app/index.html`; `cleanUrls` serves them at `/product`, `/demo`, and so on. Real files are used rather than a catch-all rewrite so that no asset request can be swallowed, and `scripts/build_check.mjs` fails the build if any route file drifts from the shell.

### Environment variables

Nine **non-sensitive** configuration variables are set on the project for Production and Development, so they stay readable and editable in the dashboard:

```text
BASE_SEPOLIA_RPC_URL
BASE_CHAIN_ID
MNEMON_ANCHOR_ADDRESS
ACP_BUYER_WALLET_ADDRESS
ACP_BUYER_WALLET_ID
ACP_PROVIDER_WALLET_ADDRESS
ACP_PROVIDER_AGENT_ID
ACP_PROVIDER_SIGNER_SOURCE
ACP_OFFERING_NAME
```

They are placeholders for the local proof harness, not inputs to the deployed page — the static surface needs no environment at all. `BASE_PRIVATE_KEY` and `ACP_BUYER_SIGNER_PRIVATE_KEY` are deliberately **not** set on Vercel: the deployment has no signer, never signs, and storing key material as a non-sensitive variable would make it readable in plaintext.

Vercel environment variables are scoped to Production and Development only; the CLI will not create a project-wide Preview variable non-interactively, so Preview is unset.

| Surface | What it is | Deployable |
|---|---|---|
| `app/` | Static product surface. Plain HTML/CSS/JS with a client-side router, six views, and an inlined JSON snapshot. | Yes |
| `scripts/demo_api.py` | Local instrument API. Drives the real `mnemon` arbiter over a real `sibyl-memory-client` database so `/demo` can run live. | No — local only |
| `scripts/`, `experiments/`, `mnemon/` | Local proof harness. Reads `.acp-memory.db`, talks to Base Sepolia, and holds signer credentials. | No — local only |

## Static surface (Vercel)

`app/` is a static site with no build step and **no environment variables**.

```text
Framework preset : Other
Build command    : node scripts/build_check.mjs
Output directory : app
```

The page inlines its own evidence snapshot (`<script type="application/json" id="evidence-snapshot">`), so it renders identically with no network, no API, and no database. `/demo` detects that no instrument is reachable and replays the recorded verified run, saying so on screen.

### Why it is safe to publish

`npm run build` (`scripts/build_check.mjs`) is the pre-deploy gate. It fails the build when:

- `proof/final_e2e_chain.json` is not linkage-verified;
- `app/evidence.json` or the inlined snapshot has drifted from `proof/` in any field;
- the snapshot is missing its evidence panel, its proof index, or its recorded demo run;
- a route in the navbar has no view, or a link points at an unknown route;
- a local asset reference is missing;
- `app.js` or `app.css` stopped being referenced;
- an executable inline script reappears in `index.html`;
- non-ASCII text has been mis-decoded (the signature of a bad write on Windows);
- secret material or a raw 32-byte hex value appears in client-visible output;
- the local SQLite/Sibyl database path is exposed to the browser;
- the page reaches for server-side or non-static code.

`node scripts/responsive.mjs` is the companion structural gate: six viewports (`390x844` through `1920x1080`) against six routes, checking overflow, control placement, text size, labels, and that the navbar, mobile menu and demo controls actually work.

`node scripts/audit_ui.mjs` is the functional gate. It asserts route-specific content, resolves every link, rejects dead links and unlabelled controls, fails on any console error, unhandled exception or failed request, walks the whole five-control `/demo` sequence asserting the real verdict and action after each step, exercises reset, opens and closes the mobile menu, and checks that the navbar badge tells the truth about the mode the page reached (`LIVE ENGINE` only if the instrument API answered, `RECORDED RUN` otherwise). Run it with `MNEMON_BASE_URL=https://mnemon-ochre.vercel.app` against production, and with `MNEMON_EXPECT_LIVE=1` against a host serving `scripts/demo_api.py`.

The client-side scans explicitly exclude the inlined evidence snapshot, because public on-chain digests and transaction hashes are not secrets. Everything else that looks like key material is a real finding.

### What is deliberately not deployed

- **No signer, no private key, and no wallet module is reachable from the browser.** The page reads a frozen snapshot; it never signs.
- **No destructive control is exposed.** Deleting Sibyl Memory is a local, server-controlled proof, not a public endpoint.
- **No live reads from the deployed page.** With no instrument API on the host, `/demo` replays artifacts from `proof/` and labels itself a recorded run. Live execution needs `scripts/demo_api.py`, which is never deployed.
- **`NEXT_PUBLIC_*` is unused.** There is no framework and therefore no public env-var channel to leak through.

## Local proof harness

Never deploy this surface. It needs `.env.local`, the local `.acp-memory.db`, and network access to Base Sepolia.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest -q
python experiments/final_e2e_chain.py
python experiments/final_controls.py
```

`npm run build`, `node scripts/responsive.mjs`, `node scripts/audit_ui.mjs` and `node scripts/shots.mjs` are safe to run anywhere: they only read files and drive a local headless browser.

`python scripts/demo_api.py` is also local-only. It writes `.demo-memory.db` (covered by `*.db` in `.gitignore`), binds to `127.0.0.1`, and exists so the `/demo` page can drive the real engine during judging.

## Repository hygiene before a public push

`.gitignore` must keep `.env`, `.env.local`, `.realvenv/`, `.venv/`, `.runs/`, `.real-races/`, `*.db`, `__pycache__/`, `.pytest_cache/`, `research/`, and `node_modules/` out of the published tree. `research/` is also where the third-party reference checkouts used for design reference live (`research/normandy-ref`, `research/vurqel-ref`); they are other projects, not MNEMON code, and must never be committed. Confirm with:

```bash
git ls-files | grep -E '(^|/)(\.env|\.env\.local)$'
git ls-files | grep -E 'node_modules|__pycache__|\.realvenv|\.venv|research/'
```

Both commands must print nothing.