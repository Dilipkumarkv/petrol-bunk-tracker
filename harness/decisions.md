# Decisions (append-only)

Format: `D<n> <date> — <decision>. Reason. Affects.`

## D1 2026-11-14 — Build in `fuel-tracker/`, docs under `fuel-tracker/harness/`
The kickoff prompt names `/harness/spec.md` and `core/money.js`. The workspace root is a
multi-project folder (5 unrelated repos, no git repo). A fresh self-contained repo at
`fuel-tracker/` keeps the spec's relative layout (`harness/`, `app/src/core/`, `tests/`)
without `git init` swallowing unrelated projects.
**Path map:** `/harness/* → fuel-tracker/harness/*`, `app/src/core/money.js → fuel-tracker/app/src/core/money.js`.
Reason: avoid polluting sibling projects; trivially reversible by `mv`.
Affects: all paths in this repo.

## D2 2026-11-14 — Exact sales amounts are held as integer hundredths of a paise
§4.1 gives `sales_paise = sales_litres × rate_paise`, which is **not** an integer:
`salesLitresH × ratePaise / 100`. Truncating inside `nozzleSales` would pre-empt the §4.4
open decision and lose information. So `nozzleSales` returns `salesX100 = salesLitresH × ratePaise`
— exact, lossless, integer, no float. One division by 100 happens later, **once**, at the
shift total (slice 3), where §4.4 applies.
Reason: keep the rounding decision where the spec puts it, and make every intermediate exact.
Affects: `core/money.js` return shape, golden fixture unit `amount_x100`.
Golden proof: G1 `284766082` → ₹28,476.6082 (paper ₹28,476); G4 `605835426` → ₹60,583.5426 (paper ₹60,583).

## D3 2026-11-14 — `nozzleSales` throws on closing < opening instead of returning a flag
§4.1 says litres "must be >= 0" and §6 says block. A pure money function must never emit a
number for physically impossible input. `validate.js` (slice 4) does the friendly pre-check and
owns the §6 message; `money.js` is the invariant fence.
Reason: fail loudly at the boundary, keep money functions total but not silently wrong.
Affects: `core/money.js`, slice 1 error contract.

## D4 2026-11-14 — Golden fixtures reconstructed from §5 with documented synthetic openings
`harness/fixtures/golden.json` did not exist before this slice. Values are transcribed from
§5 verbatim; where §5 records only litre deltas (G1–G5) a synthetic opening of `1000000`
(10,000.00 L) is used so `closing − opening` equals the recorded delta. This is recorded in the
fixture's `meta.synthetic_openings`, not silently invented. Every amount was re-derived
independently with BigInt before commit.
Reason: the slice cannot be test-first without data, and transcribing an oracle is not guessing it.
Affects: `harness/fixtures/golden.json`. Any later change to a golden **value** still needs a new entry here.

## D5 2026-11-14 — Published publicly as `petrol-bunk-tracker`, not "IOCL App"
The repo was requested as "IOCL App". IOCL / Indian Oil is a trademark of Indian Oil Corporation Ltd,
and a public repo under that name reads as an official or endorsed app. Owner chose a neutral public
name instead: https://github.com/Dilipkumarkv/petrol-bunk-tracker. The README carries an explicit
non-affiliation paragraph, and no operator/customer/company data is committed — fixture names are
placeholders and the openings are synthetic (D4).
Reason: trademark clarity on a public repo, and no real money data in a public place.
Affects: repo name, repo description, README §"Not affiliated", public visibility.

## D6 2026-11-15 — ROUNDING, owner-confirmed (closes OQ-1)
**Decision (owner, verbatim):**
- Petrol & Diesel: per operator-shift, per product: sum net litres, × rate, **TRUNCATE** to whole rupees.
- XP: **round half-up** to whole rupees (.50 and above up).
- Internal math exact: integer hundredths-of-litre × integer paise/L.
- Tolerance ±1 rupee at flag time.
- Known exception: **p.27** line — 17,709.885 written as 17,710.

**Implementation:**
- `ROUNDING_POLICY = { Petrol: 'truncate', Diesel: 'truncate', XP: 'half-up' }`.
- Rounding happens at `shiftSales()`: group by product, sum `salesLitresH` and the exact
  `salesX100`, then round **once per group**. Never per nozzle, never on the combined
  shift total (that would round across products and can differ by a rupee).
- `roundToRupees(amountX100, policy)` uses integer division (`(n - n % d) / d`) so no
  fractional intermediate exists. Half-up adds 5,000 x100-units (₹0.50) before truncating.
- `flagFor(diffPaise, tolerancePaise = 100)` implements §4.2: SHORT at -₹1, EXCESS at +₹1,
  inclusive at the boundary, owner-configurable.
- An unknown product throws instead of defaulting to a policy.

**p.27 exception:** truncation yields ₹17,709 where the paper says ₹17,710. The ₹1 gap is
inside the ±₹1 tolerance, so it is recorded, not "fixed". Encoded as a test
(`tests/golden/rounding.test.mjs`) so the exception can never be silently absorbed by a
later change.

**New open question — OQ-12:** the rule says "sum net litres × rate", which presumes one
rate per product per shift. A mid-shift rate change is not covered. Implemented as grouping
by **product + rate**, which is identical to the stated rule for a single rate and never
multiplies litres by the wrong price. Owner to confirm whether a rate change can happen
mid-shift, and if so whether rounding should be per rate group.

Reason: OQ-1 explicitly blocked M1 slice 3 and any shift-total test.
Affects: `core/money.js` (`shiftSales`, `roundToRupees`, `flagFor`), M1 slice 3, M5 exports.
Tests: 20 new; mutation pass 6/6 red when the rule is broken.
