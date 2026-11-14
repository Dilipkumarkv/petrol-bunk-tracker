# Petrol Bunk Tracker

An offline-first web app for recording nozzle meter readings, operator collections, deposits and daily cash reconciliation at a retail fuel outlet — built so that **no rupee on screen is computed by a language model**.

> **Status: early.** Milestone M1 (deterministic money core), slice 1 of 6 is complete and green. There is no UI yet. See [Roadmap](#roadmap).

---

## The golden rule

> *The LLM builds the app. The LLM is never in the runtime money path.*

Every number the app shows comes from a pure, tested function in [`app/src/core/money.js`](app/src/core/money.js). The UI contains no arithmetic. There is no network call and no model call anywhere in runtime code — the app works from static hosting, fully offline.

---

## Why integer money

Floating-point arithmetic silently loses paise. This project forbids it in the money path, and the type system is replaced by runtime assertions plus tests.

| Quantity | Unit | Example |
|---|---|---|
| Litres | integer **hundredths of a litre** | `25687` = 256.87 L |
| Rate | integer **paise per litre** | `11086` = ₹110.86/L |
| Amount | integer **hundredths of a paise** | `284766082` = ₹28,476.6082 |

Amounts are held in 1/100 paise because `salesLitresH × ratePaise` is exact but not a whole number of paise. The one division by 100 happens once, at the operator-shift total, where the rounding rule applies (see [Open questions](#open-questions)). Truncating earlier would pre-empt that decision and lose information — recorded as decision **D2** in [`harness/decisions.md`](harness/decisions.md).

Passing a float anywhere in the money path throws. That is deliberate.

---

## Quick start

```sh
cd fuel-tracker
node --test --test-isolation=none tests/golden/nozzle-sales.test.mjs
```

```
✔ G1 — litres and exact amount match §5            (3 nozzles, 15.60 L testing)
✔ G4 — each credit line is deducted, and they sum to 283.74 L
ℹ tests 20
ℹ pass 20
ℹ fail 0
```

No dependencies, no build step, no `npm install`. Node 20+.

> **Environment note.** `--test-isolation=none` is required on Termux/Android: the default test runner spawns a child node with a flag this libc rejects (`expected absolute path: --heap-prof-interval=...`). It is harmless everywhere else.

---

## What the core function does

`nozzleSales(opening, closing, testing, credits[], ratePaise)` implements spec §4.1:

```
litres      = closing − opening            (must be ≥ 0)
salesLitres = litres − testing − Σ credits
salesX100   = salesLitres × ratePaise      (exact, integer)
```

Behaviour at the edges:

- `closing < opening` → throws. A meter cannot run backwards, and a money function must never emit a number for impossible input.
- `closing == opening` → returns zero litres. Legitimate (no fuel sold); a *warning* belongs to the validation layer, not here.
- testing + credits > litres → throws, rather than returning negative sales.
- Any non-integer or negative input → throws.

---

## Golden data

The test fixtures in [`harness/fixtures/golden.json`](harness/fixtures/golden.json) are transcribed from real notebook pages, hand-verified, and re-derived independently with BigInt before being committed.

| Case | Product | Exact amount (×100 paise) | Paper figure | Match |
|---|---|---|---|---|
| G1 | Petrol, 3 nozzles, 15.60 L testing | `284766082` | ₹28,476 (truncated) | ✅ |
| G2 | Petrol, 2 nozzles | `283402504` | ₹28,340 | ✅ |
| G3 | Petrol, second operator | `212285814` | ₹21,228 | ✅ |
| G4 | Diesel, 5 credit-litre lines | `605835426` | ₹60,583 | ✅ |
| G5 | XP, 5 L test | `3899016` | ≈ ₹390 | ✅ |

Fixtures are frozen: changing a value requires a dated entry in [`harness/decisions.md`](harness/decisions.md) citing the business reason. Weakening a test to make it pass is forbidden.

---

## Repository layout

```
fuel-tracker/
  app/src/core/
    money.js            pure arithmetic. no DOM, no storage, no clock, no network
  tests/golden/
    nozzle-sales.test.mjs   G1–G5 + boundary + invariant tests
  harness/
    spec.md             the build spec (authoritative)
    plan.md             current milestone, slice table
    progress.md         done / doing / blocked, last green state
    decisions.md        append-only decision log (D1–D4)
    fixtures/golden.json
```

The planned full tree — `core/validate.js`, `core/model.js`, `data/db.js`, `ui/`, `i18n/` — is in `harness/spec.md` §7. Nothing outside `core/` exists yet.

---

## How this is built

A milestone/slice harness rather than one long agent session. Each role reads a deliberately narrow set of files.

| Role | Job |
|---|---|
| Planner | Milestone → slices, each with an acceptance test |
| Builder | One slice, test-first (RED → GREEN → refactor) |
| Verifier | Re-derives expected numbers from the spec *without* seeing the builder's code |
| Reviewer | UX rules, security, diff size, spec drift |
| Scribe | progress.md, changelog, decisions |

Rules that keep it honest:

- One slice = one commit = green. Commit only when the suite passes.
- Max 5 iterations per slice; same failure twice → stop and escalate, don't thrash.
- Guard loop every slice: no float on money, no arithmetic in `ui/`, no network in runtime code, diff ≤ 300 lines, fixtures untouched without a decision entry.

**Mutation check.** Every slice must go red when the code is deliberately broken. Documented results for slice 1:

| Mutation | Tests that caught it |
|---|---|
| Drop credit deduction | G4 net litres, G4 amount, negative-sales guard — 4 red |
| Drop testing deduction | G1, G5 litres and amounts — 6 red |
| Force `/100` (float leak) | All amounts, integer assertion — 16 red |
| Off-by-one on rate | All exact amounts — 7 red |
| `<` → `<=` on the meter guard | Caught only after adding an explicit `closing == opening` test |

That last row is the point of the exercise: the original suite did **not** catch it, so the test was strengthened rather than the finding dismissed.

---

## Roadmap

| # | Milestone | Exit criteria | State |
|---|---|---|---|
| M0 | Spec lock | Open questions answered, fixtures committed | partial |
| M1 | Money core | G1–G6 exact, property + mutation green | **in progress (1/6 slices)** |
| M2 | Data layer | IndexedDB stores, migrations, audit log, export round-trip | — |
| M3 | Operator flow | 5 screens, clumsy-operator e2e, offline, Kannada/English | — |
| M4 | Owner mode | Day close, rates, flags, lock/amend, PIN | — |
| M5 | Reports | Excel parity, XLSX/CSV/JSON export, backups | — |
| M6 | Pilot | 14 days shadow-running alongside the paper notebook, zero unexplained differences | — |

Slice 2 next: `shiftSales(turns[])` summing nozzle turns in exact `x100`, order-independent.

---

## Open questions

These are deliberately unresolved rather than guessed — money rules get asked, not assumed.

1. **Rounding rule.** The notebook mixes truncation and rounding. Proposal: keep exact paise internally, round once per operator-shift total, absorb the rest in a ₹1 tolerance. Blocks shift settlement.
2. **"Can" line** — is ₹750 added to cash, and what is it?
3. **Credit-litre categories** (S.O.T, N.S.S.O) — fixed list? Paid later?
4. **Deductions picklist** — which labels and signs?
5. **Which nozzles are testing-only?**
6. **Shift numbering** — fixed 1–3, or time-based?
7. **Devices** — one shared phone, or one per operator?
8. **Operator list** — names and uniqueness.
9. **Rate changes** — how often, entered by whom?
10. **Language** — Kannada-first labels?

---

## Not affiliated with any oil company

This is an independent personal project to replace a handwritten daily register. "IOCL" and Indian Oil are trademarks of Indian Oil Corporation Ltd. This project is not affiliated with, endorsed by, or produced by any oil marketing company. No real customer, operator or company data is stored in this repository; fixture values are ordinary page data with placeholder names.

## License

No license file yet — all rights reserved by default. Open an issue if you want one.
