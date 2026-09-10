import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mnemon.memory import WitnessedMemory
from mnemon.arbiter import arbitrate

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / ".acp-memory.db"
PROOF = ROOT / "proof"


def main():
    PROOF.mkdir(exist_ok=True)
    if DB.exists():
        DB.unlink()
    epoch = "acp-epoch-contested"
    m = WitnessedMemory(str(DB))
    a = m.witnessed_write(category="risk_verdict", name="protocol_x", status="SAFE",
                          evidence={"source": "sibyl-race", "summary": "stable"},
                          writer_id="watcher-A", epoch_id=epoch, operation_id="op-acp-A")
    b = m.witnessed_write(category="risk_verdict", name="protocol_x", status="CRITICAL",
                          evidence={"source": "sibyl-race", "summary": "critical"},
                          writer_id="watcher-B", epoch_id=epoch, operation_id="op-acp-B")
    verdict = arbitrate(m, "risk_verdict", "protocol_x")
    if verdict["status"] != "CONTESTED":
        raise SystemExit(f"expected CONTESTED, got {verdict['status']}")
    requirement = {
        "entity_key": "risk_verdict/protocol_x",
        "epoch_id": epoch,
        "claim_a": a["status"],
        "claim_b": b["status"],
        "claim_hash_a": a["claim_hash"],
        "claim_hash_b": b["claim_hash"],
        "evidence_refs": [f"sibyl://cold/{a['operation_id']}#{a['writer_id']}",
                          f"sibyl://cold/{b['operation_id']}#{b['writer_id']}"],
    }
    (PROOF / "acp_requirement.json").write_text(json.dumps(requirement, indent=2, sort_keys=True))
    print(json.dumps({"db": str(DB), "epoch": epoch, "verdict": verdict["status"],
                      "warm_status": verdict["current"]["status"],
                      "claim_hash_a": a["claim_hash"], "claim_hash_b": b["claim_hash"],
                      "requirement": requirement}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()