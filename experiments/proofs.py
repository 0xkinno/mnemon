import json, os, sys, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mnemon.memory import WitnessedMemory
from mnemon.arbiter import arbitrate

ROOT=Path(__file__).resolve().parents[1]; proof=ROOT/"proof"; proof.mkdir(exist_ok=True)
db=ROOT/".proof-memory.db"
m=WitnessedMemory(str(db)); m.witnessed_write(category="risk_verdict",name="protocol_x",status="SAFE",evidence={"source":"proof"},writer_id="A",epoch_id="proof-epoch",operation_id="proof-a"); m.witnessed_write(category="risk_verdict",name="protocol_x",status="CRITICAL",evidence={"source":"proof"},writer_id="B",epoch_id="proof-epoch",operation_id="proof-b")
fresh=arbitrate(WitnessedMemory(str(db)),"risk_verdict","protocol_x")
(proof/"fresh_session.json").write_text(json.dumps({"session_id":str(uuid.uuid4()),"pid":os.getpid(),"verdict":fresh},indent=2,sort_keys=True))
missing=arbitrate(WitnessedMemory(str(ROOT/".missing-memory.db")),"risk_verdict","protocol_x")
(proof/"delete_memory.json").write_text(json.dumps({"memory_removed":True,"verdict":missing,"action":"BLOCKED"},indent=2,sort_keys=True))
replay1=arbitrate(WitnessedMemory(str(db)),"risk_verdict","protocol_x"); replay2=arbitrate(WitnessedMemory(str(db)),"risk_verdict","protocol_x")
(proof/"replay.json").write_text(json.dumps({"identical":replay1==replay2,"first":replay1,"second":replay2},indent=2,sort_keys=True))
tampered=WitnessedMemory(str(db)); warm=tampered.current("risk_verdict","protocol_x"); warm["claim_hash"]="sha256:tampered"; tampered.client.set_entity("risk_verdict","protocol_x",warm)
(proof/"tamper.json").write_text(json.dumps(arbitrate(tampered,"risk_verdict","protocol_x"),indent=2,sort_keys=True))
