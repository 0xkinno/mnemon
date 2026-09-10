import json, os, subprocess, sys, time, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mnemon.memory import WitnessedMemory
from mnemon.arbiter import arbitrate

def child(db, status, watcher, epoch, start_file):
    m=WitnessedMemory(db); started=time.time_ns(); Path(start_file).write_text(str(started))
    rec=m.prepare(category="risk_verdict", name="protocol_x", status=status, evidence={"source":"real-sibyl-race","strength":"strong" if status=="CRITICAL" else "weak"}, writer_id=watcher, epoch_id=epoch, operation_id=f"op-{watcher}-{epoch}")
    warm_start=time.time_ns(); m.write_warm(rec); warm_end=time.time_ns(); m.commit(rec); committed=time.time_ns()
    print(json.dumps({"pid":os.getpid(),"watcher_id":watcher,"status":status,"started_ns":started,"warm_ns":warm_end-warm_start,"committed_ns":committed-warm_end}))

def trial(root, i):
    db=str(root/f"trial-{i}.db"); epoch=f"epoch-{i}"; a=root/f"a-{i}"; b=root/f"b-{i}"
    pa=subprocess.Popen([sys.executable,__file__,"child",db,"SAFE","watcher-A",epoch,str(a)],stdout=subprocess.PIPE,text=True)
    pb=subprocess.Popen([sys.executable,__file__,"child",db,"CRITICAL","watcher-B",epoch,str(b)],stdout=subprocess.PIPE,text=True)
    oa=pa.communicate()[0].strip(); ob=pb.communicate()[0].strip(); mem=WitnessedMemory(db); warm=mem.current("risk_verdict","protocol_x"); events=mem.witnesses("risk_verdict","protocol_x")
    return {"trial":i,"processes":[json.loads(x) for x in (oa,ob)],"warm":warm,"cold":events,"mnemon":arbitrate(mem,"risk_verdict","protocol_x"),"exceptions":pa.returncode != 0 or pb.returncode != 0}

if __name__=="__main__":
    if len(sys.argv)>1 and sys.argv[1]=="child": child(*sys.argv[2:]); raise SystemExit
    root=Path(__file__).resolve().parents[1]/".real-races"; root.mkdir(exist_ok=True)
    results=[trial(root,i) for i in range(20)]; Path("proof/race_matrix.json").write_text(json.dumps(results,indent=2,sort_keys=True)); Path("proof/race_output.json").write_text(json.dumps(results[0],indent=2,sort_keys=True)); print(json.dumps({"trials":20,"exceptions":sum(r["exceptions"] for r in results),"contested":sum(r["mnemon"]["status"]=="CONTESTED" for r in results)},indent=2))
