// Core validation for litres (§6 rules) — pure, no storage, no error-code dependency.
// The data layer maps `code` to its own ERROR_CODES table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInteger, validateCredits, validateTurnClose } from '../../app/src/core/validate.js';

test('integers only — floats, strings, NaN and Infinity are all rejected', () => {
  for (const bad of [1.5, '123', NaN, Infinity, null, undefined, {}, []]) {
    const result = validateInteger(bad, 'closing');
    assert.equal(result.ok, false, `${String(bad)} must be rejected`);
    assert.equal(result.code, 'NOT_INTEGER');
  }
  assert.equal(validateInteger(0, 'closing').ok, true);
  assert.equal(validateInteger(164963319, 'closing').ok, true);
});

test('negatives get their own code, not NOT_INTEGER', () => {
  const result = validateInteger(-1, 'closing');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NEGATIVE');
});

test('credits must be a list of non-negative integer litres', () => {
  assert.equal(validateCredits([]).ok, true);
  assert.equal(validateCredits([{ label: 'S.O.T', litres: 12915 }]).ok, true);
  assert.equal(validateCredits([{ label: 'x', litres: -1 }]).code, 'NEGATIVE');
  assert.equal(validateCredits([{ label: 'x', litres: 1.5 }]).code, 'NOT_INTEGER');
  assert.equal(validateCredits('nope').ok, false);
  assert.equal(validateCredits([{ label: 'x' }]).ok, false);
});

test('closing below opening is blocked; equal is allowed with a warning', () => {
  assert.equal(validateTurnClose({ opening: 100, closing: 99 }).code, 'CLOSING_BELOW_OPENING');

  const equal = validateTurnClose({ opening: 100, closing: 100 });
  assert.equal(equal.ok, true, 'zero litres is legal');
  assert.equal(equal.level, 'warn', 'but the operator is warned');
  assert.equal(equal.code, 'ZERO_LITRES');

  assert.equal(validateTurnClose({ opening: 100, closing: 101 }).ok, true);
});

test('testing plus credits may not exceed the litres sold', () => {
  const base = { opening: 1000, closing: 3000, testing: 0, credits: [] }; // 20.00 L
  assert.equal(validateTurnClose(base).ok, true);
  assert.equal(validateTurnClose({ ...base, testing: 2000 }).ok, true, 'exactly all of it tested');
  assert.equal(validateTurnClose({ ...base, testing: 2001 }).code, 'SALES_NEGATIVE');
  assert.equal(
    validateTurnClose({ ...base, testing: 500, credits: [{ label: 'x', litres: 1501 }] }).code,
    'SALES_NEGATIVE',
    'testing and credits add up',
  );
});

test('every rejection carries a message a screen could show', () => {
  const cases = [
    validateInteger(1.5, 'closing'),
    validateTurnClose({ opening: 100, closing: 99 }),
    validateTurnClose({ opening: 0, closing: 10, testing: 11 }),
  ];
  for (const result of cases) {
    assert.equal(result.ok, false);
    assert.equal(typeof result.msg, 'string');
    assert.ok(result.msg.length > 0);
  }
});
