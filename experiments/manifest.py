"""Write proof/run_manifest.json: the hashed inventory of every proof artifact.

Run this last. It records the artifact hashes, the exact test command and result,
and the Base anchors that the submission claims.
"""
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "proof"
FILES = sorted(p for p in PROOF.glob("*.json") if p.name != "run_manifest.json")

def git_commit():
    try:
        proc = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
        return proc.stdout.strip() if proc.returncode == 0 else "unavailable"
    except (OSError, FileNotFoundError):
        return "unavailable"


manifest = {
    "git_commit": git_commit(),
    "sibyl_package_version": "0.8.1",
    "python": platform.python_version(),
    "os": platform.platform(),
    "commands": [
        "python -m pytest -q",
        "python experiments/real_sibyl_race.py",
        "python experiments/proofs.py",
        "python experiments/benchmark.py",
        "python experiments/final_e2e_chain.py",
        "python experiments/final_controls.py",
        "python experiments/app_evidence.py",
        "npm run build",
    ],
    "artifacts": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in FILES},
}

base = PROOF / "base_transaction_verified.json"
if base.exists():
    verified = json.loads(base.read_text())
    manifest.update({
        "base_chain_id": verified["chain_id"],
        "base_contract": verified["contract_address"],
        "base_transaction": verified["tx_hash"],
    })

anchor = PROOF / "base_acp_resolution.json"
if anchor.exists():
    resolution = json.loads(anchor.read_text())
    manifest.update({
        "base_transaction_acp_resolution": resolution["anchor"]["tx_hash"],
        "base_block_acp_resolution": resolution["anchor"]["block_number"],
        "acp_result_linkage_verified": resolution["claim_hash_bound"],
    })

test = subprocess.run(
    [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"],
    cwd=ROOT, capture_output=True, text=True,
)
summary = [line for line in test.stdout.strip().splitlines() if line.strip()]
manifest["test_command"] = "python -m pytest -q -p no:cacheprovider"
manifest["test_result"] = summary[-1] if summary else "no output"
manifest["test_passed"] = test.returncode == 0

(PROOF / "run_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", newline="\n")
print(json.dumps(manifest, indent=2, sort_keys=True))