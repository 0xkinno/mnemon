import json, os, signal, subprocess, sys, tempfile, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mnemon.memory import WitnessedMemory
from mnemon.arbiter import arbitrate

ROOT = Path(__file__).resolve().parents[1]

def writer(db, status, writer, epoch, op, crash=False):
    m = WitnessedMemory(db)
    r = m.prepare(category="risk_verdict", name="protocol_x", status=status,
                  evidence={"source": "base", "summary": status.lower()},
                  writer_id=writer, epoch_id=epoch, operation_id=op)
    m.write_warm(r)
    if crash: os._exit(17)
    m.commit(r)

def run():
    d = ROOT / ".runs" / uuid.uuid4().hex; d.mkdir(parents=True, exist_ok=True)
    try:
        db = str(Path(d) / "memory.db"); epoch = "epoch-demo"
        clean = WitnessedMemory(db).witnessed_write(category="risk_verdict", name="protocol_x", status="SAFE", evidence={"source":"base","summary":"stable"}, writer_id="control", epoch_id=epoch, operation_id="op-clean")
        clean_result = arbitrate(WitnessedMemory(db), "risk_verdict", "protocol_x")
        # Race: CRITICAL commits first, SAFE overwrites WARM later; both witnesses remain.
        p1 = subprocess.Popen([sys.executable, __file__, "write", db, "CRITICAL", "auditor-a", epoch, "op-a"])
        p1.wait(); p2 = subprocess.Popen([sys.executable, __file__, "write", db, "SAFE", "watcher-b", epoch, "op-b"]); p2.wait()
        race_result = arbitrate(WitnessedMemory(db), "risk_verdict", "protocol_x")
        crash_db = str(Path(d) / "crash.db")
        p3 = subprocess.Popen([sys.executable, __file__, "write", crash_db, "CRITICAL", "auditor-a", "epoch-crash", "op-crash", "crash"]); p3.wait()
        crash_result = arbitrate(WitnessedMemory(crash_db), "risk_verdict", "protocol_x")
        retry_db = str(Path(d) / "retry.db"); r = WitnessedMemory(retry_db).witnessed_write(category="risk_verdict", name="protocol_x", status="SAFE", evidence={"source":"base","summary":"stable"}, writer_id="retry", epoch_id="epoch-r", operation_id="op-r")
        WitnessedMemory(retry_db).witnessed_write(category="risk_verdict", name="protocol_x", status="SAFE", evidence={"source":"base","summary":"stable"}, writer_id="retry", epoch_id="epoch-r", operation_id="op-r")
        retry_result = arbitrate(WitnessedMemory(retry_db), "risk_verdict", "protocol_x")
        out = {"clean": clean_result, "race": race_result, "crash": crash_result, "retry": retry_result}
        Path("proof").mkdir(exist_ok=True)
        for key in ("race", "crash", "retry"):
            Path(f"proof/{key}_output.json").write_text(json.dumps(out[key], indent=2, sort_keys=True))
        Path("proof/fresh_process_output.json").write_text(json.dumps(out["race"], indent=2, sort_keys=True))
        return out
    finally:
        pass

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "write":
        writer(*sys.argv[2:])
    else:
        print(json.dumps(run(), indent=2, sort_keys=True))
