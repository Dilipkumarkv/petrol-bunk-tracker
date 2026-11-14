// Golden tests for core/money.js — nozzleSales (§4.1), fixtures from spec §5.
// Slice 1 acceptance: G1–G5 exact, credits and testing deducted, impossible input rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nozzleSales } from '../../app/src/core/money.js';

const golden = JSON.parse(
  readFileSync(new URL('../../harness/fixtures/golden.json', import.meta.url), 'utf8'),
);

const salesCases = golden.cases.filter((c) => !c.applies_to);
const byId = (id) => {
  const c = golden.cases.find((x) => x.id === id);
  assert.ok(c, `fixture ${id} missing`);
  return c;
};

const price = (c, turn) => nozzleSales(turn.opening_h, turn.closing_h, turn.testing_h, turn.credits_h, c.rate_paise);
const sumOf = (c, field) => c.turns.reduce((s, t) => s + price(c, t)[field], 0);

for (const c of salesCases) {
  test(`${c.id} — litres and exact amount match §5 (${c.label})`, () => {
    assert.equal(sumOf(c, 'litresH'), c.expected.litres_h, 'gross litres');
    assert.equal(sumOf(c, 'testingH'), c.expected.testing_h, 'testing litres');
    assert.equal(sumOf(c, 'creditH'), c.expected.credit_h, 'credit litres');
    assert.equal(sumOf(c, 'salesLitresH'), c.expected.sales_litres_h, 'net sales litres');
    assert.equal(sumOf(c, 'salesX100'), c.expected.amount_x100, 'exact amount (1/100 paise)');
  });

  test(`${c.id} — whole rupees agree with the paper figure`, () => {
    const rupees = Math.floor(sumOf(c, 'salesX100') / 10000);
    // G5 is recorded in §5 as "≈ ₹390" (rounded); every other paper figure is a truncation.
    if (c.id === 'G5') {
      assert.ok(Math.abs(rupees - c.expected.paper_rupees) <= 1, `got ₹${rupees}`);
    } else {
      assert.equal(rupees, c.expected.paper_rupees);
    }
  });
}

test('G1 — every per-nozzle turn is an integer with no float leak', () => {
  const c = byId('G1');
  for (const t of c.turns) {
    const r = price(c, t);
    for (const field of ['litresH', 'testingH', 'creditH', 'salesLitresH', 'salesX100']) {
      assert.ok(Number.isInteger(r[field]), `${field} must be an integer, got ${r[field]}`);
    }
    assert.equal(r.openingH, t.opening_h);
    assert.equal(r.closingH, t.closing_h);
    assert.equal(r.ratePaise, c.rate_paise);
  }
});

test('G4 — each credit line is deducted, and they sum to 283.74 L', () => {
  const c = byId('G4');
  const t = c.turns[0];
  const r = price(c, t);
  assert.equal(r.creditH, 28374);
  assert.equal(r.litresH, 69453);
  assert.equal(r.salesLitresH, 69453 - 28374);
  assert.equal(r.salesX100, 41079 * c.rate_paise);
});

test('G5 — testing fuel is not sold', () => {
  const c = byId('G5');
  const t = c.turns[0];
  assert.equal(price(c, t).salesLitresH, 324);
  assert.equal(price(c, { ...t, testing_h: 0 }).salesLitresH, 824);
});

test('splitting an operator across nozzle turns does not change the total (§10.3)', () => {
  // G4 computed as three separate turns vs one combined virtual turn.
  const c = byId('G4');
  const combined = nozzleSales(
    c.turns[0].opening_h,
    c.turns[0].opening_h + c.expected.litres_h,
    0,
    c.turns[0].credits_h,
    c.rate_paise,
  );
  assert.equal(combined.salesX100, sumOf(c, 'salesX100'));
});

test('allocating the G1 test litres to a different nozzle leaves the total unchanged', () => {
  const c = byId('G1');
  const asFixture = sumOf(c, 'salesX100');
  const moved = c.turns.map((t, i) => ({ ...t, testing_h: i === 0 ? 1560 : 0 }));
  const total = moved.reduce((s, t) => s + nozzleSales(t.opening_h, t.closing_h, t.testing_h, t.credits_h, c.rate_paise).salesX100, 0);
  assert.equal(total, asFixture);
});

test('optional arguments default to no testing and no credits', () => {
  const c = byId('G2');
  const t = c.turns[0];
  const withDefaults = nozzleSales(t.opening_h, t.closing_h, undefined, undefined, c.rate_paise);
  assert.equal(withDefaults.testingH, 0);
  assert.equal(withDefaults.creditH, 0);
  assert.equal(withDefaults.salesLitresH, withDefaults.litresH);
});

test('closing < opening is rejected, not silently turned into money (§4.1, §6)', () => {
  assert.throws(() => nozzleSales(1002988, 1000000, 0, [], 11086), /closing/i);
});

test('closing == opening is allowed — zero litres is valid; validate.js will warn (§4.1, §6)', () => {
  const r = nozzleSales(1002988, 1002988, 0, [], 11086);
  assert.equal(r.litresH, 0);
  assert.equal(r.salesLitresH, 0);
  assert.equal(r.salesX100, 0);
});

test('non-integer or negative input is rejected — no floats in the money path', () => {
  assert.throws(() => nozzleSales(1000000.5, 1002988, 0, [], 11086), TypeError);
  assert.throws(() => nozzleSales(1000000, 1002988, 0, [], 110.86), TypeError);
  assert.throws(() => nozzleSales(1000000, 1002988, 0, [], -11086), RangeError);
  assert.throws(() => nozzleSales(1000000, 1002988, -500, [], 11086), RangeError);
  assert.throws(() => nozzleSales(1000000, 1002988, 0, [-20], 11086), RangeError);
  assert.throws(() => nozzleSales(1000000, 1002988, 0, [null], 11086), TypeError);
});

test('testing plus credits may exceed litres only by throwing, never by negative sales', () => {
  // 29.88 L gross, but 15.60 L tested and 20.00 L credited.
  assert.throws(() => nozzleSales(1000000, 1002988, 1560, [2000], 11086), /negative/i);
});
