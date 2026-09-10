from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from .memory import claim_hash

@dataclass(frozen=True)
class Claim:
    operation_id: str
    epoch_id: str
    entity_key: str
    watcher_id: str
    claim: dict[str, Any]
    evidence_refs: list[str]
    written_at: str

    def record(self):
        return {"operation_id": self.operation_id, "epoch_id": self.epoch_id,
                "entity_key": self.entity_key, "watcher_id": self.watcher_id,
                "claim_hash": claim_hash(self.claim), "claim": self.claim,
                "evidence_refs": self.evidence_refs, "written_at": self.written_at}

    @classmethod
    def create(cls, operation_id, epoch_id, entity_key, watcher_id, claim, evidence_refs=None):
        return cls(operation_id, epoch_id, entity_key, watcher_id, claim, evidence_refs or [], datetime.now(timezone.utc).isoformat())

