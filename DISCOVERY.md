# DISCOVERY.md

## 1. Sponsor primitive

Sibyl Memory exposes a WARM entity store for the current value and a COLD append-only journal for events. They are separate persistence surfaces.

## 2. Observed constraint

Installed and verified `sibyl-memory-client==0.8.1` in `.realvenv`. WARM has one row per `(tenant_id, category, name)`, `set_entity()` performs SELECT then INSERT/UPDATE inside the SDK storage transaction, and `write_event()` is a separate transaction. The SDK exposes no native writer identity or `update_entity()` method; MNEMON persists those fields in event `extra`.

## 3. Evidence

- Package version: `0.8.1`.
- Installed source: `.realvenv/Lib/site-packages/sibyl_memory_client/`.
- Inspected methods: `set_entity`, `get_entity`, `write_event`, `read_events`, `delete_entity`.
- Installed source lines: `client.py:887` (`set_entity`), `client.py:1019` (`write_event`), `client.py:940` (`get_entity`), `client.py:1056` (`read_events`), `schema.sql:27-36` WARM uniqueness, `schema.sql:76-87` COLD journal.
- `ConflictError` exists in the exceptions module but is not raised by ordinary same-key `set_entity()` updates; `update_entity()` does not exist. Timestamps are UTC ISO-8601 with millisecond precision.
- Real race: `experiments/real_sibyl_race.py`, 20 trials, zero exceptions, 20 `CONTESTED` results.
- Raw experiment outputs are in `proof/`.

## 4. Why existing approaches do not solve it

A naive `get_entity()` returns only the surviving WARM row. It cannot identify a hidden competing claim or prove that the row has a committed witness. Ordinary journal writes also do not create an atomic decision boundary because WARM and COLD calls commit independently.

## 5. New capability enabled by solving it

A memory-native consistency witness: current decisions are accepted only when their WARM value is backed by a matching persistent witness, with conflicting witnesses detected before downstream action.

## 6. One security/business invariant

No decision is settled when its current WARM body lacks a matching committed witness or when another independent witnessed claim for the same evidence epoch conflicts with it.

## 7. One failure mode

A misleading SAFE value can become current after winning the WARM overwrite race while a CRITICAL claim remains in COLD, or WARM can survive a crash before witness commit.

## 8. One reproducible demonstration

`python experiments/race_test.py`, `python experiments/crash_test.py`, and `python experiments/fresh_read.py` execute independent processes against SQLite and show SAFE from naive WARM versus CONTESTED or UNWITNESSED from MNEMON.

## 9. Final verification

The primitive was re-verified on the completed product path, not only in isolation. `proof/final_e2e_chain.json` re-derives the chain `Sibyl contested claims -> MNEMON CONTESTED -> ACP job 78185 -> provider deliverable -> verified deliverable hash -> Sibyl COLD witness -> MNEMON CLEAN -> Base commitment -> real receipt` from the live database and the live Base Sepolia receipt and reports `linkage_verified: true`. The decision hash stored as the COLD witness is the exact value committed by the Base transaction, so the chain is bound rather than merely coexistent.
