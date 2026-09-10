"""Inject the verified run evidence into app/index.html and app/evidence.json.

The app is a static evidence surface, not a live control panel. The values it renders
must therefore be exactly the values in proof/. This script reads
proof/final_e2e_chain.json (itself re-derived from the live database and the live
Base Sepolia receipt) and writes the snapshot into the page.

scripts/build_check.mjs re-derives the same snapshot and fails the build if the page
has drifted from the proof artifacts.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "proof"
APP = ROOT / "app"
BEGIN = '<script type="application/json" id="evidence-snapshot">'
END = "</script>"


def snapshot():
    chain = json.loads((PROOF / "final_e2e_chain.json").read_text())
    control = json.loads((PROOF / "final_deletion_control.json").read_text())
    deletion = {
        "phases": control["phases"],
        "substitutes_present_but_insufficient": control["substitutes_present_but_insufficient"],
        "deletion_control_verified": control["deletion_control_verified"],
    }
    acp = chain["acp"]
    witness = chain["cold_witness"]
    base = chain["base_commitment"]
    return {
        "generated_at": chain["generated_at"],
        "source": "proof/final_e2e_chain.json",
        "linkage_verified": chain["linkage_verified"],
        "acp_job_id": chain["job_id"],
        "entity_key": chain["entity_key"],
        "epoch_id": chain["epoch_id"],
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
            "operation_id": witness["operation_id"],
            "epoch_id": witness["epoch_id"],
            "writer_id": witness["writer_id"],
            "claim_hash": witness["claim_hash"],
            "status": witness["status"],
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
    }


def main():
    snap = snapshot()
    raw = json.dumps(snap, separators=(",", ":"))
    (APP / "evidence.json").write_text(json.dumps(snap, indent=2) + "\n", newline="\n")

    page = (APP / "index.html").read_text()
    start = page.index(BEGIN) + len(BEGIN)
    end = page.index(END, start)
    (APP / "index.html").write_text(page[:start] + raw + page[end:], newline="\n")
    print(json.dumps({
        "evidence_json": "app/evidence.json",
        "index_html": "app/index.html",
        "bytes": len(raw),
        "acp_job_id": snap["acp_job_id"],
        "verdict": snap["verdict"]["status"],
        "base_tx": snap["base_commitment"]["tx_hash"],
    }, indent=2))


if __name__ == "__main__":
    main()
