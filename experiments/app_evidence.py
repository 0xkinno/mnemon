"""Inject the verified run evidence into app/index.html and app/evidence.json.

The app is a static evidence surface with two runtime sources:

  1. the inlined snapshot built here, from proof/ artifacts only;
  2. scripts/demo_api.py, which drives the real mnemon engine against real
     Sibyl Memory for the interactive /demo page.

This script derives every value it writes from proof/. Nothing in it is typed by
hand: the panel rows, the proof index (re-hashed here), and the recorded demo run
are all computed from the artifacts that the experiment scripts produced.

scripts/build_check.mjs re-derives the same snapshot and fails the build if
app/ has drifted from proof/.
"""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "proof"
APP = ROOT / "app"
BEGIN = '<script type="application/json" id="evidence-snapshot">'
END = "</script>"


def read(name):
    return json.loads((PROOF / name).read_text())


def tone(*flags):
    """ok when every flag is truthy, block otherwise."""
    return "ok" if all(flags) else "block"


def proof_index():
    rows = []
    for path in sorted(PROOF.rglob("*")):
        if not path.is_file():
            continue
        data = path.read_bytes()
        rows.append({
            "name": path.relative_to(ROOT).as_posix(),
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
        })
    return rows
def evidence_panel():
    """The nine verified readouts the /demo and /evidence pages render."""
    source = read("source_verification.json")
    manifest = read("run_manifest.json")
    race = read("race_matrix.json")
    fresh = read("fresh_session.json")
    deletion = read("delete_memory.json")
    tamper = read("tamper.json")
    audit = read("final_integrity_audit.json")
    acp_job = read("acp_job_78185.json")
    base = read("base_transaction_verified.json")

    contested = sum(1 for t in race if t["mnemon"]["status"] == "CONTESTED")
    must_block = [c for c in audit["cases"] if c["must_block"]]
    held = [c for c in must_block if c["passed"]]

    return [
        {
            "label": "Sibyl version",
            "value": source["package"] + " " + source["version"],
            "detail": "WARM " + source["warm_schema"] + "; COLD " + source["cold_schema"],
            "artifact": "proof/source_verification.json",
            "tone": "ok",
        },
        {
            "label": "Experiment status",
            "value": manifest["test_result"],
            "detail": ("suite green on python " + manifest["python"] + "; "
                       + str(len(manifest["artifacts"])) + " artifacts hashed in proof/run_manifest.json"),
            "artifact": "proof/run_manifest.json",
            "tone": tone(manifest["test_passed"]),
        },
        {
            "label": "Race result",
            "value": str(contested) + "/" + str(len(race)) + " trials CONTESTED",
            "detail": "independent writers race the same entity and epoch; no trial silently settles on the last writer",
            "artifact": "proof/race_matrix.json",
            "tone": "warn",
        },
        {
            "label": "Fresh-process result",
            "value": fresh["verdict"]["status"] + " (pid " + str(fresh["pid"]) + ")",
            "detail": "a separate interpreter re-reads the same memory and returns the same verdict",
            "artifact": "proof/fresh_session.json",
            "tone": "warn",
        },
        {
            "label": "Deletion result",
            "value": deletion["verdict"]["status"] + " / " + deletion["action"],
            "detail": "removing the memory layer removes the ability to establish CLEAN (" + str(deletion["verdict"]["reason"]) + ")",
            "artifact": "proof/delete_memory.json",
            "tone": "block",
        },
        {
            "label": "Tamper result",
            "value": tamper["status"],
            "detail": "an altered claim is rejected before it can be acted on: " + str(tamper["reason"]),
            "artifact": "proof/tamper.json",
            "tone": "block",
        },
        {
            "label": "Integrity audit",
            "value": str(len(held)) + "/" + str(len(must_block)) + " must-block cases hold",
            "detail": (str(len(audit["cases"])) + " adversarial cases run against the real engine; audit_passed="
                       + str(audit["audit_passed"]).lower()),
            "artifact": "proof/final_integrity_audit.json",
            "tone": tone(audit["audit_passed"]),
        },
        {
            "label": "ACP job status",
            "value": acp_job["final_status"] + " (job " + str(acp_job["acp_job_id"]) + ")",
            "detail": ("Virtuals ACP on " + acp_job["network"] + "; rejected=" + str(acp_job["rejected"]).lower()
                       + "; evaluator, provider and buyer binding re-checked on chain"),
            "artifact": "proof/acp_job_78185.json",
            "tone": tone(acp_job["final_status"] == "COMPLETED", acp_job["rejected"] is False),
        },
        {
            "label": "Base transaction status",
            "value": "receipt status " + str(base["receipt_status"]) + " (block " + str(base["block_number"]) + ")",
            "detail": "claim hash decoded from the anchor event matches the witnessed claim: " + str(base["claim_hash_matches"]).lower(),
            "artifact": "proof/base_transaction_verified.json",
            "tone": tone(base["receipt_status"] == 1, base["claim_hash_matches"] is True),
        },
    ]
def witness(entry):
    """Project a real claim record down to the fields the demo instrument renders."""
    return {
        "status": entry["status"],
        "claim_hash": entry["claim_hash"],
        "writer_id": entry["writer_id"],
        "epoch_id": entry["epoch_id"],
        "operation_id": entry["operation_id"],
    }


def state(entry, status=None):
    out = witness(entry)
    if status is not None:
        out["status"] = status
    return out


def demo_recorded():
    """The recorded verified run: the same sequence the live instrument performs.

    Every step is sourced from an artifact. There are no invented transitions and
    no timestamps with absolute values.
    """
    chain = read("final_e2e_chain.json")
    race = read("race_output.json")
    fresh = read("fresh_session.json")
    deletion = read("delete_memory.json")
    control = read("final_deletion_control.json")
    final_fresh = read("final_fresh_session.json")

    resolved = chain["cold_witness"]
    clean_phase = control["phases"][0]
    cached = sum(1 for v in chain["link_checks"].values() if v)
    link_total = len(chain["link_checks"])

    steps = {
        "baseline": {
            "id": "baseline",
            "stage": "Observe",
            "label": "Known state",
            "title": "Start from a memory state MNEMON is willing to authorise.",
            "warm": state(resolved),
            "cold": [witness(resolved)],
            "verdict": chain["mnemon_final"]["verdict"],
            "action": chain["mnemon_final"]["action"],
            "note": ("WARM and COLD carry the same claim hash for the same entity and epoch, so the current value is "
                     "bound to its durable witness and nothing contradicts it. The adjudicated status is "
                     + resolved["status"] + "; what MNEMON certifies here is that the value is consistent and witnessed."),
            "artifact": "proof/final_e2e_chain.json",
        },
        "contention": {
            "id": "contention",
            "stage": "Reconcile",
            "label": "Contention",
            "title": "Two independent observers commit conflicting claims for one entity and epoch.",
            "warm": witness(race["warm"]),
            "cold": [witness(c) for c in race["cold"]],
            "verdict": race["mnemon"]["status"],
            "action": "BLOCKED",
            "note": ("WARM holds a single row while COLD keeps both witnesses. MNEMON sees two credentialed writers "
                     "disagree inside epoch " + race["warm"]["epoch_id"] + ", so the action is blocked instead of "
                     "silently settling on whichever write landed last."),
            "artifact": "proof/race_output.json",
        },
        "fresh": {
            "id": "fresh",
            "stage": "Reconcile",
            "label": "Fresh process",
            "title": "A separate interpreter re-reads the same memory and reaches the same verdict.",
            "warm": witness(fresh["verdict"]["current"]),
            "cold": [witness(c) for c in fresh["verdict"]["claims"]],
            "verdict": fresh["verdict"]["status"],
            "action": "BLOCKED",
            "note": ("Process " + str(fresh["pid"]) + " started with no cache or injected state and arrived at "
                     + fresh["verdict"]["status"] + " from persistence alone. The verdict is a property of the memory, "
                     "not of the process that happened to read it."),
            "artifact": "proof/fresh_session.json",
        },
        "delete": {
            "id": "delete",
            "stage": "Verdict",
            "label": "Memory removed",
            "title": "Delete the memory layer and the ability to establish CLEAN goes with it.",
            "warm": None,
            "cold": [],
            "verdict": deletion["verdict"]["status"],
            "action": deletion["action"],
            "note": ("memory_removed=" + str(deletion["memory_removed"]).lower() + "; the arbiter returns "
                     + str(deletion["verdict"]["reason"]) + ". The persisted ACP result and the Base anchor are still on "
                     "disk, and neither can substitute for the witness that lived in Sibyl Memory."),
            "artifact": "proof/delete_memory.json",
        },
        "restore": {
            "id": "restore",
            "stage": "Action",
            "label": "Memory restored",
            "title": "Restore the witness and the state is authorisable again.",
            "warm": state(resolved),
            "cold": [witness(resolved)],
            "verdict": clean_phase["verdict"],
            "action": clean_phase["action"],
            "note": ("The deletion control records phase " + clean_phase["phase"] + " with verdict "
                     + clean_phase["verdict"] + " and claim count " + str(clean_phase["claim_count"]) + " once the "
                     "witness is back. Recovery is a property of the memory layer, not of a cached decision."),
            "artifact": "proof/final_deletion_control.json",
        },
        "rerun": {
            "id": "rerun",
            "stage": "Action",
            "label": "Re-run",
            "title": "Re-run the flow end to end and the resolved state re-verifies.",
            "warm": state(resolved),
            "cold": [witness(resolved)],
            "verdict": chain["mnemon_final"]["verdict"],
            "action": chain["mnemon_final"]["action"],
            "note": (str(cached) + "/" + str(link_total) + " link checks pass on the re-run, and a brand new "
                     "interpreter (pid " + str(final_fresh["child"]["pid"]) + ") reconstructs the same verdict from "
                     "persistence. The ACP deliverable and the Base anchor both bind the identical claim hash."),
            "artifact": "proof/final_e2e_chain.json",
        },
    }

    return {
        "label": "Recorded verified run",
        "entity_key": chain["entity_key"],
        "sequence": ["baseline", "contention", "fresh", "delete", "restore", "rerun"],
        "steps": steps,
        "controls": [
            {"action": "contention", "label": "Run contention proof", "step": "contention"},
            {"action": "fresh-session", "label": "Fresh-session verification", "step": "fresh"},
            {"action": "delete-memory", "label": "Delete memory", "step": "delete"},
            {"action": "restore-memory", "label": "Restore memory", "step": "restore"},
            {"action": "rerun-flow", "label": "Re-run full flow", "step": "rerun"},
        ],
    }
def contract_explorer(base):
    """Derive the address page from the verified transaction's explorer URL."""
    return base["explorer"].split("/tx/")[0] + "/address/" + base["contract_address"]


def snapshot():
    chain = read("final_e2e_chain.json")
    control = read("final_deletion_control.json")
    source = read("source_verification.json")
    deletion = {
        "phases": control["phases"],
        "substitutes_present_but_insufficient": control["substitutes_present_but_insufficient"],
        "deletion_control_verified": control["deletion_control_verified"],
    }
    acp = chain["acp"]
    witness_record = chain["cold_witness"]
    base = chain["base_commitment"]
    return {
        "generated_at": chain["generated_at"],
        "source": "proof/final_e2e_chain.json",
        "linkage_verified": chain["linkage_verified"],
        "acp_job_id": chain["job_id"],
        "entity_key": chain["entity_key"],
        "epoch_id": chain["epoch_id"],
        "sibyl_version": source["version"],
        "contract_explorer": contract_explorer(base),
        "acp": {
            "job_id": acp["job_id"],
            "offering": acp["offering"],
            "final_onchain_status": acp["final_onchain_status"],
            "deliverable": acp["deliverable"],
            "deliverable_digest": acp["deliverable_digest"],
            "deliverable_keccak256": acp["deliverable_keccak256"],
            "onchain_submitted_hash": acp["onchain_submitted_hash"],
        },
        "cold_witness": {
            "operation_id": witness_record["operation_id"],
            "epoch_id": witness_record["epoch_id"],
            "writer_id": witness_record["writer_id"],
            "claim_hash": witness_record["claim_hash"],
            "status": witness_record["status"],
        },
        "base_commitment": {
            "network": base["network"],
            "chain_id": base["chain_id"],
            "contract_address": base["contract_address"],
            "tx_hash": base["tx_hash"],
            "block_number": base["block_number"],
            "explorer": base["explorer"],
        },
        "verdict": {"status": chain["mnemon_final"]["verdict"], "action": chain["mnemon_final"]["action"]},
        "deletion_control": deletion,
        "evidence_panel": evidence_panel(),
        "proof_index": proof_index(),
        "demo": {"recorded": demo_recorded()},
    }


# The host serves these from the output directory as /product, /demo, and so on
# (cleanUrls maps /demo -> demo.html). Each one is a byte-identical copy of the
# shell, because the router reads location.pathname to pick a view. Real files
# beat a catch-all rewrite: nothing is shadowed and no asset can be swallowed.
ROUTES = {
    "product": "/product",
    "demo": "/demo",
    "evidence": "/evidence",
    "architecture": "/architecture",
    "docs": "/docs",
}


def main():
    snap = snapshot()
    raw = json.dumps(snap, separators=(",", ":"))
    (APP / "evidence.json").write_text(json.dumps(snap, indent=2) + "\n", newline="\n")

    page = (APP / "index.html").read_text()
    start = page.index(BEGIN) + len(BEGIN)
    end = page.index(END, start)
    shell = page[:start] + raw + page[end:]
    (APP / "index.html").write_text(shell, newline="\n")
    for slug in ROUTES:
        (APP / (slug + ".html")).write_text(shell, newline="\n")
    print(json.dumps({
        "evidence_json": "app/evidence.json",
        "index_html": "app/index.html",
        "bytes": len(raw),
        "acp_job_id": snap["acp_job_id"],
        "verdict": snap["verdict"]["status"],
        "base_tx": snap["base_commitment"]["tx_hash"],
        "evidence_rows": len(snap["evidence_panel"]),
        "proof_files": len(snap["proof_index"]),
        "demo_steps": len(snap["demo"]["recorded"]["steps"]),
        "route_files": sorted(slug + ".html" for slug in ROUTES),
    }, indent=2))


if __name__ == "__main__":
    main()