// S2 · rates repository (brief §4). Append-only; integers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestRepos, expectCode } from './support/harness.mjs';
import { ERROR_CODES } from '../../app/src/data/errors.js';

test('a rate applies from its effective date onwards', async (t) => {
  const { rates } = await makeTestRepos(t);
  await rates.add('Petrol', 11086, '2026-11-01');

  assert.equal((await rates.current('Petrol', '2026-11-13')).price_paise, 11086);
});

test('the latest rate on or before the date wins, and past days keep the old rate', async (t) => {
  const { rates } = await makeTestRepos(t);
  await rates.add('Petrol', 11086, '2026-11-01');
  await rates.add('Petrol', 11200, '2026-11-14');

  assert.equal((await rates.current('Petrol', '2026-11-13')).price_paise, 11086, 'before the change');
  assert.equal((await rates.current('Petrol', '2026-11-14')).price_paise, 11200, 'on the effective day');
  assert.equal((await rates.current('Petrol', '2026-11-20')).price_paise, 11200, 'after');
});

test('a date before the first rate throws RATE_MISSING, never returns 0', async (t) => {
  const { rates } = await makeTestRepos(t);
  await rates.add('Petrol', 11086, '2026-11-01');

  await expectCode(rates.current('Petrol', '2026-10-31'), ERROR_CODES.RATE_MISSING);
  await expectCode(rates.current('Diesel', '2026-11-13'), ERROR_CODES.RATE_MISSING);
});

test('products are independent — an XP rate never leaks into Petrol', async (t) => {
  const { rates } = await makeTestRepos(t);
  await rates.add('Petrol', 11086, '2026-11-01');
  await rates.add('XP', 12034, '2026-11-01');
  await rates.add('XP', 12100, '2026-11-20');

  assert.equal((await rates.current('Petrol', '2026-11-25')).price_paise, 11086);
  assert.equal((await rates.current('XP', '2026-11-25')).price_paise, 12100);
  assert.equal((await rates.history('Petrol')).length, 1);
  assert.equal((await rates.history('XP')).length, 2);
});

test('same product and date is a duplicate — rates are append-only', async (t) => {
  const { rates } = await makeTestRepos(t);
  await rates.add('Diesel', 9877, '2026-11-01');

  await expectCode(rates.add('Diesel', 9900, '2026-11-01'), ERROR_CODES.RATE_DUPLICATE);
  // the first rate was not overwritten
  assert.equal((await rates.current('Diesel', '2026-11-01')).price_paise, 9877);
});

test('prices must be positive integers — floats and strings are rejected', async (t) => {
  const { rates } = await makeTestRepos(t);
  for (const bad of [110.86, 11086.5, 0, -1, '11086', null, undefined, NaN, Infinity]) {
    await expectCode(rates.add('Petrol', bad, '2026-11-01'), ERROR_CODES.RATE_INVALID_PRICE);
  }
  await rates.add('Petrol', 1, '2026-11-01');
  assert.equal((await rates.current('Petrol', '2026-11-01')).price_paise, 1, '₹0.01 is legal');
});

test('dates must be real ISO calendar days', async (t) => {
  const { rates } = await makeTestRepos(t);
  for (const bad of ['2026-13-01', '2026-02-30', '2026-2-1', '01-11-2026', '2026-11-01T00:00', '', null]) {
    await expectCode(rates.add('Petrol', 11086, bad), ERROR_CODES.RATE_INVALID_DATE);
  }
  await rates.add('Petrol', 11086, '2024-02-29');
  assert.equal((await rates.current('Petrol', '2024-02-29')).price_paise, 11086, 'leap day is valid');
});

test('unknown products are rejected rather than stored', async (t) => {
  const { rates } = await makeTestRepos(t);
  await expectCode(rates.add('Kerosene', 11086, '2026-11-01'), ERROR_CODES.RATE_UNKNOWN_PRODUCT);
  await expectCode(rates.current('Kerosene', '2026-11-01'), ERROR_CODES.RATE_UNKNOWN_PRODUCT);
});

test('history is newest first and records when the rate was entered', async (t) => {
  const { rates } = await makeTestRepos(t);
  await rates.add('Petrol', 11086, '2026-11-01');
  await rates.add('Petrol', 11200, '2026-11-14');

  const history = await rates.history('Petrol');
  assert.deepEqual(history.map((r) => r.effective_from), ['2026-11-14', '2026-11-01']);
  assert.equal(typeof history[0].created_at, 'string', 'created_at comes from the injected clock');
  assert.notEqual(history[0].created_at, history[1].created_at, 'fixed clock advances');
});
