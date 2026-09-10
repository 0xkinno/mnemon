# Proof

The proof sequence is:

```text
writer A -> COLD prepare -> WARM CRITICAL -> COLD commit
writer B -> COLD prepare -> WARM SAFE -> COLD commit
fresh reader -> naive SAFE / MNEMON CONTESTED
```

Crash proof terminates a subprocess after WARM and before commit; a fresh reader returns `UNWITNESSED`. Repeating the same operation id and claim is deterministic and does not change the effective result.

The close-out proof extends the sequence through independent adjudication and a public commitment:

```text
CONTESTED
  -> Virtuals ACP job 78185 (real escrow, Base Mainnet)
  -> provider deliverable, 231 bytes, keccak256 == on-chain JobSubmitted hash
  -> Sibyl COLD witness (acp-resolution-78185, writer acp-evaluator)
  -> MNEMON recomputes CLEAN
  -> Base Sepolia anchor 0xf6c2ee41... carries the same claim hash
```

Then the load-bearing control is re-run against that resolved state: with the ACP artifact, the COLD result artifact, and the Base anchor all still on disk, deleting the entity or removing the memory layer returns `UNWITNESSED` and blocks the action. Nothing substitutes for the witness. See `proof/final_e2e_chain.json`, `proof/final_deletion_control.json`, `proof/final_fresh_session.json`, and `proof/final_integrity_audit.json`.
