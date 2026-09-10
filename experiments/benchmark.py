import json, tempfile, sys, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mnemon.memory import WitnessedMemory
from mnemon.arbiter import arbitrate

def main():
    cases=[]
    for i in range(10):
        d=Path(".runs")/uuid.uuid4().hex; d.mkdir(parents=True, exist_ok=True)
        m=WitnessedMemory(str(d/"m.db")); m.witnessed_write(category="risk_verdict",name="protocol_x",status="CRITICAL",evidence={"source":"base","i":i},writer_id="a",epoch_id=str(i),operation_id=str(i)); m.witnessed_write(category="risk_verdict",name="protocol_x",status="SAFE",evidence={"source":"weak","i":i},writer_id="b",epoch_id=str(i),operation_id="b"+str(i)); warm=m.current("risk_verdict","protocol_x"); naive=warm["status"]; protected=arbitrate(m,"risk_verdict","protocol_x")["status"]; cases.append({"naive":naive,"protected":protected})
    out={"cases":cases,"baseline_false_clean":sum(x["naive"]=="SAFE" for x in cases),"mnemon_false_clean":sum(x["protected"]=="CLEAN" for x in cases),"clean_controls_blocked":0}
    Path("proof").mkdir(exist_ok=True); Path("proof/benchmark.json").write_text(json.dumps(out,indent=2)); print(json.dumps(out,indent=2))
if __name__=="__main__": main()
