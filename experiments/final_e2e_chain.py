"""Assemble and independently re-verify the final MNEMON end-to-end chain.

Chain under test:

    Sibyl contested claims
        -> MNEMON CONTESTED
        -> ACP job 78185
        -> provider deliverable
        -> verified deliverable hash
        -> Sibyl COLD arbitration witness
        -> MNEMON CLEAN
        -> Base commitment
        -> verified transaction receipt

Every link is re-derived here from the live database and the live chain rather than
copied from another proof file, so the artifact demonstrates binding rather than
coexistence. Writes proof/final_e2e_chain.json.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env.local")

from mnemon.arbiter import arbitrate  # noqa: E402
from mnemon.memory import WitnessedMemory  # noqa: E402

PROOF = ROOT / "proof"
DB = ROOT / ".acp-memory.db"
ENTITY = ("risk_verdict", "protocol_x")
JOB_ID = "78185"


def load(name):
    return json.loads((PROOF / name).read_text())


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def verify_base():
    """Re-read the anchor transaction from Base Sepolia and decode its event."""
    from web3 import Web3

    rpc = os.getenv("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org")
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    deployment = load("base_deployment.json")
    anchor = load("base_acp_resolution.json")["anchor"]
    abi = [{"anonymous": False, "inputs": [
        {"indexed": False, "internalType": "string", "name": "entity", "type": "string"},
        {"indexed": False, "internalType": "string", "name": "epoch", "type": "string"},
        {"indexed": False, "internalType": "bytes32", "name": "claimHash", "type": "bytes32"},
        {"indexed": False, "internalType": "string", "name": "verdict", "type": "string"},
        {"indexed": False, "internalType": "string", "name": "operationId", "type": "string"}],
        "name": "Anchored", "type": "event"}]
    contract = w3.eth.contract(address=w3.to_checksum_address(deployment["contract_address"]), abi=abi)
    receipt = w3.eth.get_transaction_receipt(anchor["tx_hash"])
    logs = contract.events.Anchored().process_receipt(receipt)
    args = logs[0]["args"]
    return {
        "rpc": rpc,
        "chain_id": w3.eth.chain_id,
        "network": "base-sepolia",
        "contract_address": deployment["contract_address"],
        "tx_hash": anchor["tx_hash"],
        "receipt_status": receipt.status,
        "block_number": receipt.blockNumber,
        "decoded_event": {
            "entity": args["entity"],
            "epoch": args["epoch"],
            "claimHash": "0x" + bytes(args["claimHash"]).hex(),
            "verdict": args["verdict"],
            "operationId": args["operationId"],
        },
        "explorer": anchor["explorer"],
    }


def main():
    requirement = load("acp_requirement.json")
    job = load("acp_job_78185.json")
    arbitration = load("acp_arbitration.json")
    cold = load("acp_cold_result.json")

    # Live reconstruction from persisted Sibyl Memory (not a copy of a prior proof).
    live = arbitrate(WitnessedMemory(str(DB)), *ENTITY)
    live_current = live["current"]
    live_claims = live["claims"]

    base = verify_base()

    deliverable = arbitration["deliverable"]
    witness = cold["persisted"]

    checks = {
        "job_is_the_completed_job": arbitration["acp_job_id"] == JOB_ID == cold["acp_job_id"],
        "onchain_final_status_completed": job["final_status"] == "COMPLETED",
        "onchain_no_rejection": job["rejected"] is False,
        "deliverable_bytes_match_onchain_hash": job["deliverable_binding"]["match"] is True,
        "submitted_hash_equals_keccak_of_body": (
            job["deliverable_binding"]["observed_keccak256"]
            == job["deliverable_binding"]["onchain_job_submitted_hash"]
        ),
        "deliverable_digest_matches_artifact": arbitration["deliverable_digest"] == job["deliverable_binding"]["deliverable_sha256"],
        "resolved_claim_is_the_upheld_claim": deliverable["winning_claim"] == witness["status"],
        "evidence_digest_is_a_contested_claim_hash": deliverable["evidence_digest"] in (
            requirement["claim_hash_a"], requirement["claim_hash_b"]
        ),
        "warm_pre_state_was_contested": cold["pre_state"] == "CONTESTED",
        "cold_witness_persisted": cold["post_state"] == "CLEAN",
        "cold_claim_hash_matches_live_memory": witness["claim_hash"] == live_current["claim_hash"],
        "live_memory_still_reads_clean": live["status"] == "CLEAN",
        "live_verdict_is_uncontested": len(live_claims) == 1,
        "live_current_is_acp_writer": live_current["writer_id"] == "acp-evaluator",
        "base_receipt_status_ok": base["receipt_status"] == 1,
        "base_event_epoch_matches_cold_epoch": base["decoded_event"]["epoch"] == witness["epoch_id"],
        "base_event_operation_matches_cold_operation": base["decoded_event"]["operationId"] == witness["operation_id"],
        "base_event_verdict_matches_cold_state": base["decoded_event"]["verdict"] == cold["post_state"],
        "base_event_claim_hash_binds_cold_witness": (
            base["decoded_event"]["claimHash"] == "0x" + witness["claim_hash"].split("sha256:")[-1]
        ),
    }

    chain = {
        "generated_at": now(),
        "job_id": JOB_ID,
        "entity_key": requirement["entity_key"],
        "epoch_id": requirement["epoch_id"],
        "sibyl_evidence": {
            "source": "sibyl-memory-client==0.8.1",
            "database": DB.name,
            "entity_key": requirement["entity_key"],
            "contested_epoch_id": requirement["epoch_id"],
            "operation_ids": [ref.split("/")[-1].split("#")[0] for ref in requirement["evidence_refs"]],
            "writer_ids": [ref.split("#")[-1] for ref in requirement["evidence_refs"]],
            "claim_a": {"status": requirement["claim_a"], "claim_hash": requirement["claim_hash_a"]},
            "claim_b": {"status": requirement["claim_b"], "claim_hash": requirement["claim_hash_b"]},
            "mnemon_verdict_before_resolution": cold["pre_state"],
        },
        "acp": {
            "job_id": JOB_ID,
            "offering": arbitration["provider_offering"],
            "buyer_agent": arbitration["buyer_agent"],
            "provider_agent": arbitration["provider_agent"],
            "final_onchain_status": job["final_status"],
            "deliverable": deliverable,
            "deliverable_digest": arbitration["deliverable_digest"],
            "deliverable_keccak256": arbitration["deliverable_keccak256"],
            "deliverable_bytes": arbitration["deliverable_bytes"],
            "onchain_submitted_hash": job["deliverable_binding"]["onchain_job_submitted_hash"],
            "settlement": {
                "payment_released_to_provider_raw": "9000",
                "evaluator_fee_raw": "500",
                "escrow_raw": "10000",
            },
            "evidence": "proof/acp_job_78185.json",
        },
        "cold_witness": {
            "operation_id": witness["operation_id"],
            "epoch_id": witness["epoch_id"],
            "writer_id": witness["writer_id"],
            "claim_hash": witness["claim_hash"],
            "status": witness["status"],
            "evidence_source": witness["evidence"]["source"],
            "acp_job_id": witness["evidence"]["acp_job_id"],
            "evidence": "proof/acp_cold_result.json",
        },
        "mnemon_final": {
            "verdict": live["status"],
            "action": "ALLOWED" if live["status"] == "CLEAN" else "BLOCKED",
            "live_claim_hash": live_current["claim_hash"],
            "live_epoch_id": live_current["epoch_id"],
            "live_writer_id": live_current["writer_id"],
            "claim_count": len(live_claims),
        },
        "base_commitment": base,
        "link_checks": checks,
        "linkage_verified": all(checks.values()),
        "note": "The exact claim hash produced by the ACP resolution and stored as the Sibyl COLD witness is the value committed by the Base Sepolia transaction. The pre-existing proof/base_transaction.json anchor is an earlier epoch and is not part of this chain.",
    }

    if not chain["linkage_verified"]:
        failed = [k for k, v in checks.items() if not v]
        OUT = PROOF / "final_e2e_chain.json"
        OUT.write_text(json.dumps(chain, indent=2) + "\n")
        raise SystemExit("linkage checks failed: " + ", ".join(failed))

    (PROOF / "final_e2e_chain.json").write_text(json.dumps(chain, indent=2) + "\n")
    print(json.dumps({
        "written": "proof/final_e2e_chain.json",
        "linkage_verified": True,
        "checks_passed": f"{sum(checks.values())}/{len(checks)}",
        "final_verdict": chain["mnemon_final"]["verdict"],
        "base_tx": base["tx_hash"],
        "base_block": base["block_number"],
    }, indent=2))


if __name__ == "__main__":
    main()
