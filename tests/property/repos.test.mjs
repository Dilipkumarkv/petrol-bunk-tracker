// S2 · property tests (brief §6) — invariants over generated inputs, seeded PRNG.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestRepos, prng } from '../unit/support/harness.mjs';
import { normalizeName } from '../../app/src/data/repos/text.js';

const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ACCENTED = 'éèüñçÇà';
const KANNADA = 'ರಾಜುಸುರೇಶಅನಿಲ';
const SPACE = '  ';

function randomName(rand, maxLen = 10) {
  const pools = [LATIN, LATIN, KANNADA, ACCENTED];
  const len = 1 + Math.floor(rand() * maxLen);
  let out = '';
  let pool = pools[Math.floor(rand() * pools.length)];
  for (let i = 0; i < len; i += 1) {
    if (rand() < 0.08) {
      pool = pools[Math.floor(rand() * pools.length)];
      out += SPACE[Math.floor(rand() * SPACE.length)];
      continue;
    }
    out += [...pool][Math.floor(rand() * [...pool].length)];
  }
  return out;
}

test('normalize is idempotent for random strings', () => {
  const rand = prng(1);
  for (let i = 0; i < 300; i += 1) {
    const raw = randomName(rand);
    const once = normalizeName(raw);
    assert.equal(normalizeName(once), once, `not idempotent for ${JSON.stringify(raw)}`);
  }
});

test('upsertByName(upsertByName(x).name) is idempotent for random names', async (t) => {
  const { operators } = await makeTestRepos(t);
  const rand = prng(2);
  const seen = new Map();

  for (let i = 0; i < 40; i += 1) {
    const raw = randomName(rand);
    const first = await operators.upsertByName(raw);
    const second = await operators.upsertByName(first.operator.name);

    assert.equal(second.created, false, `second upsert of ${JSON.stringify(raw)} created a row`);
    assert.equal(second.operator.id, first.operator.id);

    const norm = first.operator.nameNorm;
    if (seen.has(norm)) {
      assert.equal(seen.get(norm), first.operator.id, `two ids for nameNorm ${norm}`);
    }
    seen.set(norm, first.operator.id);
  }

  const rows = await operators.list({ activeOnly: false });
  assert.equal(rows.length, seen.size, 'one row per distinct nameNorm');
});

test('rates.current equals a brute-force scan of history for random rate sets', async (t) => {
  const { rates } = await makeTestRepos(t);
  const rand = prng(3);
  const products = ['Petrol', 'Diesel', 'XP'];
  const dates = [];

  for (let i = 0; i < 24; i += 1) {
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    dates.push(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  const unique = [...new Set(dates)].sort();

  for (const product of products) {
    for (const date of unique) {
      const price = 9000 + Math.floor(rand() * 3000);
      await rates.add(product, price, date);
    }
  }

  for (const product of products) {
    const history = await rates.history(product); // newest first
    for (const probe of [...unique, '2025-12-31', '2027-06-15']) {
      const expected = history.find((r) => r.effective_from <= probe);
      if (!expected) {
        await assert.rejects(() => rates.current(product, probe), (err) => err.code === 'RATE_MISSING');
        continue;
      }
      const actual = await rates.current(product, probe);
      assert.equal(actual.price_paise, expected.price_paise, `${product} on ${probe}`);
      assert.equal(actual.effective_from, expected.effective_from);
    }
  }
});

test('seeding twice is idempotent for any number of runs', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  for (let i = 0; i < 3; i += 1) await nozzles.seedDefaults();
  assert.equal((await nozzles.list({ activeOnly: false })).length, 10);
});
