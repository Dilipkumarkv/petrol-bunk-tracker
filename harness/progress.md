# Progress — M2 S3 (1/3) v2 migration complete

**Milestone status**
| Milestone | Target | State |
|---|---|---|
| M1 core/ money + validation | G1–G6 exact; property + mutation green | ✅ slice 1 done · ✅ rounding (OQ-1) done · slice 3 settlement pending |
| **M2 Data layer** | IndexedDB + migrations + audit | **S1 ✅ · S2 ✅ · S3 (1/3) ✅** |
| M3 Operator flow | 5 screens, clumsy e2e, Kannada | — |
| M4 Owner mode | Day close, PIN, amend | — |
| M5 Reports & export | Excel parity, XLSX/CSV/JSON | — |
| M6 Pilot | 14-day shadow, zero unexplained diffs | — |

## Slice S1 — `db.js` open + versioned migration runner — DONE
[... unchanged ...]

## Slice S2 — nozzles, rates, operators repos + text.js — DONE
[... unchanged ...]

## Slice S3 (1/3) — v2 migration with turn chain indexes — DONE

**Files created:**
- `app/src/data/db.js` — `SCHEMA_VERSION = 2`, `MIGRATIONS[1]` creates `nozzle_seq` (unique) + `nozzle_status`, backfills `seq` 1..N per nozzle using `recorded_at` then `id`, treats drafts/unknown status correctly
- `tests/unit/migrations-v2.test.mjs` — 10 tests: v1→v2 upgrade, per-nozzle backfill, ties broken by id, drafts excluded, unique index enforced, reopening no-op, v2 snapshot round-trip
- `tests/fixtures/db-v2.json` — immutable v2 snapshot (two nozzles, ordered chains, one draft)
- `tests/unit/db.test.mjs` — updated to v2 schema expectations

**Test results (Node 26, `--test-isolation=none`):**
```
103 pass, 0 fail (all prior suites + 18 migration tests)
```

**Mutation pass (5/5 red):**
| Mutation | Result |
|---|---|
| `nozzle_seq` non-unique | 103→101 |
| Skip backfill | 103→98 |
| Global backfill (no per-nozzle grouping) | 103→98 |
| Forgot to bump `SCHEMA_VERSION` | 103→92 |
| Assign `seq` to drafts | 103→102 |
| Control | 103/0 |

All mutations turn the suite red.

**Next commit (2/3):** Turns repository, `meter` queries (`lastClosing`, `chain`, `verifyChain`), `closeTurnInTx`. Awaiting the full S3 brief (`M2_S3_Meter_Continuity.md`) to write those APIs — the addendum only specifies the schema change.
