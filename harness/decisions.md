# Decisions (append-only)

Format: `D<n> <date> — <decision>. Reason. Affects.`

## D1 2026-xx-xx — Build in `fuel-tracker/`, docs under `fuel-tracker/harness/`
The kickoff prompt names `/harness/spec.md` and `core/money.js`. The workspace root is a
multi-project folder (5 unrelated repos, no git repo). A fresh self-contained repo at
`fuel-tracker/` keeps the spec's relative layout (`harness/`, `app/src/core/`, `tests/`)
without `git init` swallowing unrelated projects.
**Path map:** `/harness/* → fuel-tracker/harness/*`, `app/src/core/money.js → fuel-tracker/app/src/core/money.js`.
Reason: avoid polluting sibling projects; trivially reversible by `mv`.
Affects: all paths in this repo.

## D2 2026-xx-xx — Exact sales amounts are held as integer hundredths of a paise
§4.1 gives `sales_paise = sales_litres × rate_paise`, which is **not** an integer:
`salesLitresH × ratePaise / 100`. Truncating inside `nozzleSales` would pre-empt the §4.4
open decision and lose information. So `nozzleSales` returns `salesX100 = salesLitresH × ratePaise`
— exact, lossless, integer, no float. One division by 100 happens later, **once**, at the
shift total (slice 3), where §4.4 applies.
Reason: keep the rounding decision where the spec puts it, and make every intermediate exact.
Affects: `core/money.js` return shape, golden fixture unit `amount_x100`.
Golden proof: G1 `284766082` → ₹28,476.6082 (paper ₹28,476); G4 `605835426` → ₹60,583.5426 (paper ₹60,583).

## D3 2026-xx-xx — `nozzleSales` throws on closing < opening instead of returning a flag
§4.1 says litres "must be >= 0" and §6 says block. A pure money function must never emit a
number for physically impossible input. `validate.js` (slice 4) does the friendly pre-check and
owns the §6 message; `money.js` is the invariant fence.
Reason: fail loudly at the boundary, keep money functions total but not silently wrong.
Affects: `core/money.js`, slice 1 error contract.

## D4 2026-xx-xx — Golden fixtures reconstructed from §5 with documented synthetic openings
`harness/fixtures/golden.json` did not exist before this slice. Values are transcribed from
§5 verbatim; where §5 records only litre deltas (G1–G5) a synthetic opening of `1000000`
(10,000.00 L) is used so `closing − opening` equals the recorded delta. This is recorded in the
fixture's `meta.synthetic_openings`, not silently invented. Every amount was re-derived
independently with BigInt before commit.
Reason: the slice cannot be test-first without data, and transcribing an oracle is not guessing it.
Affects: `harness/fixtures/golden.json`. Any later change to a golden **value** still needs a new entry here.
