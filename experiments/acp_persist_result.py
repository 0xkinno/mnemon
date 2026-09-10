import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mnemon.memory import WitnessedMemory
from mnemon.arbiter import arbitrate

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / ".acp-memory.db"
PROOF = ROOT / "proof"
ENTITY = ("risk_verdict", "protocol_x")
JOB_ID = json.loads((PROOF / "acp_arbitration.json").read_text())["acp_job_id"]


def read_state():
    return arbitrate(WitnessedMemory(str(DB)), *ENTITY)


def persist():
    acp = json.loads((PROOF / "acp_arbitration.json").read_text())
    deliverable = acp["deliverable"]
    for field in ("decision", "winning_claim", "reason_code", "evidence_digest", "adjudicated_at"):
        if not isinstance(deliverable.get(field), str):
            raise SystemExit(f"ACP deliverable is missing string field {field!r}")
    before = read_state()
    if before["status"] != "CONTESTED":
        raise SystemExit(f"expected a CONTESTED pre-state, got {before['status']}")
    record = WitnessedMemory(str(DB)).witnessed_write(
        category=ENTITY[0], name=ENTITY[1], status=deliverable["winning_claim"],
        evidence={"source": "acp", "acp_job_id": acp["acp_job_id"],
                  "deliverable_digest": acp["deliverable_digest"],
                  "reason_code": deliverable["reason_code"],
                  "evidence_digest": deliverable["evidence_digest"],
                  "adjudicated_at": deliverable["adjudicated_at"],
                  "resolved_epoch": before["current"]["epoch_id"]},
        writer_id="acp-evaluator", epoch_id=f"acp-resolution-{acp['acp_job_id']}",
        operation_id=f"op-acp-resolution-{acp['acp_job_id']}")
    after = read_state()
    out = {"acp_job_id": acp["acp_job_id"], "pre_state": before["status"],
           "persisted": record, "post_state": after["status"], "pid": os.getpid()}
    (PROOF / "acp_cold_result.json").write_text(json.dumps(out, indent=2, sort_keys=True, default=str))
    print(json.dumps(out, indent=2, sort_keys=True, default=str))


def fresh_read():
    state = read_state()
    out = {"acp_job_id": JOB_ID, "fresh_pid": os.getpid(), "verdict": state}
    (PROOF / "acp_fresh_process.json").write_text(json.dumps(out, indent=2, sort_keys=True, default=str))
    print(json.dumps({"fresh_pid": os.getpid(), "verdict": state["status"],
                      "writer_id": state["current"]["writer_id"],
                      "evidence_source": state["current"]["evidence"]["source"]}, indent=2, sort_keys=True, default=str))


if __name__ == "__main__":
    fresh_read() if len(sys.argv) > 1 and sys.argv[1] == "read" else persist()