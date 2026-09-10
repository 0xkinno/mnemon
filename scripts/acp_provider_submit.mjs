#!/usr/bin/env node
// Provider-side ACP submit path.
//
// `acp provider submit --deliverable "<json>"` is unusable from PowerShell 5.1:
// the wrapper mangles embedded quotes, so the on-chain hash is computed over a
// different string than the body that gets posted and the evaluator rejects the
// job with "malformed-deliverable". This script validates the deliverable first,
// then hands the raw JSON to the CLI through a direct argv (no shell), and prints
// the digests so the evaluator observation can be cross-checked against the
// on-chain JobSubmitted hash.
//
// usage:
//   node scripts/acp_provider_submit.mjs --job-id 78185 [--deliverable proof/acp_deliverable.json]
//                                         [--chain-id 8453] [--dry-run]
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validate, digests, REQUIRED_FIELDS } from "./acp_preflight.mjs";

const CLI_ENTRY = process.env.ACP_CLI_ENTRY
  ?? "C:\\Users\\hp\\AppData\\Roaming\\npm\\node_modules\\@virtuals-protocol\\acp-cli\\dist\\bin\\acp.js";

const flag = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const jobId = flag("--job-id", process.env.ACP_JOB_ID);
const chainId = flag("--chain-id", process.env.ACP_CHAIN_ID ?? "8453");
const deliverablePath = flag("--deliverable", "proof/acp_deliverable.json");
const dryRun = process.argv.includes("--dry-run");

if (!jobId) {
  console.error("usage: node scripts/acp_provider_submit.mjs --job-id <id> [--deliverable <path>] [--chain-id <id>] [--dry-run]");
  process.exit(2);
}

const raw = readFileSync(deliverablePath, "utf8").replace(/\n$/, "");
const check = validate(raw);
const digest = digests(raw);
console.error(JSON.stringify({
  step: "preflight", deliverable_path: deliverablePath, required_fields: REQUIRED_FIELDS,
  ok: check.ok, errors: check.errors, ...digest,
}, null, 2));
if (!check.ok) {
  console.error("refusing to submit: deliverable failed pre-flight validation");
  process.exit(1);
}

const argv = [CLI_ENTRY, "provider", "submit", "--job-id", jobId, "--deliverable", raw, "--chain-id", chainId, "--json"];
if (dryRun) {
  console.log(JSON.stringify({
    step: "dry-run", cli: CLI_ENTRY, argv_without_deliverable: argv.filter((a) => a !== raw),
    deliverable: check.deliverable, ...digest,
  }, null, 2));
  process.exit(0);
}

const result = spawnSync(process.execPath, argv, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
console.log(JSON.stringify({
  step: "submit", job_id: jobId, chain_id: chainId, exit_code: result.status,
  ...digest, submitted_at: new Date().toISOString(),
}, null, 2));
process.exit(result.status ?? 1);
