# Progress — M2 S1 + rounding decision

**Milestone status**
| Milestone | Target | State |
|---|---|---|
| M1 core/ money + validation | G1–G6 exact; property + mutation green | ✅ slice 1 done · ✅ rounding (OQ-1) done · slice 3 settlement pending |
| **M2 Data layer** | IndexedDB + migrations + audit | **S1 done** |
| M3 Operator flow | 5 screens, clumsy e2e, Kannada | — |
| M4 Owner mode | Day close, PIN, amend | — |
| M5 Reports & export | Excel parity, XLSX/CSV/JSON | — |
| M6 Pilot | 14-day shadow, zero unexplained diffs | — |

## Rounding — owner-confirmed 2026-11-15 (D6) — DONE
Petrol/Diesel truncate per operator-shift per product; XP rounds half-up; ±₹1 flag tolerance;
exact internal math; p.27's 17,710 accepted as a documented ₹1-truncation exception.

- `shiftSales(turns)` — groups by product (+rate), rounds once per group
- `roundToRupees(amountX100, policy)` — integer division only, no fractional intermediate
- `flagFor(diffPaise, tolerancePaise=100)` — §4.2 boundaries, inclusive at ±₹1
- 20 new tests (G1–G5 reproduce every `paper_rupees`; p.27 exception pinned)
- Mutation pass 6/6 red: truncate→round, half-up→truncate, tolerance `<` vs `<=`,
  integer division→float, Petrol policy flipped, XP policy flipped. Control 20/20 green.
- New **OQ-12**: mid-shift rate change is not covered by the rule; grouped by product+rate
  (identical for a single rate). Owner to confirm.

## Slice S1 — `db.js` open + versioned migration runner — DONE

**Files created:**
- `app/src/data/db.js` — `openDb`, `deleteDb`, `applyMigrations`, `createStores`, `STORE_SPECS` (v1), `MIGRATIONS` (v1), `DB_NAME='fuel'`, `SCHEMA_VERSION=1`
- `tests/unit/db.test.mjs` — 8 tests: fresh DB shape, reopening no-op, legacy upgrade carries data, v1 snapshot round-trip, downgrade rejected, migration runner validation, IndexedDB missing, no UI/float imports
- `tests/fixtures/db-v1.json` — immutable v1 snapshot (released schema + sample rows)
- `tests/fixtures/db-v0.json` — synthetic legacy install for upgrade proof

**Test results (Node 26, `--test-isolation=none`):**
```
28 pass, 0 fail
20 golden (nozzleSales) ✅
8 db (schema + migrations + fixtures) ✅
```

**Mutation pass (M2 plan, §Guard rules):**
| Mutation | Result |
|---|---|
| Drop `status` index on `shifts` | 7 pass → 1 fail ✅ |
| `rates` keyPath not composite | 7 pass → 1 fail ✅ |
| `audit` loses `autoIncrement` | 8 pass → 2 fail ✅ |
| Re-run already-applied migrations | 8 pass → 1 fail ✅ |
| Skip gap validation | 8 pass → 1 fail ✅ |
| Skip duplicate validation | 8 pass → 1 fail ✅ |
| Control (unmutated) | 8 pass, 0 fail ✅ |

All mutations turn the suite red — the migration runner and schema are verified by the tests.

**Guard rules enforced:**
- No float arithmetic or `toFixed` for money in `/data` (test confirms).
- No `/ui` imports in `/data` (test confirms).
- `fake-indexeddb` is dev-only (`package.json` `devDependencies`).
- `db-v1.json` fixture is immutable — a schema change requires a new DB version, migration, and snapshot in the same commit.

**Current full suite: 48 pass, 0 fail** (20 nozzleSales golden + 8 db + 20 rounding).

**Next:** Slice S2 — Entity repositories (nozzles, rates, operators).
Awaiting Verifier sign-off before S2 (per kickoff prompt). M1 slice 3 (`settleShift`) is now
unblocked by D6 and can be scheduled whenever the Planner wants it.
