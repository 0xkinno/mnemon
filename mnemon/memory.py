import hashlib
import json
import uuid
from typing import Any
from sibyl_memory_client import MemoryClient
from sibyl_memory_client.storage import Storage
from sibyl_memory_client.exceptions import NotFoundError


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def claim_hash(claim: dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(claim).encode()).hexdigest()


class WitnessedMemory:
    def __init__(self, path: str):
        self.client = MemoryClient(Storage(path))

    def prepare(self, *, category, name, status, evidence, writer_id, epoch_id=None, operation_id=None):
        operation_id = operation_id or "op-" + str(uuid.uuid4())
        epoch_id = epoch_id or "epoch-" + str(uuid.uuid4())
        body = {"status": status, "evidence": evidence}
        record = {"operation_id": operation_id, "epoch_id": epoch_id, "writer_id": writer_id,
                  "entity": {"category": category, "name": name}, "claim_hash": claim_hash(body), **body}
        self.client.write_event(extra={"kind": "mnemon", "phase": "prepare", **record})
        return record

    def write_warm(self, record):
        self.client.set_entity(record["entity"]["category"], record["entity"]["name"], record)

    def commit(self, record):
        existing = self.witnesses(record["entity"]["category"], record["entity"]["name"])
        if any(x.get("operation_id") == record["operation_id"] and x.get("claim_hash") == record["claim_hash"] for x in existing):
            return
        self.client.write_event(extra={"kind": "mnemon", "phase": "commit", **record})

    def delete(self, category, name):
        self.client.delete_entity(category, name)

    def witnessed_write(self, **kwargs):
        record = self.prepare(**kwargs)
        self.write_warm(record)
        self.commit(record)
        return record

    def current(self, category, name):
        try:
            return self.client.get_entity(category, name)["body"]
        except NotFoundError:
            return None

    def witnesses(self, category, name):
        out = []
        for event in self.client.read_events(limit=1000):
            body = event.get("extra") or {}
            if body.get("kind") == "mnemon" and body.get("phase") == "commit" and body.get("entity", {}).get("category") == category and body.get("entity", {}).get("name") == name:
                out.append(body)
        return out
