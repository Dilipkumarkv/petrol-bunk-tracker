# Fuel Pump Tracker — Harness Build Spec

**Target:** Installable offline-first PWA (Android-first) for nozzle meter entry, operator collections, deposits and daily reconciliation.
**Builder:** LLM agent harness running on the phone.
**Golden rule:** *The LLM builds the app. The LLM is never in the runtime money path.* Every rupee on screen comes from deterministic, tested code.

> **Provenance note (not part of the original spec text).**
> The canonical document was supplied to this session as an attachment (21 KB, §0–§14).
> This file reproduces §0–§6, §8.1–§8.4, §11 and §13 verbatim in substance because they govern
> `core/` work and the loop rules. §3 screen wording, §7 full tree, §9 skills, §10 test pyramid
> detail, §12 runtime-LLM rules and §14 kickoff prompt remain in the attachment and are tracked
> as **OQ-11** in `progress.md` — the Scribe must paste the complete document here before M3.
> Nothing below has been reworded in a way that changes a number, a formula or a rule.

---

## 0. Feasibility verdict

**Feasible, and a good first harness project**, because:

- The domain is small and fully specified (you already have an Excel oracle plus real notebook pages).
- The math is simple arithmetic, so correctness can be checked exactly against golden data.
- A PWA needs no app-store, no backend and no native toolchain. It is just files (HTML/JS/JSON), which are easy to generate and diff on a phone.

**Why PWA over native Android:** one codebase, installs from a link to the home screen, works offline, updates by redeploying files, and is easiest for an LLM to produce and test. Wrap it later (Capacitor/TWA) only if Play Store or native features are needed.

**Honest risks:** data loss on a phone (browser storage can be cleared), several operators on shared devices, and rounding disputes (see §4.4). All are addressed below.

---

## 1. Users and the two modes

| Role | Who | What they do | Must NOT see |
|---|---|---|---|
| **Operator** | 12 staff, no fixed nozzle/shift | Pick name → pick nozzle(s) → type closing reading → enter Paytm/card → type cash handed over → confirm | Rates editing, other operators' money, past days, settings |
| **Owner / Manager** | You | Review shifts, see short/excess flags, enter rate changes, expenses, bank deposits, export, fix mistakes | Nothing hidden |

Operators use PIN-less quick pick (name list) on a shared phone, **or** their own phone via link. Owner mode is behind a PIN. Every closed shift is **locked**; edits are owner-only and logged.

---

## 2. Domain model (matches the Excel workbook)

```
Nozzle      { id, label, product(Petrol|XP|Diesel), use(Sales|TestingOnly), sheet }
Rate        { product, price_paise_per_litre, effective_from }       // never overwrite, append
Operator    { id, name }                                             // free text allowed, de-dup by normalized name
Reading     { nozzle_id, closing(x100), recorded_at }                // x100 = integer hundredths of a litre
ShiftEntry  { id, date, shift_no, operator_id, status(open|closed|locked) }
NozzleTurn  { shift_entry_id, nozzle_id, opening, closing, testing_litres, credit_litres[] }
Payment     { shift_entry_id, kind(Paytm|Card|OtherUPI), amount_paise }
Deduction   { shift_entry_id, label, amount_paise, sign(-|+) }       // watchman, can driver, mid-shift handover, "Can" addition
Deposit     { shift_entry_id, cash_paise, at }
DayLedger   { date, other_income, salary, other_expense, bank_deposit, actual_cash_counted }
AuditLog    { id, at, who, action, before, after }                   // append-only
```

**Representation rule:** store litres as integer hundredths (`12345` = 123.45 L) and money as integer paise. **No floating point for money, ever.**

**Meter continuity:** a nozzle's opening = its last closing (any operator). This is the *only* place state carries across shifts. Money never carries over.

---

## 3. Core screens (minimal UI)

Target: **5 screens operators ever see.** Big type, one task per screen, thumb-reachable buttons, numeric keypad, high contrast for sunlight, **Kannada + English toggle**.

1. **Who are you?** — grid of operator name buttons (+ "New name").
2. **Which nozzle(s)?** — big tiles with product color; opening reading shown read-only ("Starts at 1,649,633.19"). Multi-select for the rare two-nozzle case.
3. **Closing reading** — one nozzle per screen. Live preview: *Litres sold* and *Amount*. Hard stops/warnings per §6.
4. **Money** — Paytm, Card, Other UPI, deductions (pick from list, not free typing), then **"Cash to hand over: ₹X"** computed and shown huge.
5. **Hand over & confirm** — type cash actually handed over. Result banner: ✅ OK / ⚠️ Short ₹X / ⚠️ Excess ₹X. Confirm → locks.

**Owner screens:** Today dashboard, Shift list with flags, Day close (expenses, bank deposit, cash count), Rates, Nozzles, Operators, Export/Backup.

Words to avoid on operator screens: *reconcile, ledger, debit, credit, variance*. Use: *"Cash to hand over"*, *"You gave"*, *"Short"*, *"Extra"*.

---

## 4. Calculation specification (single source of truth)

All functions pure, in one module `core/money.js`. UI contains **no arithmetic**.

### 4.1 Per nozzle turn
```
litres        = closing - opening                       (must be >= 0)
sales_litres  = litres - testing_litres - sum(credit_litres)     (sales nozzles only)
sales_paise   = sales_litres * rate_paise_per_litre      (exact, then see 4.4)
```
Testing-only nozzles contribute **0 sales**; their litres are tracked for the "returned to tank" report.

### 4.2 Per operator per shift (sum over their nozzle turns)
```
sales         = Σ sales_paise
digital       = Σ payments (Paytm + Card + OtherUPI)
adjustments   = Σ deductions (-) and additions (+)
expected_cash = sales - digital + additions - deductions
diff          = cash_deposited - expected_cash
flag          = SHORT if diff <= -tolerance, EXCESS if diff >= tolerance, else OK
```
Default tolerance **₹1**, owner-configurable.

### 4.3 Per day
```
cash_sales_expected = Σ operator expected_cash
cash_received       = Σ operator deposits
operator_diff       = cash_received - cash_sales_expected
expected_closing    = opening_cash + cash_received + other_income - salary - other_expense - bank_deposit
drawer_diff         = actual_cash_counted - expected_closing
```

### 4.4 Rounding — OPEN DECISION (important)
Your notebook mixes truncation and rounding:

| Line | Exact | Written |
|---|---|---|
| 159.75 × 110.86 | 17,709.885 | 17,710 (rounded) |
| 613.38 × 98.77 | 60,583.543 | 60,583 (rounded or truncated, ambiguous) |
| 256.87 × 110.86 | 28,476.68 | 28,476 (truncated) |
| 184.68 × 98.77 | 18,240.84 | 18,240 (truncated) |

**Proposal:** keep exact paise internally; round **once per operator-shift total** to the nearest rupee; ₹1 tolerance absorbs the rest. Confirm this rule before M2 so the golden tests encode it.

---

## 5. Golden data (from the real notebook pages — use as test fixtures)

All verified by hand arithmetic. Operator names are placeholders.

**G1 — Petrol, one operator, 3 nozzles (p.30):**
- Litres 29.88 + 214.06 + 28.53 = **272.47**; testing 15.60 → **256.87** × 110.86 = 28,476.7 (paper 28,476)

**G2 — Petrol, deductions + Paytm (p.31):**
- 76.75 + 178.89 = 255.64 × 110.86 = **28,340** (rounded)
- Paytm 12,999 + 278; deductions 60 + 40 + 9,700 + 100 + 30 + 140
- Expected cash = 28,340 − 23,347 = **4,993** ✅ (paper 4,993)

**G3 — Petrol second operator, same page (p.31):**
- 191.49 × 110.86 = 21,228.5 → **21,228**
- 21,228 − 8,553 − 380 − 1,510 = **10,785** ✅

**G4 — Diesel with credit litres (p.44), the best test:**
- Litres 694.53 + 86.06 + 116.53 = **897.12**
- Credit/free litres 129.15 + 20 + 17.59 + 92 + 25 = **283.74** → 897.12 − 283.74 = **613.38** ✅
- 613.38 × 98.77 = 60,583.5 → 60,583; "Can" +750 → 61,333 (*my reading: added*); −100 −30; Paytm 22,940 → **38,263** ✅ (paper 38,263)
- *Verify the sign of "Can" and the meaning of S.O.T / N.S.S.O with the owner before relying on it.*

**G5 — XP with 5 L test:** 8.24 − 5 = 3.24 L × 120.34 ≈ ₹390 ✅

**G6 — Meter continuity:** opening of next shift on a nozzle must equal previous closing (e.g. 1649906.48 → 1649906.48).

**G7 — Excel parity:** feed the same inputs to the app core and to `Fuel_Pump_Daily_Tracker.xlsx`; every operator/day total must match within ₹1.

---

## 6. UX guardrails (foolproofing)

Block, warn, or auto-fix. The operator should find it hard to be wrong and easy to correct.

| Situation | Behaviour |
|---|---|
| Closing < opening | **Block.** "Closing is lower than start. Check the meter." |
| Closing = opening | Warn: "No fuel sold on this nozzle?" (needs a tap to confirm) |
| Litres > 3× that nozzle's typical shift | Warn: "That's a lot. Re-check digits." + show digits large for visual verify |
| Decimal slip (e.g. 16499.06 vs 1649906) | Fixed digit count per nozzle; keypad auto-inserts decimal |
| Wrong nozzle picked | Opening reading + product color shown before typing; "Not this one" back button |
| Operator forgets Paytm | Money screen always shows Paytm first; "None" explicit button |
| Cash typed wildly different from expected | Show diff immediately; require **second entry** if \|diff\| > ₹500 |
| Double submit / tap | Idempotent save, disable button after tap |
| Phone locks / app closes mid-entry | Autosave draft every field; resume banner |
| Edit after closing | Locked. Owner-only "Amend" creates a new audit-logged version |
| Offline | Everything works; a small "Saved on this phone" badge. Never a spinner you can't dismiss |

Accessibility: ≥18 px base font, ≥48 px tap targets, no hover, no swipe-only actions, no timeouts on screens, undo for last action.

---

## 7. Architecture

```
/app
  index.html            // shell, loads /src/main.js (type=module)
  manifest.webmanifest  // name, icons, display=standalone, theme
  sw.js                 // cache-first shell, never cache data
  /src
    main.js             // router + boot
    /core               // PURE, no DOM, no storage — 100% unit-tested
      money.js          // §4 formulas (integer paise / hundredths)
      validate.js       // §6 rules as functions returning {ok, level, msg}
      model.js          // shapes, normalizers
    /data
      db.js             // IndexedDB wrapper (stores per entity), versioned migrations
      audit.js          // append-only log
      backup.js         // export JSON/CSV/XLSX, import, auto-daily export
    /ui                 // one file per screen, no arithmetic
    /i18n               // en.json, kn.json
  /tests
    /unit  /golden  /property  /e2e  /fixtures
```

**Stack default (phone-friendly, no build step):** plain ES modules + a tiny IndexedDB helper + CSS variables. Add Vite/TypeScript only if the harness handles a toolchain reliably; TypeScript is valuable for the `core/` module (branded `Paise` / `Hundredths` types).

**Persistence:** request `navigator.storage.persist()`; auto-export a dated JSON to Downloads and/or share-sheet at day close; weekly reminder to the owner. **v2 sync (optional):** one authoritative device (owner's) or a simple backend later; use append-only events so merges are trivial.

**Security-lite:** owner PIN (hashed), operators no PIN on a shared device but entries are timestamped and locked; every amendment logged; export file includes a checksum.

---

## 8. The harness design

### 8.1 Roles (one model can play several; separate *context*, not necessarily separate models)
| Role | Job | Reads | Writes |
|---|---|---|---|
| **Planner** | Turn a milestone into small slices with acceptance tests | spec, progress.md | plan.md |
| **Builder** | Implement one slice, test-first | plan.md, relevant skill, files touched | src + tests |
| **Verifier** | Re-derive expected numbers *independently* from the spec/fixtures (no sight of builder code) | spec, fixtures | verdict.md |
| **Reviewer** | Check UX rules, security, diff size, spec drift | diff, spec | review.md |
| **Scribe** | Update progress.md, changelog, decisions | everything | progress.md |

Independent verification matters most for `core/money.js`: the Verifier computes golden results by hand/another method and compares.

### 8.2 State files (the harness's memory — plain files, committed)
```
/harness
  spec.md          // this document
  plan.md          // current milestone slices
  progress.md      // done / doing / blocked, last green commit, open questions
  decisions.md     // rounding rule, sign conventions, etc. (append-only)
  fixtures/        // golden data as JSON
  skills/          // see §9
  loops.md         // the loop definitions below
```
Keep each file short; the harness should reload `progress.md` + current slice only, not the whole repo, to stay within a phone-sized context.

### 8.3 Loops

**Outer loop — milestone loop**
```
for milestone in M0..M6:
    plan   = Planner(milestone)               # slices, each with acceptance test
    for slice in plan:
        inner_loop(slice)                     # below
    run full suite + golden + e2e
    Verifier audits milestone
    if any red or Verifier disagrees: reopen slice, max 3 reopens → escalate to human
    Scribe updates progress.md; git tag milestone
```

**Inner loop — test-first slice loop (max 5 iterations)**
```
1. Write the failing test(s) from the acceptance criteria   (RED)
2. Run tests → must fail for the right reason
3. Implement minimum code                                   (GREEN)
4. Run tests → if red: read the failure, fix, go to 4 (count iteration)
5. Refactor with tests green
6. Run lint + full unit suite
7. Commit "slice: <name>" only when everything is green
If iteration > 5 or same failure twice: STOP → write blocker to progress.md → ask human
```

**Verification loop — independent check**
```
Verifier computes expected values for fixtures from the spec
Compare with app output; any diff > ₹1 (or any litre mismatch) → fail
Mutation pass: flip an operator (+/-, <, <=), drop a rounding step; tests MUST fail. If they pass, tests are weak → strengthen
```

**UX loop — operator walkthrough**
```
Scripted e2e of the 5-screen flow with a scripted "clumsy operator":
  wrong nozzle, typo closing, closing < opening, forgot Paytm, double tap, kill app mid-entry, go offline
Each must end in a safe, recoverable state. Capture screenshots; Reviewer checks font size, tap size, contrast, wording against §3/§6.
```

**Guard loop — drift & safety (runs every slice)**
```
- Diff size > 300 lines? split the slice
- Any float arithmetic on money? fail
- Any arithmetic in /ui? fail
- Any edit to tests/fixtures in the same commit as src without a decisions.md entry? fail
- Any network call or LLM call in runtime code? fail
```

**Stuck detector:** same error signature 2× or no new green test in 3 iterations → switch strategy (re-read skill, shrink slice, write a minimal repro), then escalate.

### 8.4 Harness rules
1. **Never weaken a test to make it pass.** Changing a test or fixture requires a `decisions.md` entry citing the business reason.
2. **Spec first, code second.** If the spec is ambiguous, add an Open Question and ask the human; don't guess money rules.
3. **One slice = one commit = green.** Revert rather than debug a red branch for more than 5 iterations.
4. **No dependencies without justification** (offline, tiny, auditable).
5. **Deterministic tests:** fixed dates/timezone (Asia/Kolkata), no network, no random without seed.
6. **Budget:** cap tokens/iterations per slice; log spend in progress.md.

---

## 11. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| **M0** | Spec lock | Open questions (§13) answered; fixtures G1–G7 in JSON |
| **M1** | `core/` money + validation | G1–G6 pass; property + mutation tests green |
| **M2** | Data layer | IndexedDB stores, migrations, audit log, export/import round-trip |
| **M3** | Operator flow (5 screens) | Clumsy-operator e2e passes, works offline, Kannada/English |
| **M4** | Owner mode | Day close, rates, flags, lock/amend, PIN |
| **M5** | Reports & export | Daily summary parity with Excel (G7), XLSX/CSV/JSON export, backups |
| **M6** | Pilot | 14-day shadow run, fixes, go-live |
| **M7 (optional)** | Photo-to-entry | See §12 |

Ship M1–M3 first: a working operator flow plus exact math is already useful.

---

## 13. Open questions to settle before M0

1. **Rounding rule** (§4.4): round once per operator-shift to the nearest rupee, truncate, or something else?
2. **"Can" line** (p.30, p.44): is ₹750 added to cash, and what is it?
3. **Credit litres labels** (S.O.T, N.S.S.O, others): list of fixed categories? Are they paid later (credit sales)? Should the app track who owes what?
4. **Deductions list:** watchman, can driver, mid-shift handover (₹9,700), small expenses — fixed picklist with signs?
5. **Testing nozzles:** which two are testing-only? The notebook shows a 741xxx nozzle with real sales and a 1321xxx nozzle that moves exactly 5 L.
6. **Shifts:** fixed numbering 1–3, or free (time-based)? Can an operator work two shifts in a day?
7. **Devices:** one shared phone at the pump, or each operator on their own?
8. **Operator list:** the 12 names (Kannada spelling) and whether names must be unique.
9. **Rates:** how often they change, and who enters them?
10. **Language:** Kannada-first labels? Any terms the staff already use that the UI should copy exactly?
