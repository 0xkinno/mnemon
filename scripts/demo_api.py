"""Local instrument API for the interactive /demo page.

    python scripts/demo_api.py [--port 8080]

This serves app/ as a static site and exposes the real engine over HTTP:

    GET  /api/status    -> {live, engine, sequence, steps}
    POST /api/run       -> {ok, step, elapsed_ms} for one of the verified actions
    GET  /api/evidence  -> the artifact-derived evidence panel

There is no simulated engine here. Every value the demo page shows while the
instrument is running is produced by mnemon.arbiter.arbitrate() over a real
sibyl-memory-client database, exactly as the experiment scripts do it.

Run it with an interpreter that has sibyl_memory_client installed:

    .realvenv/Scripts/python.exe scripts/demo_api.py

Without this process the /demo page falls back to the recorded verified run in
app/evidence.json and says so on screen.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mnemon.arbiter import arbitrate  # noqa: E402
from mnemon.memory import WitnessedMemory  # noqa: E402

APP = ROOT / "app"
DB = ROOT / ".demo-memory.db"
CATEGORY = "risk_verdict"
NAME = "protocol_x"
BASELINE_EPOCH = "demo-epoch-1"
RESOLVED_EPOCH = "demo-epoch-2"
SEVERITY = {"SAFE": 1, "CRITICAL": 2}
STUB = {
    "contention": ("Reconcile", "Contention"),
    "fresh": ("Reconcile", "Fresh process"),
    "delete": ("Verdict", "Memory removed"),
    "restore": ("Action", "Memory restored"),
    "rerun": ("Action", "Re-run"),
}
CONTROL_STEP = {
    "contention": "contention",
    "fresh-session": "fresh",
    "delete-memory": "delete",
    "restore-memory": "restore",
    "rerun-flow": "rerun",
    "reset": "baseline",
}
SEQUENCE = ["baseline", "contention", "fresh", "delete", "restore", "rerun"]
SOURCE = "live: mnemon.arbiter over sibyl-memory-client"
CHILD = (
    "import json, os, sys;"
    "sys.path.insert(0, " + repr(str(ROOT)) + ");"
    "from mnemon.memory import WitnessedMemory;"
    "from mnemon.arbiter import arbitrate;"
    "print(json.dumps({'pid': os.getpid(), 'verdict': arbitrate(WitnessedMemory("
    + repr(str(DB)) + "), " + repr(CATEGORY) + ", " + repr(NAME) + ")}))"
)


def project(claim):
    return {
        "status": claim.get("status"),
        "claim_hash": claim.get("claim_hash"),
        "writer_id": claim.get("writer_id"),
        "epoch_id": claim.get("epoch_id"),
        "operation_id": claim.get("operation_id"),
    }


def severity(claim):
    return SEVERITY.get(claim.get("status"), 0)


class Instrument:
    """The real engine behind the demo page."""

    def __init__(self):
        self.db = DB
        self.memory = None
        self.done = []
        self.reset()

    def reset(self):
        # Drop the file and any WAL sidecar. If the memory file is held open by
        # another instrument we refuse to start rather than silently presenting a
        # dirty database as the demo's known starting state.
        for path in (DB, Path(str(DB) + "-wal"), Path(str(DB) + "-shm")):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except OSError as err:
                raise RuntimeError(
                    "cannot clear " + path.name + " (" + str(err) + "); another "
                    "demo_api.py instance is probably serving the same memory file"
                ) from err
        self.memory = WitnessedMemory(str(self.db))
        self.memory.witnessed_write(
            category=CATEGORY, name=NAME, status="SAFE",
            evidence={"source": "demo-instrument", "strength": "weak"},
            writer_id="watcher-A", epoch_id=BASELINE_EPOCH, operation_id="op-demo-A")
        self.done = ["baseline"]
        return self.read()

    def read(self):
        return arbitrate(self.memory, CATEGORY, NAME)

    def step(self, sid, stage, label, title, result, note):
        warm = result.get("current")
        return {
            "id": sid,
            "stage": stage,
            "label": label,
            "title": title,
            "warm": project(warm) if warm else None,
            "cold": [project(c) for c in result.get("claims", [])],
            "verdict": result["status"],
            "action": "ALLOWED" if result["status"] == "CLEAN" else "BLOCKED",
            "note": note,
            "artifact": SOURCE,
        }

    def baseline_step(self):
        result = self.read()
        return self.step(
            "baseline", "Observe", "Known state",
            "Start from a memory state MNEMON is willing to authorise.",
            result,
            "WARM is bound to " + str(len(result.get("claims", []))) + " durable witness(es) in epoch "
            + BASELINE_EPOCH + ", so MNEMON returns " + result["status"] + ".")

    def status(self):
        steps = [self.baseline_step()]
        for sid in SEQUENCE[1:]:
            stage, label = STUB[sid]
            steps.append({"id": sid, "stage": stage, "label": label})
        return {"live": True, "engine": SOURCE, "sequence": list(SEQUENCE), "steps": steps}
    def run(self, action):
        if action not in CONTROL_STEP:
            return {"ok": False, "error": "unknown action: " + str(action)}
        if action == "reset":
            started = time.time()
            self.reset()
            return {"ok": True, "step": self.baseline_step(), "elapsed_ms": int((time.time() - started) * 1000)}
        sid = CONTROL_STEP[action]
        previous = SEQUENCE[SEQUENCE.index(sid) - 1]
        if previous not in self.done:
            return {"ok": False, "error": "step '" + previous + "' must complete before '" + sid + "'"}
        started = time.time()
        try:
            step = getattr(self, "do_" + sid)()
        except Exception as err:  # surfaced to the page, never swallowed
            return {"ok": False, "error": str(err)}
        return {"ok": True, "step": step, "elapsed_ms": int((time.time() - started) * 1000)}

    def do_contention(self):
        self.memory.witnessed_write(
            category=CATEGORY, name=NAME, status="CRITICAL",
            evidence={"source": "demo-instrument", "strength": "strong"},
            writer_id="watcher-B", epoch_id=BASELINE_EPOCH, operation_id="op-demo-B")
        result = self.read()
        self.done.append("contention")
        return self.step(
            "contention", "Reconcile", "Contention",
            "A second independent observer commits a conflicting claim for the same entity and epoch.",
            result,
            "WARM holds a single row while COLD kept both witnesses, so MNEMON reports "
            + result["status"] + " instead of silently settling on whichever write landed last.")

    def do_fresh(self):
        child = subprocess.run([sys.executable, "-c", CHILD], capture_output=True, text=True, cwd=str(ROOT))
        if child.returncode != 0:
            raise RuntimeError((child.stderr or child.stdout).strip() or "child process failed")
        payload = json.loads(child.stdout.strip().splitlines()[-1])
        result = payload["verdict"]
        self.done.append("fresh")
        return self.step(
            "fresh", "Reconcile", "Fresh process",
            "A separate interpreter with no shared state re-reads the same memory.",
            result,
            "Process " + str(payload["pid"]) + " started with no cache or injected state and returned "
            + result["status"] + " from persistence alone.")

    def do_delete(self):
        self.memory.delete(CATEGORY, NAME)
        result = self.read()
        self.done.append("delete")
        return self.step(
            "delete", "Verdict", "Memory removed",
            "Delete the entity from Sibyl Memory and CLEAN is no longer reachable.",
            result,
            "The entity row is gone, so the arbiter returns " + str(result.get("reason", result["status"]))
            + ". The COLD journal, any persisted ACP result, and the Base anchor all remain on disk "
            + "and none of them can substitute for the missing witness.")

    def do_restore(self):
        witnesses = [w for w in self.memory.witnesses(CATEGORY, NAME) if w.get("epoch_id") == BASELINE_EPOCH]
        if not witnesses:
            raise RuntimeError("no witness remains to restore from")
        winning = max(witnesses, key=severity)
        self.memory.witnessed_write(
            category=CATEGORY, name=NAME, status=winning["status"], evidence=winning["evidence"],
            writer_id="demo-resolver", epoch_id=RESOLVED_EPOCH, operation_id="op-demo-resolved")
        result = self.read()
        self.done.append("restore")
        return self.step(
            "restore", "Action", "Memory restored",
            "Re-commit the winning witness in a new epoch and the state is authorisable again.",
            result,
            "Restored from the " + str(winning.get("writer_id")) + " witness (" + str(winning.get("status"))
            + ") into epoch " + RESOLVED_EPOCH + "; MNEMON returns " + result["status"] + " with "
            + str(len(result.get("claims", []))) + " claim(s).")

    def do_rerun(self):
        result = self.read()
        self.done.append("rerun")
        return self.step(
            "rerun", "Action", "Re-run",
            "Re-read the resolved state and the verdict holds.",
            result,
            "A repeat read of the same memory returns " + result["status"] + " with "
            + str(len(result.get("claims", []))) + " claim(s); nothing is cached between calls.")
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def log_message(self, *args):
        pass

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/status":
            return self.send_json(INSTRUMENT.status())
        if path == "/api/evidence":
            return self.send_json(json.loads((APP / "evidence.json").read_text()))
        if path.startswith("/api/"):
            return self.send_json({"ok": False, "error": "unknown endpoint"}, 404)
        leaf = path.rstrip("/").rsplit("/", 1)[-1]
        if path != "/" and "." not in leaf:
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/run":
            return self.send_json({"ok": False, "error": "unknown endpoint"}, 404)
        length = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError as err:
            return self.send_json({"ok": False, "error": "invalid JSON body: " + str(err)}, 400)
        result = INSTRUMENT.run(body.get("action"))
        return self.send_json(result, 200 if result.get("ok") else 409)


INSTRUMENT = Instrument()


def main():
    parser = argparse.ArgumentParser(description="MNEMON demo instrument")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MNEMON_DEMO_PORT", "8080")))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(json.dumps({
        "surface": "http://" + args.host + ":" + str(args.port) + "/",
        "demo": "http://" + args.host + ":" + str(args.port) + "/demo",
        "memory": str(DB.relative_to(ROOT)),
        "engine": SOURCE,
        "sequence": SEQUENCE,
    }, indent=2), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()