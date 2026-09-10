"""Produce the provider-side ACP adjudication deliverable for a contested memory claim.

The provider offering `independent_memory_adjudication` is contracted to resolve a
CONTESTED Sibyl claim. The buyer/evaluator accepts a deliverable only when it parses
as JSON and carries the five string fields `decision`, `winning_claim`, `reason_code`,
`evidence_digest`, `adjudicated_at` (see scripts/acp_arbitrate.ts and
scripts/acp_preflight.mjs).

Adjudication policy (deterministic, no randomness):

  A `risk_verdict` is a safety signal. When two witnesses in the same epoch assert
  conflicting verdicts and neither claim hash is corrupted, the more conservative
  claim is upheld, because acting on a SAFE verdict that a second witness calls
  CRITICAL is the failure mode with the larger downside.

  decision        UPHELD - the contested claim is resolved in favour of one claimant
  winning_claim   CRITICAL if either claimant says CRITICAL, else SAFE
  reason_code     safety-dominant-witness-upheld
  evidence_digest the claim hash of the upheld claim
  adjudicated_at  UTC completion time of the adjudication
"""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "proof"
REASON_CODE = "safety-dominant-witness-upheld"
SEVERITY = {"SAFE": 0, "CRITICAL": 1}


def build(requirement: dict) -> dict:
    claims = [
        {"status": requirement["claim_a"], "claim_hash": requirement["claim_hash_a"]},
        {"status": requirement["claim_b"], "claim_hash": requirement["claim_hash_b"]},
    ]
    unknown = [c["status"] for c in claims if c["status"] not in SEVERITY]
    if unknown:
        raise SystemExit(f"unranked claim status(es): {unknown}")
    winner = max(claims, key=lambda c: SEVERITY[c["status"]])
    return {
        "decision": "UPHELD",
        "winning_claim": winner["status"],
        "reason_code": REASON_CODE,
        "evidence_digest": winner["claim_hash"],
        "adjudicated_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def main():
    requirement = json.loads((PROOF / "acp_requirement.json").read_text())
    deliverable = build(requirement)
    raw = json.dumps(deliverable, separators=(",", ":"))
    out = PROOF / "acp_deliverable.json"
    out.write_text(raw)
    print(json.dumps({"path": str(out), "bytes": len(raw.encode()), "deliverable": deliverable}, indent=2))


if __name__ == "__main__":
    main()
