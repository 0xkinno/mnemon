"""Minimum Base commitment that binds the ACP-resolved MNEMON claim to chain.

The existing Base Sepolia anchor (proof/base_transaction.json) commits an earlier
`epoch-clean` claim, so it does not bind the ACP resolution. Close-out requires the
linkage `ACP result -> COLD witness -> MNEMON CLEAN -> Base commitment` to be real,
so this script anchors the *resolved* claim hash from proof/acp_cold_result.json.

It deliberately does not touch proof/base_transaction.json or
proof/base_transaction_verified.json: those remain the record of the earlier anchor.

usage:
  python experiments/final_base_link.py            # anchor (or re-verify if already done)
  python experiments/final_base_link.py --verify   # verify only, never sends a transaction
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
load_dotenv(ROOT / ".env.local")

from base_anchor import ABI, require_wallet  # noqa: E402

RPC = os.getenv("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org")
W3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
PROOF = ROOT / "proof"
OUT = PROOF / "base_acp_resolution.json"


def resolution():
    cold = json.loads((PROOF / "acp_cold_result.json").read_text())
    record = cold["persisted"]
    digest = record["claim_hash"].split("sha256:")[-1]
    if len(digest) != 64:
        raise SystemExit(f"unexpected claim hash: {record['claim_hash']}")
    return {
        "acp_job_id": cold["acp_job_id"],
        "entity": f"{record['entity']['category']}/{record['entity']['name']}",
        "epoch": record["epoch_id"],
        "claim_hash_sha256": record["claim_hash"],
        "claim_hash_bytes32": "0x" + digest,
        "verdict": cold["post_state"],
        "operation_id": record["operation_id"],
        "writer_id": record["writer_id"],
    }


def verify(tx_hash):
    deployment = json.loads((PROOF / "base_deployment.json").read_text())
    contract = W3.eth.contract(address=W3.to_checksum_address(deployment["contract_address"]), abi=ABI)
    receipt = W3.eth.get_transaction_receipt(tx_hash)
    logs = contract.events.Anchored().process_receipt(receipt)
    args = logs[0]["args"] if logs else {}
    return {
        "chain_id": W3.eth.chain_id,
        "network": "base-sepolia",
        "contract_address": deployment["contract_address"],
        "tx_hash": tx_hash,
        "receipt_status": receipt.status,
        "block_number": receipt.blockNumber,
        "decoded_event": {
            "entity": args.get("entity"),
            "epoch": args.get("epoch"),
            "claimHash": "0x" + bytes(args["claimHash"]).hex() if args.get("claimHash") else None,
            "verdict": args.get("verdict"),
            "operationId": args.get("operationId"),
        },
        "verified_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "rpc": RPC,
    }


def main():
    verify_only = "--verify" in sys.argv
    res = resolution()

    existing = json.loads(OUT.read_text()) if OUT.exists() else None
    if existing and existing.get("resolution", {}).get("claim_hash_bytes32") == res["claim_hash_bytes32"]:
        tx_hash = existing["anchor"]["tx_hash"]
    else:
        if verify_only:
            print(json.dumps({"status": "not-anchored", "resolution": res}, indent=2))
            return
        acct = require_wallet()
        contract = W3.eth.contract(address=W3.to_checksum_address(os.environ["MNEMON_ANCHOR_ADDRESS"]), abi=ABI)
        tx = contract.functions.anchor(
            res["entity"], res["epoch"], bytes.fromhex(res["claim_hash_bytes32"][2:]), res["verdict"], res["operation_id"]
        ).build_transaction({
            "from": acct.address,
            "nonce": W3.eth.get_transaction_count(acct.address),
            "chainId": W3.eth.chain_id,
            "gas": 200000,
            "maxFeePerGas": W3.to_wei(0.1, "gwei"),
            "maxPriorityFeePerGas": W3.to_wei(0.01, "gwei"),
        })
        signed = acct.sign_transaction(tx)
        tx_hash = W3.eth.send_raw_transaction(signed.raw_transaction).hex()
        W3.eth.wait_for_transaction_receipt(tx_hash)

    anchor = verify(tx_hash)
    anchor["from"] = W3.eth.account.from_key(os.environ["BASE_PRIVATE_KEY"]).address
    anchor["explorer"] = f"https://sepolia.basescan.org/tx/{tx_hash}"
    bound = anchor["decoded_event"]["claimHash"] == res["claim_hash_bytes32"]
    out = {
        "purpose": "Base commitment binding the ACP-resolved MNEMON claim to chain",
        "resolution": res,
        "anchor": anchor,
        "claim_hash_bound": bound,
        "note": "Anchor of the resolved claim. proof/base_transaction.json remains the record of the earlier epoch-clean anchor and is not modified.",
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
