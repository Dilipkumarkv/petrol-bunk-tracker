// Golden tests for the owner-confirmed rounding rule (2026-11-15, OQ-1 closed).
//
// Rule:
//   Petrol & Diesel : per operator-shift, per product: sum net litres, x rate,
//                     TRUNCATE to whole rupees
//   XP              : round half-up to whole rupees (.50 and above up)
//   internal math   : exact integer hundredths-of-litre x integer paise/L
//   tolerance       : +/- 1 rupee at flag time
//
// Fixtures are read, never written. harness/fixtures/golden.json already carries
// `paper_rupees`, which is exactly the value this rule has to reproduce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nozzleSales, shiftSales, roundToRupees, ROUNDING_POLICY } from '../../app/src/core/money.js';

const golden = JSON.parse(
  readFileSync(new URL('../../harness/fixtures/golden.json', import.meta.url), 'utf8'),
);
const salesCases = golden.cases.filter((c) => !c.applies_to);

/** Turn the fixture's nozzle turns into core turns with their exact amounts. */
function turnsOf(c) {
  return c.turns.map((t) => {
    const r = nozzleSales(t.opening_h, t.closing_h, t.testing_h, t.credits_h, c.rate_paise);
    return {
      product: c.product,
      ratePaise: c.rate_paise,
      salesLitresH: r.salesLitresH,
      salesX100: r.salesX100,
    };
  });
}

test('the confirmed policy is truncate for Petrol and Diesel, half-up for XP', () => {
  assert.deepEqual(ROUNDING_POLICY, { Petrol: 'truncate', Diesel: 'truncate', XP: 'half-up' });
});

for (const c of salesCases) {
  test(`${c.id} — rounded to the paper figure (${c.product}, ${c.label})`, () => {
    const turns = turnsOf(c);
    const shift = shiftSales(turns);

    assert.equal(
      shift.totalPaise,
      c.expected.paper_rupees * 100,
      `${c.id} rounds to ₹${c.expected.paper_rupees} (paper figure)`,
    );
    assert.equal(shift.groups.length, 1, 'one product means one rounding group');
    assert.equal(shift.groups[0].policy, ROUNDING_POLICY[c.product]);
    assert.equal(
      shift.groups[0].exactX100,
      c.expected.amount_x100,
      'the exact amount is preserved before rounding',
    );
    assert.ok(Number.isInteger(shift.totalPaise), 'rounded money is integer paise');
  });
}

test('rounding never moves a shift total by more than ₹1 per product group', () => {
  for (const c of salesCases) {
    const shift = shiftSales(turnsOf(c));
    for (const group of shift.groups) {
      // delta is kept in exact 1/100-paise units, so no float is involved
      const deltaX100 = group.roundedPaise * 100 - group.exactX100;
      assert.ok(
        Math.abs(deltaX100) < 10000,
        `${c.id} ${group.product}: rounding delta ${deltaX100 / 10000} must stay under ₹1`,
      );
    }
  }
});

test('rounding is per product, not on the combined shift total', () => {
  // ₹100.90 of Petrol and ₹100.90 of Diesel. Truncating each group gives ₹100 + ₹100.
  const turns = [
    { product: 'Petrol', ratePaise: 100, salesLitresH: 10090, salesX100: 1009000 },
    { product: 'Diesel', ratePaise: 100, salesLitresH: 10090, salesX100: 1009000 },
  ];
  const shift = shiftSales(turns);

  assert.equal(shift.groups.length, 2, 'one group per product');
  assert.equal(shift.totalPaise, 20000, '₹200 — each product truncated separately');
  // Rounding the combined ₹201.80 would have given ₹201, which the rule forbids.
  assert.notEqual(shift.totalPaise, 20100);
});

test('XP in the same shift rounds half-up while diesel truncates', () => {
  const turns = [
    { product: 'Diesel', ratePaise: 100, salesLitresH: 10060, salesX100: 1006000 }, // ₹100.60
    { product: 'XP', ratePaise: 100, salesLitresH: 10060, salesX100: 1006000 }, // ₹100.60
  ];
  const shift = shiftSales(turns);
  const byProduct = Object.fromEntries(shift.groups.map((g) => [g.product, g.roundedPaise]));

  assert.equal(byProduct.Diesel, 10000, 'Diesel truncates ₹100.60 to ₹100');
  assert.equal(byProduct.XP, 10100, 'XP rounds ₹100.60 up to ₹101');
  assert.equal(shift.totalPaise, 20100);
});

test('p.27 known exception: 17,709.885 truncated to 17,709 vs 17,710 written', () => {
  // 159.75 L x ₹110.86 = ₹17,709.885. The owner confirmed truncation, so the app
  // produces ₹17,709 and the ₹1 gap to the paper is absorbed by the tolerance.
  const litresH = 15975;
  const ratePaise = 11086;
  const amountX100 = litresH * ratePaise;
  assert.equal(amountX100, 177098850, 'exact amount is 17,709.885');

  const paise = roundToRupees(amountX100, 'truncate');
  assert.equal(paise, 1770900, 'truncates to ₹17,709');
  assert.equal(Math.abs(paise - 1771000), 100, 'the documented ₹1 exception, inside tolerance');
});
