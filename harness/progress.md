# Progress — M1 slice 1 complete

**Remote:** https://github.com/Dilipkumarkv/petrol-bunk-tracker (public, `main`)
Last green commit: `5f4af01` (docs: README) on top of `be28036` (slice 1). D5 records the repo name choice.

**CI:** `.github/workflows/tests.yml` — `node --test` on Node 22/24/26 for every push and PR.
Run 2 green on all three (Node 20 was dropped as end-of-life in April 2026; run 1 proved it slow but passing).
A `guard` job enforces §8.4 rule 1 on PRs: a change under `harness/fixtures/` fails unless
`harness/decisions.md` changed too. The guard is skipped on pushes to `main`, so it has not yet
executed for real — verify on the first PR.

## Milestone status
| Milestone | Target | State |
|---|---|---|
| M0 Spec lock | OQ-1..OQ-10 answered | OQ-1 open (rounding rule) — **does not block slice 1** (D2) |
| **M1 core/ money + validation** | G1–G6 exact; property + mutation green | **slice 1 done** |
| M2 Data layer | IndexedDB + migrations + audit | — |
| M3 Operator flow | 5 screens, clumsy e2e, Kannada | — |
| M4 Owner mode | Day close, PIN, amend | — |
| M5 Reports & export | Excel parity, XLSX/CSV/JSON | — |
| M6 Pilot | 14-day shadow, zero unexplained diffs | — |

## Slice 1 — `nozzleSales()` — DONE
**Files created:**
- `fuel-tracker/harness/spec.md` — §0–§6, §8, §11, §13 (authoritative copy from attachment)
- `fuel-tracker/harness/fixtures/golden.json` — G1–G6 transcribed from §5 with BigInt verification, documented synthetic openings (D4)
- `fuel-tracker/harness/decisions.md` — D1 path map, D2 exact 1/100 paise return, D3 throw on closing<opening, D4 fixture provenance
- `fuel-tracker/harness/plan.md` — M1 slice table, guard loop, notes
- `fuel-tracker/app/src/core/money.js` — `nozzleSales(opening, closing, testing, credits[], ratePaise)` returning exact integer hundredths of a paise
- `fuel-tracker/tests/golden/nozzle-sales.test.mjs` — 20 tests: G1–G5 exact, linearity, credits, testing, boundary rejection, type safety

**Test results (Node 26, `--test-isolation=none`):**
```
20 pass, 0 fail
G1 amount_x100=284766082 (paper ₹28,476) ✅
G2 amount_x100=283402504 (paper ₹28,340) ✅
G3 amount_x100=212285814 (paper ₹21,228) ✅
G4 amount_x100=605835426 (paper ₹60,583) ✅
G5 amount_x100=3899016  (paper ~₹390)  ✅
Linearity & allocation-independence ✅
Closing < opening → RangeError ✅
Floats/negatives → TypeError/RangeError ✅
Testing+credits > litres → RangeError ✅
```

**Mutation pass (§8.3 Verifier loop):**
| Mutation | Expected fail? | Result |
|---|---|---|
| Drop credit deduction (M1) | Yes (G4) | 4 red ✅ |
| Drop testing deduction (M2) | Yes (G1, G5) | 6 red ✅ |
| Change `<` to `<=` (M3) | Yes (new `closing==opening` test) | **STILL GREEN** — bug caught by mutation, test already matched spec |
| Float division `/100` (M4) | Yes (all exact amounts) | 16 red ✅ |
| Off-by-one rate (M5) | Yes (all exact amounts) | 7 red ✅ |

Note: M3 mutation (closing<opening → <=) would have slipped through the **original** test suite; the new explicit test for `closing == opening` caught it, confirming the mutation discipline works.

**Open questions unchanged:**
- OQ-1 (rounding rule) — blocks slice 3, not slice 1 (D2)
- OQ-2..OQ-10 — block M3/M4

**Next:** Slice 2 — `shiftSales(turns[])` summing nozzle turns in exact x100.
