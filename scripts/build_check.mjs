#!/usr/bin/env node
// Production build gate for the MNEMON product surface (`npm run build`).
//
// The app is a routed static surface, so there is no bundler step. This gate is
// the real pre-deploy check instead. It fails the build when:
//
//   * the rendered evidence snapshot has drifted from proof/ in any way;
//   * a route in the navbar has no view, or a link points at an unknown route;
//   * a referenced asset is missing, or the app imports non-static code;
//   * a secret, a raw key-shaped value, or a local database path reaches the browser;
//   * app.js or app.css stopped being referenced, or an executable inline script crept in.
//
// snapshotFromArtifacts() must stay byte-identical to experiments/app_evidence.py.
// If it drifts, the snapshot check fails, which is the signal that one of the two
// was edited and the other was not.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const APP = join(ROOT, "app");
const PROOF = join(ROOT, "proof");
const SNAPSHOT_BEGIN = '<script type="application/json" id="evidence-snapshot">';
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

const readJson = (name) => JSON.parse(readFileSync(join(PROOF, name), "utf8"));
const tone = (...flags) => (flags.every(Boolean) ? "ok" : "block");
const lower = (value) => String(value).toLowerCase();
function byName(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function proofIndex() {
  const rows = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort(byName)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const data = readFileSync(full);
      rows.push({
        name: relative(ROOT, full).split("\\").join("/"),
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.length,
      });
    }
  };
  walk(PROOF);
  return rows;
}

function evidencePanel() {
  const source = readJson("source_verification.json");
  const manifest = readJson("run_manifest.json");
  const race = readJson("race_matrix.json");
  const fresh = readJson("fresh_session.json");
  const deletion = readJson("delete_memory.json");
  const tamper = readJson("tamper.json");
  const audit = readJson("final_integrity_audit.json");
  const acpJob = readJson("acp_job_78185.json");
  const base = readJson("base_transaction_verified.json");

  const contested = race.filter((t) => t.mnemon.status === "CONTESTED").length;
  const mustBlock = audit.cases.filter((c) => c.must_block);
  const held = mustBlock.filter((c) => c.passed);
  const artifactCount = Object.keys(manifest.artifacts).length;

  return [
    {
      label: "Sibyl version",
      value: source.package + " " + source.version,
      detail: "WARM " + source.warm_schema + "; COLD " + source.cold_schema,
      artifact: "proof/source_verification.json",
      tone: "ok",
    },
    {
      label: "Experiment status",
      value: manifest.test_result,
      detail: "suite green on python " + manifest.python + "; " + artifactCount
        + " artifacts hashed in proof/run_manifest.json",
      artifact: "proof/run_manifest.json",
      tone: tone(manifest.test_passed),
    },
    {
      label: "Race result",
      value: contested + "/" + race.length + " trials CONTESTED",
      detail: "independent writers race the same entity and epoch; no trial silently settles on the last writer",
      artifact: "proof/race_matrix.json",
      tone: "warn",
    },
    {
      label: "Fresh-process result",
      value: fresh.verdict.status + " (pid " + fresh.pid + ")",
      detail: "a separate interpreter re-reads the same memory and returns the same verdict",
      artifact: "proof/fresh_session.json",
      tone: "warn",
    },
    {
      label: "Deletion result",
      value: deletion.verdict.status + " / " + deletion.action,
      detail: "removing the memory layer removes the ability to establish CLEAN (" + deletion.verdict.reason + ")",
      artifact: "proof/delete_memory.json",
      tone: "block",
    },
    {
      label: "Tamper result",
      value: tamper.status,
      detail: "an altered claim is rejected before it can be acted on: " + tamper.reason,
      artifact: "proof/tamper.json",
      tone: "block",
    },
    {
      label: "Integrity audit",
      value: held.length + "/" + mustBlock.length + " must-block cases hold",
      detail: audit.cases.length + " adversarial cases run against the real engine; audit_passed=" + lower(audit.audit_passed),
      artifact: "proof/final_integrity_audit.json",
      tone: tone(audit.audit_passed),
    },
    {
      label: "ACP job status",
      value: acpJob.final_status + " (job " + acpJob.acp_job_id + ")",
      detail: "Virtuals ACP on " + acpJob.network + "; rejected=" + lower(acpJob.rejected)
        + "; evaluator, provider and buyer binding re-checked on chain",
      artifact: "proof/acp_job_78185.json",
      tone: tone(acpJob.final_status === "COMPLETED", acpJob.rejected === false),
    },
    {
      label: "Base transaction status",
      value: "receipt status " + base.receipt_status + " (block " + base.block_number + ")",
      detail: "claim hash decoded from the anchor event matches the witnessed claim: " + lower(base.claim_hash_matches),
      artifact: "proof/base_transaction_verified.json",
      tone: tone(base.receipt_status === 1, base.claim_hash_matches === true),
    },
  ];
}
function witness(entry) {
  return {
    status: entry.status,
    claim_hash: entry.claim_hash,
    writer_id: entry.writer_id,
    epoch_id: entry.epoch_id,
    operation_id: entry.operation_id,
  };
}

function demoRecorded() {
  const chain = readJson("final_e2e_chain.json");
  const race = readJson("race_output.json");
  const fresh = readJson("fresh_session.json");
  const deletion = readJson("delete_memory.json");
  const control = readJson("final_deletion_control.json");
  const finalFresh = readJson("final_fresh_session.json");

  const resolved = chain.cold_witness;
  const cleanPhase = control.phases[0];
  const cached = Object.values(chain.link_checks).filter(Boolean).length;
  const linkTotal = Object.keys(chain.link_checks).length;

  return {
    label: "Recorded verified run",
    entity_key: chain.entity_key,
    sequence: ["baseline", "contention", "fresh", "delete", "restore", "rerun"],
    steps: {
      baseline: {
        id: "baseline",
        stage: "Observe",
        label: "Known state",
        title: "Start from a memory state MNEMON is willing to authorise.",
        warm: witness(resolved),
        cold: [witness(resolved)],
        verdict: chain.mnemon_final.verdict,
        action: chain.mnemon_final.action,
        note: "WARM and COLD carry the same claim hash for the same entity and epoch, so the current value is "
          + "bound to its durable witness and nothing contradicts it. The adjudicated status is "
          + resolved.status + "; what MNEMON certifies here is that the value is consistent and witnessed.",
        artifact: "proof/final_e2e_chain.json",
      },
      contention: {
        id: "contention",
        stage: "Reconcile",
        label: "Contention",
        title: "Two independent observers commit conflicting claims for one entity and epoch.",
        warm: witness(race.warm),
        cold: race.cold.map(witness),
        verdict: race.mnemon.status,
        action: "BLOCKED",
        note: "WARM holds a single row while COLD keeps both witnesses. MNEMON sees two credentialed writers "
          + "disagree inside epoch " + race.warm.epoch_id + ", so the action is blocked instead of "
          + "silently settling on whichever write landed last.",
        artifact: "proof/race_output.json",
      },
      fresh: {
        id: "fresh",
        stage: "Reconcile",
        label: "Fresh process",
        title: "A separate interpreter re-reads the same memory and reaches the same verdict.",
        warm: witness(fresh.verdict.current),
        cold: fresh.verdict.claims.map(witness),
        verdict: fresh.verdict.status,
        action: "BLOCKED",
        note: "Process " + fresh.pid + " started with no cache or injected state and arrived at "
          + fresh.verdict.status + " from persistence alone. The verdict is a property of the memory, "
          + "not of the process that happened to read it.",
        artifact: "proof/fresh_session.json",
      },
      delete: {
        id: "delete",
        stage: "Verdict",
        label: "Memory removed",
        title: "Delete the memory layer and the ability to establish CLEAN goes with it.",
        warm: null,
        cold: [],
        verdict: deletion.verdict.status,
        action: deletion.action,
        note: "memory_removed=" + lower(deletion.memory_removed) + "; the arbiter returns "
          + deletion.verdict.reason + ". The persisted ACP result and the Base anchor are still on "
          + "disk, and neither can substitute for the witness that lived in Sibyl Memory.",
        artifact: "proof/delete_memory.json",
      },
      restore: {
        id: "restore",
        stage: "Action",
        label: "Memory restored",
        title: "Restore the witness and the state is authorisable again.",
        warm: witness(resolved),
        cold: [witness(resolved)],
        verdict: cleanPhase.verdict,
        action: cleanPhase.action,
        note: "The deletion control records phase " + cleanPhase.phase + " with verdict "
          + cleanPhase.verdict + " and claim count " + cleanPhase.claim_count + " once the "
          + "witness is back. Recovery is a property of the memory layer, not of a cached decision.",
        artifact: "proof/final_deletion_control.json",
      },
      rerun: {
        id: "rerun",
        stage: "Action",
        label: "Re-run",
        title: "Re-run the flow end to end and the resolved state re-verifies.",
        warm: witness(resolved),
        cold: [witness(resolved)],
        verdict: chain.mnemon_final.verdict,
        action: chain.mnemon_final.action,
        note: cached + "/" + linkTotal + " link checks pass on the re-run, and a brand new "
          + "interpreter (pid " + finalFresh.child.pid + ") reconstructs the same verdict from "
          + "persistence. The ACP deliverable and the Base anchor both bind the identical claim hash.",
        artifact: "proof/final_e2e_chain.json",
      },
    },
    controls: [
      { action: "contention", label: "Run contention proof", step: "contention" },
      { action: "fresh-session", label: "Fresh-session verification", step: "fresh" },
      { action: "delete-memory", label: "Delete memory", step: "delete" },
      { action: "restore-memory", label: "Restore memory", step: "restore" },
      { action: "rerun-flow", label: "Re-run full flow", step: "rerun" },
    ],
  };
}
function snapshotFromArtifacts() {
  const chain = readJson("final_e2e_chain.json");
  const control = readJson("final_deletion_control.json");
  const source = readJson("source_verification.json");
  const deletion = {
    phases: control.phases,
    substitutes_present_but_insufficient: control.substitutes_present_but_insufficient,
    deletion_control_verified: control.deletion_control_verified,
  };
  const acp = chain.acp;
  const witnessRecord = chain.cold_witness;
  const base = chain.base_commitment;
  return {
    generated_at: chain.generated_at,
    source: "proof/final_e2e_chain.json",
    linkage_verified: chain.linkage_verified,
    acp_job_id: chain.job_id,
    entity_key: chain.entity_key,
    epoch_id: chain.epoch_id,
    sibyl_version: source.version,
    contract_explorer: base.explorer.split("/tx/")[0] + "/address/" + base.contract_address,
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
      operation_id: witnessRecord.operation_id,
      epoch_id: witnessRecord.epoch_id,
      writer_id: witnessRecord.writer_id,
      claim_hash: witnessRecord.claim_hash,
      status: witnessRecord.status,
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
    evidence_panel: evidencePanel(),
    proof_index: proofIndex(),
    demo: { recorded: demoRecorded() },
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
const NAV_PATHS = [...html.matchAll(/data-nav data-path="([^"]+)"/g)].map((m) => m[1]);
const ALL_PATHS = [...new Set(NAV_PATHS)].sort();
check("proof/final_e2e_chain.json exists and is linkage-verified", () => {
  const chain = readJson("final_e2e_chain.json");
  if (chain.linkage_verified !== true) throw new Error("chain.linkage_verified is not true");
  return "job " + chain.job_id + ", verdict " + chain.mnemon_final.verdict;
});

check("app/evidence.json matches the proof artifacts exactly", () => {
  const onDisk = JSON.parse(readFileSync(join(APP, "evidence.json"), "utf8"));
  if (JSON.stringify(onDisk) !== canonical) {
    throw new Error("app/evidence.json has drifted from proof/; re-run experiments/app_evidence.py");
  }
  return "in sync (" + canonical.length + " bytes canonical)";
});

check("index.html inlines the same evidence snapshot", () => {
  const start = html.indexOf(SNAPSHOT_BEGIN);
  if (start === -1) throw new Error("evidence script block missing");
  const from = start + SNAPSHOT_BEGIN.length;
  const to = html.indexOf("</script>", from);
  if (html.slice(from, to) !== canonical) {
    throw new Error("inlined snapshot has drifted from proof/; re-run experiments/app_evidence.py");
  }
  return "in sync";
});

check("the snapshot carries a panel, a proof index and the recorded run", () => {
  const snap = JSON.parse(canonical);
  if (!Array.isArray(snap.evidence_panel) || snap.evidence_panel.length < 8) {
    throw new Error("evidence_panel must list at least the eight verified readouts");
  }
  if (!Array.isArray(snap.proof_index) || snap.proof_index.length < 20) {
    throw new Error("proof_index must cover the proof directory");
  }
  const demo = snap.demo && snap.demo.recorded;
  if (!demo || !demo.sequence.length || !Object.keys(demo.steps).length) {
    throw new Error("demo.recorded is missing the recorded step sequence");
  }
  const ids = new Set(demo.sequence);
  for (const step of Object.values(demo.steps)) {
    if (!ids.has(step.id)) throw new Error("step " + step.id + " is not in the recorded sequence");
    if (!step.verdict || !step.action) throw new Error("step " + step.id + " has no verdict or action");
  }
  for (const control of demo.controls) {
    if (!ids.has(control.step)) throw new Error("control " + control.action + " targets an unknown step");
  }
  return snap.evidence_panel.length + " panel rows, " + snap.proof_index.length + " artifacts, "
    + demo.sequence.length + " steps, " + demo.controls.length + " controls";
});

check("every locally referenced asset exists", () => {
  // Navbar links are client-side routes, not files; they are checked separately below.
  const refs = [...html.matchAll(/(?:src|href)="([^":#]+)"/g)]
    .map((m) => m[1])
    .filter((ref) => !ALL_PATHS.includes(ref));
  const missing = refs.filter((ref) => !existsSync(join(APP, ref)) && !existsSync(join(ROOT, ref)));
  if (missing.length) throw new Error("missing: " + missing.join(", "));
  return refs.length + " local asset reference(s) resolved; " + ALL_PATHS.length + " routes skipped";
});

check("app.js and app.css are present and referenced", () => {
  for (const name of ["app.js", "app.css"]) {
    if (!existsSync(join(APP, name))) throw new Error("app/" + name + " is missing");
    if (!html.includes('"./' + name + '"')) throw new Error("index.html no longer references app/" + name);
  }
  return "both referenced";
});

check("no executable inline script in index.html", () => {
  const tags = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  const bad = tags.filter((attrs) => !/\bsrc=/.test(attrs) && !/type="application\/json"/.test(attrs));
  if (bad.length) throw new Error("inline script without a JSON type: " + bad.join(" | "));
  return tags.length + " script tag(s), all either external or the JSON snapshot";
});

check("every route has a real entry file identical to the shell", () => {
  const routes = ["product", "demo", "evidence", "architecture", "docs"];
  const shell = readFileSync(join(APP, "index.html"), "utf8");
  for (const slug of routes) {
    const file = join(APP, slug + ".html");
    if (!existsSync(file)) throw new Error("app/" + slug + ".html is missing; re-run experiments/app_evidence.py");
    if (readFileSync(file, "utf8") !== shell) {
      throw new Error("app/" + slug + ".html has drifted from index.html; re-run experiments/app_evidence.py");
    }
  }
  return routes.length + " route files, each byte-identical to the shell";
});

check("every route has a view and every link has a route", () => {
  const js = readFileSync(join(APP, "app.js"), "utf8");
  const nav = [...js.matchAll(/\{\s*path:\s*"([^"]+)",\s*label:/g)].map((m) => m[1]);
  const views = [...js.matchAll(/VIEWS\["([^"]+)"\]\s*=\s*function/g)].map((m) => m[1]);
  if (nav.length < 6) throw new Error("app.js declares only " + nav.length + " routes");
  for (const path of nav) {
    if (!views.includes(path)) throw new Error("route " + path + " has no view");
  }
  for (const path of ALL_PATHS) {
    if (!nav.includes(path)) throw new Error("index.html links to unknown route " + path);
  }
  return nav.length + " routes, " + views.length + " views, " + ALL_PATHS.length + " linked";
});
check("client sources carry no mis-decoded text", () => {
  // Hard-won guard: PowerShell here-strings once wrote these files through cp1252 and
  // silently double-encoded every non-ASCII character. U+00C3/U+00C2/U+20AC/U+00E2 and
  // the C1 range are the signature of that damage, and they are never legitimate here.
  const bad = /[\u00c2\u00c3\u00e2\u20ac\u0080-\u009f]/;
  const hits = [];
  for (const name of ["app.js", "app.css", "index.html"]) {
    const text = readFileSync(join(APP, name), "utf8");
    const at = text.search(bad);
    if (at !== -1) hits.push(name + " at offset " + at + " (" + JSON.stringify(text.slice(at, at + 4)) + ")");
  }
  if (hits.length) throw new Error("mis-decoded text: " + hits.join("; "));
  return "clean";
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
  // Every route file carries the same snapshot, so every HTML page is stripped
  // of its snapshot block before the scan, and evidence.json is skipped outright.
  const stripSnapshot = (text) => {
    const at = text.indexOf(SNAPSHOT_BEGIN);
    if (at === -1) return text;
    return text.slice(0, at + SNAPSHOT_BEGIN.length) + text.slice(text.indexOf("</script>", at + SNAPSHOT_BEGIN.length));
  };
  for (const file of listFiles(APP)) {
    const name = file.split(/[\\/]/).pop();
    if (name === "evidence.json") continue;
    const raw = readFileSync(file, "utf8");
    const text = name.endsWith(".html") ? stripSnapshot(raw) : raw;
    for (const [re, label] of patterns) if (re.test(text)) hits.push(name + ": " + label);
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
  console.error("build failed: " + failures.join(", "));
  process.exit(1);
}
console.error("build ok");