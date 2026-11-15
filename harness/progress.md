# Progress — M2 S3 complete

**Milestone status**
| Milestone | Target | State |
|---|---|---|
| M1 core/ money + validation | G1–G6 exact; property + mutation green | ✅ money · ✅ rounding (D6) · ✅ validate.js |
| **M2 Data layer** | IndexedDB + migrations + audit | **S1 ✅ · S2 ✅ · S3 ✅** |
| M3 Operator flow | 5 screens, clumsy e2e, Kannada | next (S4 is the first of M2's remaining slices) |
| M4 Owner mode | Day close, PIN, amend | — |
| M5 Reports & export | Excel parity, XLSX/CSV/JSON | — |
| M6 Pilot | 14-day shadow, zero unexplained diffs | — |

## Slice S3 — meter continuity + turn storage — DONE

| Commit | Contents |
|---|---|
| `af3efb8` | v2 migration: `nozzle_seq` (unique) + `nozzle_status`, backfill, `db-v2.json` |
| `fbcac55` | `turns` repo, `meter.{lastClosing,chain,verifyChain}`, `closeTurnInTx`, `core/validate.js`, golden G6 |
| *(this commit)* | concurrency, atomicity, property, clock suites + real mutation pass |

**Full suite: 135 pass, 0 fail.**

### Mutation pass — 10/10 red, control green
Run by editing the real source, running the suite, then restoring from git
(`.scratch/mut-edit.mjs` + `.scratch/mut-s3.sh`).

| # | Mutation | Result |
|---|---|---|
| M0 | control, unmutated | 135 pass / 0 fail |
| M1 | order chain by timestamp instead of seq | red ×4 |
| M2 | skip the in-transaction chain re-check | red ×1 |
| M3 | let `lastClosing` include drafts | red ×3 |
| M4 | accept an override without a reason | red ×1 |
| M5 | allow `closing < opening` | red ×2 |
| M6 | compute `seq` wrongly (always 1) | red ×8 |
| M7 | treat equal opening/closing as an error | red ×2 |
| M8 | map `ConstraintError` to a generic error | red ×1 |
| M9 | `NOZZLE_BUSY` ignores the nozzle | red ×1 |
| M10 | S2 review: accept a float rate | red ×2 |

### Two findings that changed the work, not just the record

1. **The first mutation run was worthless.** Every case reported "pass=0 fail=0" in 0.9 s,
   including the control. `execSync` shells out to `/data/data/com.termux/files/usr/bin/sh`,
   which does not exist here, so **no test process ever ran**. A mutation report of all-green
   would have been fabricated evidence. Caught it by probing the control case; fixed by
   splitting the job — node edits the file, the harness shell runs the suite
   (`mut-edit.mjs` + `mut-s3.sh`). `execFileSync(process.execPath, […])` also fails,
   with `expected absolute path: "--test"` (the same termux-exec quirk that breaks
   `--heap-prof-increment` in this environment).
2. **M1 and M8 were genuinely still green at first.**
   - M1: `chain()` reads through the `nozzle_seq` index, and `getAll` already returns key
     order, so mutating the `.sort()` was a no-op. The mutation now also bypasses the index,
     which makes the ordering test meaningful.
   - M8: the unique-index `ConstraintError` is the second line of defence behind the
     in-transaction check, so the API almost never reaches it. Rather than delete the branch
     or fake a test, added a stub-store test that drives the mapping directly.

Also removed `tests/unit/mutation3.test.mjs`, which I had written as a set of
`assert.ok(true)` placeholders — that is a fake test and it would have claimed coverage
it did not have.

### Real bugs found by these tests
- Two closes racing on one nozzle: exactly one commits, the loser keeps its draft state and gets `CHAIN_CONFLICT` (verified, not assumed).
- A close aborted mid-transaction leaves **no** closed row and no `seq` — the write only lands on commit.
- A refused close (`SALES_NEGATIVE`) leaves every draft field intact.

### Known gap, recorded not hidden
`meter.verifyChain` reports `SEQ_GAP` and `BREAK`, but no test constructs a genuine
`BREAK` through the API (the API refuses to create one). Covered only at the migration level.

**Next:** S4 — shift draft + autosave + resume.
