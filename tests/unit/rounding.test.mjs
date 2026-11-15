// Unit tests for the rounding primitives and the flag tolerance (§4.2, §4.4).
// Boundaries only — the golden figures live in tests/golden/rounding.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundToRupees,
  shiftSales,
  flagFor,
  policyFor,
  DEFAULT_TOLERANCE_PAISE,
  X100_PER_RUPEE,
} from '../../app/src/core/money.js';

test('one rupee is 10,000 units of 1/100 paise', () => {
  assert.equal(X100_PER_RUPEE, 10000);
});

test('truncate drops any fraction of a rupee', () => {
  assert.equal(roundToRupees(0, 'truncate'), 0);
  assert.equal(roundToRupees(9999, 'truncate'), 0); // ₹0.9999 -> ₹0
  assert.equal(roundToRupees(10000, 'truncate'), 100); // ₹1.00 -> ₹1
  assert.equal(roundToRupees(19999, 'truncate'), 100); // ₹1.9999 -> ₹1
  assert.equal(roundToRupees(20000, 'truncate'), 200);
});

test('half-up rounds .50 and above up, below that down', () => {
  assert.equal(roundToRupees(14999, 'half-up'), 100); // ₹1.4999 -> ₹1
  assert.equal(roundToRupees(15000, 'half-up'), 200); // ₹1.50 exactly -> ₹2
  assert.equal(roundToRupees(15001, 'half-up'), 200); // ₹1.5001 -> ₹2
  assert.equal(roundToRupees(10000, 'half-up'), 100);
  assert.equal(roundToRupees(9999, 'half-up'), 100); // ₹0.9999 -> ₹1
});

test('both policies are exact integer arithmetic on large amounts', () => {
  // 9,007,199,254 x100 = ₹900,719.9254 — well inside the safe range, still exact.
  const big = 9007199254;
  assert.equal(roundToRupees(big, 'truncate'), 90071900); // ₹900,719
  assert.equal(roundToRupees(big, 'half-up'), 90072000); // .9254 -> ₹900,720
  assert.ok(Number.isInteger(roundToRupees(big, 'truncate')));
});

test('an unknown product or policy is rejected, never guessed', () => {
  assert.throws(() => policyFor('Kerosene'), /rounding/i);
  assert.throws(() => roundToRupees(10000, 'banker'), /policy/i);
});

test('negative or non-integer amounts are rejected', () => {
  assert.throws(() => roundToRupees(-1, 'truncate'), RangeError);
  assert.throws(() => roundToRupees(10.5, 'truncate'), TypeError);
  assert.throws(() => roundToRupees('1000', 'truncate'), TypeError);
});

test('shiftSales groups by product and rejects malformed turns', () => {
  const turns = [
    { product: 'Petrol', ratePaise: 100, salesLitresH: 10000, salesX100: 1000000 },
    { product: 'Petrol', ratePaise: 100, salesLitresH: 5000, salesX100: 500000 },
  ];
  const shift = shiftSales(turns);
  assert.equal(shift.groups.length, 1);
  assert.equal(shift.groups[0].salesLitresH, 15000, 'litres summed per product');
  assert.equal(shift.groups[0].exactX100, 1500000);
  assert.equal(shift.totalPaise, 15000);

  assert.throws(() => shiftSales([{ product: 'Kerosene', salesLitresH: 1, salesX100: 100 }]), /rounding/i);
  assert.throws(() => shiftSales([{ product: 'Petrol', salesX100: 1 }]), TypeError);
  assert.throws(() => shiftSales('nope'), TypeError);
});

test('an empty shift is zero, not an error', () => {
  const shift = shiftSales([]);
  assert.equal(shift.totalPaise, 0);
  assert.deepEqual(shift.groups, []);
});

test('flag tolerance is ±₹1 inclusive at the boundary (§4.2)', () => {
  assert.equal(DEFAULT_TOLERANCE_PAISE, 100);
  assert.equal(flagFor(-101), 'SHORT');
  assert.equal(flagFor(-100), 'SHORT', 'exactly ₹1 short is still SHORT');
  assert.equal(flagFor(-99), 'OK');
  assert.equal(flagFor(0), 'OK');
  assert.equal(flagFor(99), 'OK');
  assert.equal(flagFor(100), 'EXCESS', 'exactly ₹1 excess is still EXCESS');
  assert.equal(flagFor(101), 'EXCESS');
});

test('a wider owner-configured tolerance moves both boundaries', () => {
  assert.equal(flagFor(-250, 500), 'OK');
  assert.equal(flagFor(500, 500), 'EXCESS');
  assert.equal(flagFor(-500, 500), 'SHORT');
  assert.throws(() => flagFor(0, -1), RangeError);
});
