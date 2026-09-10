from pathlib import Path
import uuid
from mnemon.memory import WitnessedMemory
from mnemon.arbiter import arbitrate

def put(m, status="SAFE", writer="w", epoch="e", op="o"):
    return m.witnessed_write(category="risk_verdict", name="protocol_x", status=status, evidence={"source":"base","summary":status}, writer_id=writer, epoch_id=epoch, operation_id=op)

def db():
    p=Path(".testdata"); p.mkdir(exist_ok=True); return str(p/(uuid.uuid4().hex+".db"))
def test_clean():
    m=WitnessedMemory(db()); put(m); assert arbitrate(m,"risk_verdict","protocol_x")["status"] == "CLEAN"

def test_unwitnessed():
    m=WitnessedMemory(db()); r=m.prepare(category="risk_verdict",name="protocol_x",status="SAFE",evidence={"source":"base"},writer_id="w",epoch_id="e",operation_id="o"); m.write_warm(r); assert arbitrate(m,"risk_verdict","protocol_x")["status"] == "UNWITNESSED"

def test_contested():
    m=WitnessedMemory(db()); put(m,"CRITICAL","a","e","a"); put(m,"SAFE","b","e","b"); assert arbitrate(m,"risk_verdict","protocol_x")["status"] == "CONTESTED"

def test_deterministic_hash():
    m=WitnessedMemory(db()); a=put(m); b=put(m,op="o"); assert a["claim_hash"] == b["claim_hash"]

def test_delete_and_malformed_witness():
    m=WitnessedMemory(db()); put(m); m.delete("risk_verdict", "protocol_x"); assert arbitrate(m,"risk_verdict","protocol_x")["status"] == "UNWITNESSED"
