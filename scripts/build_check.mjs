#!/usr/bin/env node
// Production build gate for the MNEMON demo surface (`npm run build`).
//
// The app is a static evidence surface, so there is no bundler step. This gate is the
// real pre-deploy check instead: it fails the build if the page has drifted from the
// verified proof artifacts, if a referenced asset is missing, if a secret leaks into
// client-visible output, or if the local database path is exposed to the browser.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const APP = join(ROOT, "app");
const PROOF = join(ROOT, "proof");
const failures = [];
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ check: name, ok: true, detail: detail ?? null });
    if (detail === false) failures.push(name);
  } catch (err) {
    checks.push({ check: name, ok: false, detail: String(err && err.message ? err.message : err) });
    failures.push(name);
  }
}

function snapshotFromArtifacts() {
  const chain = JSON.parse(readFileSync(join(PROOF, "final_e2e_chain.json"), "utf8"));
  const control = JSON.parse(readFileSync(join(PROOF, "final_deletion_control.json"), "utf8"));
  const deletion = {
    phases: control.phases,
    substitutes_present_but_insufficient: control.substitutes_present_but_insufficient,
    deletion_control_verified: control.deletion_control_verified,
  };
  const acp = chain.acp;
  const witness = chain.cold_witness;
  const base = chain.base_commitment;
  return {
    generated_at: chain.generated_at,
    source: "proof/final_e2e_chain.json",
    linkage_verified: chain.linkage_verified,
    acp_job_id: chain.job_id,
    entity_key: chain.entity_key,
    epoch_id: chain.epoch_id,
    acp: {
      job_id: acp.job_id,
      offering: acp.offering,
      final_onchain_status: acp.final_onchain_status,
      deliverable: acp.deliverable,
      deliverable_digest: acp.deliverable_digest,
      deliverable_keccak256: acp.deliverable_keccak256,
      onchain_submitted_hash: acp.onchain_submitted_hash,
    },
    cold_witness: {
      operation_id: witness.operation_id,
      epoch_id: witness.epoch_id,
      writer_id: witness.writer_id,
      claim_hash: witness.claim_hash,
      status: witness.status,
    },
    base_commitment: {
      network: base.network,
      chain_id: base.chain_id,
      contract_address: base.contract_address,
      tx_hash: base.tx_hash,
      block_number: base.block_number,
      explorer: base.explorer,
    },
    verdict: { status: chain.mnemon_final.verdict, action: chain.mnemon_final.action },
    deletion_control: deletion,
  };
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const html = readFileSync(join(APP, "index.html"), "utf8");
const canonical = JSON.stringify(snapshotFromArtifacts());

check("proof/final_e2e_chain.json exists and is linkage-verified", () => {
  const chain = JSON.parse(readFileSync(join(PROOF, "final_e2e_chain.json"), "utf8"));
  const control = JSON.parse(readFileSync(join(PROOF, "final_deletion_control.json"), "utf8"));
  const deletion = {
    phases: control.phases,
    substitutes_present_but_insufficient: control.substitutes_present_but_insufficient,
    deletion_control_verified: control.deletion_control_verified,
  };
  if (chain.linkage_verified !== true) throw new Error("chain.linkage_verified is not true");
  return `job ${chain.job_id}, verdict ${chain.mnemon_final.verdict}`;
});

check("app/evidence.json matches the proof artifacts exactly", () => {
  const onDisk = JSON.parse(readFileSync(join(APP, "evidence.json"), "utf8"));
  const same = JSON.stringify(onDisk) === canonical;
  if (!same) throw new Error("app/evidence.json has drifted from proof/; re-run experiments/app_evidence.py");
  return "in sync";
});

check("index.html inlines the same evidence snapshot", () => {
  const begin = '<script type="application/json" id="evidence-snapshot">';
  const start = html.indexOf(begin);
  if (start === -1) throw new Error("evidence script block missing");
  const from = start + begin.length;
  const to = html.indexOf("</script>", from);
  const inline = html.slice(from, to);
  if (inline !== canonical) throw new Error("inlined snapshot has drifted from proof/; re-run experiments/app_evidence.py");
  return "in sync";
});

check("every locally referenced asset exists", () => {
  const refs = [...html.matchAll(/(?:src|href)="([^":#]+)"/g)].map((m) => m[1]);
  const missing = refs.filter((ref) => !existsSync(join(APP, ref)) && !existsSync(join(ROOT, ref)));
  if (missing.length) throw new Error("missing: " + missing.join(", "));
  return `${refs.length} local reference(s) resolved`;
});

check("no secret material in client-visible output", () => {
  const patterns = [
    [/\b0x[0-9a-fA-F]{64}\b/, "raw 32-byte hex value"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
    [/NEXT_PUBLIC_[A-Z0-9_]*/, "NEXT_PUBLIC_ variable"],
    [/(PRIVATE_KEY|SIGNER_PRIVATE_KEY|ACP_AUTH|SECRET|API_KEY)\s*[:=]/i, "secret assignment"],
    [/MNEMON_ANCHOR_ADDRESS/, "anchor address config"],
  ];
  const hits = [];
  // The inlined evidence snapshot carries public on-chain hashes (keccak/sha256 digests
  // and transaction hashes), so it is excluded from the hex scan. Anything else that
  // looks like key material is a real finding.
  const begin = '<script type="application/json" id="evidence-snapshot">';
  const start = html.indexOf(begin);
  const snapshotFree = start === -1 ? html
    : html.slice(0, start + begin.length) + html.slice(html.indexOf("</script>", start + begin.length));
  for (const file of listFiles(APP)) {
    const name = file.split(/[\\/]/).pop();
    if (name === "evidence.json") continue;
    const text = name === "index.html" ? snapshotFree : readFileSync(file, "utf8");
    for (const [re, label] of patterns) if (re.test(text)) hits.push(`${name}: ${label}`);
  }
  if (hits.length) throw new Error(hits.join("; "));
  return "clean";
});

check("local database path is not exposed to the browser", () => {
  const hits = listFiles(APP).filter((f) => /\.db\b/.test(readFileSync(f, "utf8")));
  if (hits.length) throw new Error("db path referenced in " + hits.map((h) => h.split(/[\\/]/).pop()).join(", "));
  return "clean";
});

check("no server-side signer or wallet module is reachable from the app", () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const bad = refs.filter((r) => /\.(ts|mjs|sol)$/.test(r) || /(\.\.\/|scripts\/|experiments\/)/.test(r));
  if (bad.length) throw new Error("app imports non-static code: " + bad.join(", "));
  return "clean";
});

const report = { gate: "npm run build", ok: failures.length === 0, failures, checks };
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`build failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.error("build ok");
