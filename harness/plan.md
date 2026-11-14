# Plan — current milestone

## M0 — Spec lock (PARTIAL, blocking M1 remainder)
- [x] §5 figures transcribed to `fixtures/golden.json` (G1–G6)
- [ ] G7 Excel parity — needs `Fuel_Pump_Daily_Tracker.xlsx` (not in workspace)
- [ ] §13 open questions answered by owner — **OQ-1 (rounding) blocks slice 3**, others block M3/M4

## M1 — `core/` money + validation
Slices are ordered so each one is green on its own and never needs a later slice to pass.

| Slice | Deliverable | Acceptance test | Status |
|---|---|---|---|
| **1** | `money.js: nozzleSales(opening, closing, testing, credits[], ratePaise)` | G1–G5 exact `amount_x100`; G4 credits; G5 testing; split-linearity; rejects closing<opening and non-integer input | **doing** |
| 2 | `money.js: shiftSales(turns[])` — Σ nozzle sales in exact `x100` | G1/G2/G4 shift totals == fixture `amount_x100`; order-independent | todo |
| 3 | `money.js: settleShift()` — digital, adjustments, expected_cash, flag | G2 expected cash 4,993; G3 10,785; G4 38,263; tolerance boundary at exactly ₹1 | todo — **blocked by OQ-1** |
| 4 | `validate.js` — §6 rules returning `{ok, level, msg}` | one test per §6 row incl. closing==opening warn and 3× outlier warn | todo |
| 5 | `model.js` — normalizers + meter continuity (G6) | G6: opening must equal previous closing | todo |
| 6 | Property + mutation suite | §10.3 invariants; mutation pass must go red on sign flip / dropped testing deduction | todo |

## Guard loop (every slice)
Diff ≤ 300 lines · no float on money · no arithmetic in `/ui` · no network/LLM in runtime · fixtures untouched without a `decisions.md` entry.

## Notes
- Slice 1 deliberately stops before any rounding. §4.4 is still open (OQ-1), and `nozzleSales`
  returns exact integer hundredths of a paise so the decision cannot leak upward (D2).
- G7 and all of M3+ need owner input; they are not on the slice 1 critical path.
