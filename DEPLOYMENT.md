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

The Vercel build runs `node scripts/build_check.mjs` as its build command, so a deployment cannot go out if the page has drifted from `proof/`.

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
| `app/` | Static evidence page. Plain HTML/CSS/JS reading an inlined JSON snapshot. | Yes |
| `scripts/`, `experiments/`, `mnemon/` | Local proof harness. Reads `.acp-memory.db`, talks to Base Sepolia, and holds signer credentials. | No — local only |

## Static surface (Vercel)

`app/` is a static site with no build step and **no environment variables**.

```text
Framework preset : Other
Build command    : (none)
Output directory : app
```

The page inlines its own evidence snapshot (`<script type="application/json" id="evidence-snapshot">`), so it renders identically with no network, no API, and no database.

### Why it is safe to publish

`npm run build` (`scripts/build_check.mjs`) is the pre-deploy gate. It fails the build when:

- `proof/final_e2e_chain.json` is not linkage-verified;
- `app/evidence.json` or the inlined snapshot has drifted from `proof/`;
- a locally referenced asset is missing;
- secret material appears in client-visible output;
- the local SQLite/Sibyl database path is exposed to the browser;
- the page reaches for server-side or non-static code.

The client-side scans explicitly exclude the inlined evidence snapshot, because public on-chain digests and transaction hashes are not secrets. Everything else that looks like key material is a real finding.

### What is deliberately not deployed

- **No signer, no private key, and no wallet module is reachable from the browser.** The page reads a frozen snapshot; it never signs.
- **No destructive control is exposed.** Deleting Sibyl Memory is a local, server-controlled proof, not a public endpoint.
- **No live reads.** The page states plainly that nothing on it is live, client-generated, or simulated.
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

`npm run build` and `node scripts/shots.mjs` are safe to run anywhere: they only read files and drive a local headless browser.

## Repository hygiene before a public push

`.gitignore` must keep `.env`, `.env.local`, `.realvenv/`, `.venv/`, `.runs/`, `.real-races/`, `*.db`, `__pycache__/`, `.pytest_cache/`, `research/`, and `node_modules/` out of the published tree. Confirm with:

```bash
git ls-files | grep -E '(^|/)(\.env|\.env\.local)$'
git ls-files | grep -E 'node_modules|__pycache__|\.realvenv|\.venv|research/'
```

Both commands must print nothing.