from typing import Any
from .memory import claim_hash


def _valid(warm: dict[str, Any], witness: dict[str, Any]) -> bool:
    required = ("operation_id", "epoch_id", "writer_id", "claim_hash", "status", "evidence")
    return all(warm.get(k) == witness.get(k) for k in required) and claim_hash({"status": witness.get("status"), "evidence": witness.get("evidence")}) == witness.get("claim_hash")


def arbitrate(memory, category: str, name: str) -> dict[str, Any]:
    warm = memory.current(category, name)
    witnesses = memory.witnesses(category, name)
    if not warm:
        return {"status": "UNWITNESSED", "reason": "no current WARM claim", "claims": []}
    if warm.get("entity", {}).get("category") != category or warm.get("entity", {}).get("name") != name:
        return {"status": "INVALID", "reason": "entity binding mismatch", "claims": [warm]}
    if warm.get("claim_hash") != claim_hash({"status": warm.get("status"), "evidence": warm.get("evidence")}):
        return {"status": "INVALID", "reason": "current claim hash mismatch", "claims": [warm]}
    matching = [w for w in witnesses if _valid(warm, w)]
    same_epoch = [w for w in witnesses if w.get("epoch_id") == warm.get("epoch_id") and _valid(w, w)]
    conflicts = [w for w in same_epoch if w.get("claim_hash") != warm.get("claim_hash") and w.get("writer_id") != warm.get("writer_id")]
    if conflicts:
        return {"status": "CONTESTED", "current": warm, "claims": [warm, *conflicts]}
    if not matching:
        return {"status": "UNWITNESSED", "current": warm, "claims": [warm]}
    return {"status": "CLEAN", "current": warm, "claims": [warm]}
