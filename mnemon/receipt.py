from .memory import canonical_json, claim_hash

def decision_receipt(entity_key, epoch_id, state, claims, memory_refs=None):
    body = {"entity": entity_key, "epoch": epoch_id, "state": state,
            "claims": claims, "memory_refs": memory_refs or [], "claim_hashes": [c.get("claim_hash") for c in claims],
            "arbiter_version": "mnemon-0.2"}
    body["receipt_hash"] = claim_hash(body)
    return body

