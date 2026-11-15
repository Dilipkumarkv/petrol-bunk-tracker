// M2 S3 commit 3 — concurrency, atomicity, property and clock suites.
//
// The meter is the only state that crosses operators, so a lost update here silently
// corrupts every later shift. These tests attack that specifically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTestRepos, prng } from './support/harness.mjs';
import { closeTurnInTx } from '../../app/src/data/repos/turns.js';
import { ERROR_CODES } from '../../app/src/data/errors.js';

const MS1 = 'nz-ms1';
const MS2 = 'nz-ms2';
const HSD1 = 'nz-hsd1';

const g6 = JSON.parse(
  readFileSync(new URL('../../harness/fixtures/g6-chain.json', import.meta.url), 'utf8'),
);

const firstEntry = (value) => ({ value, reason: 'FIRST_ENTRY' });

async function seeded(t, overrides) {
  const repos = await makeTestRepos(t, overrides);
  await repos.nozzles.seedDefaults();
  return repos;
}

/** Write a row straight into `turns`, simulating a second device that bypasses the API. */
function putRaw(db, row) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('turns', 'readwrite');
    tx.objectStore('turns').put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const draftRow = (over) => ({
  id: 'raw',
  shift_id: 'raw-shift',
  nozzle_id: MS1,
  operator_id: 'op-raw',
  status: 'draft',
  opening: 1000,
  closing: 2000,
  testing: 0,
  credits: [],
  seq: null,
  override: null,
  started_at: '2026-11-15T00:00:00.000Z',
  recorded_at: null,
  ...over,
});

test('CONCURRENCY: two closes racing on one nozzle — exactly one wins, the other is CHAIN_CONFLICT', async (t) => {
  const { turns, db } = await seeded(t);

  // Device A: a draft whose opening follows the (empty) chain.
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 2000);

  // Device B: a draft with a STALE opening, written straight to the store because the
  // API's NOZZLE_BUSY guard is per-device and cannot see the other tab.
  await putRaw(db, draftRow({ id: 'b', opening: 1500, closing: 3000 }));

  const results = await Promise.allSettled([turns.close('a'), turns.close('b')]);

  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');

  assert.equal(won.length, 1, 'exactly one close commits');
  assert.equal(lost.length, 1, 'exactly one close is refused');
  assert.equal(
    lost[0].reason.code,
    ERROR_CODES.CHAIN_CONFLICT,
    `the loser must get CHAIN_CONFLICT, got ${lost[0].reason.code}`,
  );

  // Exactly one closed turn exists, with seq 1 — no gap, no duplicate.
  const closed = (await turns.byShift('s1')).filter((row) => row.status === 'closed');
  const allClosed = [
    ...closed,
    ...(await turns.byShift('raw-shift')).filter((row) => row.status === 'closed'),
  ];
  assert.equal(allClosed.length, 1, 'only the winner is closed');
  assert.equal(allClosed[0].seq, 1);

  // The loser is untouched: still a draft, still no seq.
  const loserId = results[0].status === 'fulfilled' ? 'b' : 'a';
  const loser = await turns.get(loserId);
  assert.equal(loser.status, 'draft', 'the refused turn keeps its draft state');
  assert.equal(loser.seq, null, 'the refused turn was never given a seq');
});

test('ATOMICITY: a write inside closeTurnInTx does not survive an aborted transaction', async (t) => {
  const { turns, db } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 2000);

  const tx = db.transaction('turns', 'readwrite');
  const closed = await closeTurnInTx(tx, 'a', () => '2026-11-15T01:00:00.000Z', () => 'nope');
  assert.equal(closed.seq, 1, 'seq was computed inside the transaction');
  assert.equal(closed.status, 'closed');

  // Nothing has committed yet. A crash at this instant must lose the whole close.
  tx.abort();

  const after = await turns.get('a');
  assert.equal(after.status, 'draft', 'the aborted close left no closed turn');
  assert.equal(after.seq, null, 'no seq leaked out');
  assert.equal((await turns.byShift('s1')).filter((r) => r.status === 'closed').length, 0);
});

test('ATOMICITY: a refused close leaves the draft exactly as it was', async (t) => {
  const { turns, db } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 5000); // 40.00 L

  // testing + credits exceed the litres: written raw so setTesting cannot refuse it early,
  // which forces the check to fire inside the close transaction.
  await putRaw(db, { ...draftRow({ id: 'a', opening: 1000, closing: 5000 }), shift_id: 's1', operator_id: 'op', started_at: '2026-11-15T00:00:00.000Z', testing: 3000, credits: [{ label: 'S.O.T', litres: 1500 }] });

  await assert.rejects(turns.close('a'), (e) => e.code === ERROR_CODES.SALES_NEGATIVE);

  const draft = await turns.get('a');
  assert.equal(draft.status, 'draft', 'still open');
  assert.equal(draft.seq, null, 'no seq assigned');
  assert.equal(draft.closing, 5000, 'closing preserved');
  assert.equal(draft.testing, 3000, 'testing preserved');
  assert.equal(draft.credits.length, 1);
});

test('PROPERTY: random start/set/close sequences keep every chain contiguous', async (t) => {
  const { turns, meter } = await seeded(t);
  const rand = prng(20261115);
  const nozzleIds = [MS1, MS2, HSD1];
  const expectedSeq = new Map(nozzleIds.map((id) => [id, 0]));

  for (let step = 0; step < 40; step += 1) {
    const nozzleId = nozzleIds[Math.floor(rand() * nozzleIds.length)];
    const id = `t-${step}`;
    const last = await meter.lastClosing(nozzleId);

    await turns.start({
      id,
      shiftId: `s${step}`,
      nozzleId,
      operatorId: 'op',
      openingOverride: last ? null : firstEntry(1000 + Math.floor(rand() * 1000)),
    });

    const opening = (await turns.get(id)).opening;
    const litres = 1 + Math.floor(rand() * 500);
    await turns.setClosing(id, opening + litres);
    // testing must stay inside the litres sold, otherwise close is (correctly) refused
    await turns.setTesting(id, Math.floor(rand() * litres));

    const closed = await turns.close(id);
    const expected = expectedSeq.get(nozzleId) + 1;
    assert.equal(closed.seq, expected, `nozzle ${nozzleId} takes the next seq`);
    expectedSeq.set(nozzleId, expected);

    const chain = await meter.chain(nozzleId);
    assert.deepEqual(
      chain.map((row) => row.seq),
      Array.from({ length: chain.length }, (_, i) => i + 1),
      `seq is 1..N with no gaps on ${nozzleId}`,
    );
    for (let i = 1; i < chain.length; i += 1) {
      assert.equal(chain[i].opening, chain[i - 1].closing, `opening(n+1) = closing(n) on ${nozzleId}`);
    }
    assert.deepEqual(await meter.verifyChain(nozzleId), [], 'API-produced state is clean');
  }
});

test('PROPERTY: sum of litres = last closing - first opening, when the meter was never replaced', async (t) => {
  const { turns, meter } = await seeded(t);

  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(10000) });
  await turns.setClosing('a', 15000);
  await turns.close('a'); // 5000

  await turns.start({
    id: 'b',
    shiftId: 's2',
    nozzleId: MS1,
    operatorId: 'op2',
    openingOverride: { value: 15500, reason: 'GAP_ACKNOWLEDGED', note: 'handover slip' },
  });
  await turns.setClosing('b', 20000);
  await turns.close('b'); // 4500, gap 500

  const chain = await meter.chain(MS1);
  const report = await meter.verifyChain(MS1);
  const unaccounted = report
    .filter((row) => row.type === 'ACKNOWLEDGED_GAP')
    .reduce((sum, row) => sum + row.unaccounted, 0);

  const sumLitres = chain.reduce((sum, row) => sum + (row.closing - row.opening), 0);
  const lastClosing = (await meter.lastClosing(MS1)).closing;

  assert.equal(unaccounted, 500, 'the acknowledged gap is recorded, not hidden');
  assert.equal(sumLitres, 9500, '50.00 + 45.00 L');
  assert.equal(lastClosing - chain[0].opening, sumLitres + unaccounted, 'the meter identity holds');
});

test('PROPERTY: an acknowledged gap is reported, never silently swallowed', async (t) => {
  const { turns, meter } = await seeded(t);

  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 5000);
  await turns.close('a');

  await turns.start({
    id: 'b',
    shiftId: 's2',
    nozzleId: MS1,
    operatorId: 'op2',
    openingOverride: { value: 5300, reason: 'GAP_ACKNOWLEDGED', note: 'x' },
  });
  await turns.setClosing('b', 9000);
  await turns.close('b');

  await turns.start({
    id: 'c',
    shiftId: 's3',
    nozzleId: MS1,
    operatorId: 'op3',
    openingOverride: { value: 0, reason: 'METER_REPLACED', note: 'new meter' },
  });
  await turns.setClosing('c', 400);
  await turns.close('c');

  const report = await meter.verifyChain(MS1);
  assert.deepEqual(report.map((row) => row.type), ['ACKNOWLEDGED_GAP', 'ACKNOWLEDGED_REPLACEMENT']);
  assert.equal(report[0].unaccounted, 300);
});

test('CLOCK: a backwards clock never reorders the chain', async (t) => {
  const { turns, meter } = await seeded(t, {
    now: (() => {
      const stamps = [
        '2026-11-12T20:00:00+05:30',
        '2026-11-12T10:00:00+05:30',
        '2026-11-12T05:00:00+05:30',
      ];
      let i = 0;
      return () => stamps[Math.min(i++, stamps.length - 1)];
    })(),
  });

  for (const [index, expected] of g6.turns.entries()) {
    await turns.start({
      id: expected.id,
      shiftId: expected.shift_id,
      nozzleId: g6.nozzle_id,
      operatorId: expected.operator_id,
      openingOverride: index === 0 ? firstEntry(expected.opening) : null,
    });
    await turns.setClosing(expected.id, expected.closing);
    await turns.close(expected.id);
  }

  const chain = await meter.chain(g6.nozzle_id);
  assert.deepEqual(chain.map((row) => row.seq), [1, 2, 3], 'ordered by seq, not by clock');
  assert.deepEqual(chain.map((row) => row.closing), g6.turns.map((row) => row.closing));
  assert.deepEqual(await meter.verifyChain(g6.nozzle_id), []);
  assert.equal((await meter.lastClosing(g6.nozzle_id)).closing, g6.expected.last_closing);
});

/**
 * The unique `nozzle_seq` index is the last line of defence behind the in-transaction
 * chain check, so the API almost never reaches it. Drive the mapping directly with a
 * stub store that reports ConstraintError, rather than leave the branch untested.
 */
test('CONSTRAINT: a duplicate seq from the index surfaces as CHAIN_CONFLICT', async () => {
  const { ValidationError } = await import('../../app/src/data/errors.js');

  const turn = {
    id: 'stub-turn',
    nozzle_id: MS1,
    status: 'draft',
    opening: 1000,
    closing: 2000,
    testing: 0,
    credits: [],
    seq: null,
  };

  const request = (result) => {
    const req = { result, error: null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };

  const store = {
    get: () => request(turn),
    index: () => ({ getAll: () => request([]) }),
    put: () => {
      const req = { onsuccess: null, onerror: null, error: { name: 'ConstraintError' } };
      queueMicrotask(() => req.onerror?.());
      return req;
    },
  };
  const tx = { objectStore: () => store };

  let caught;
  try {
    await closeTurnInTx(tx, 'stub-turn', () => '2026-11-15T00:00:00.000Z', () => 'id-x');
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'the duplicate must not be swallowed');
  assert.equal(caught.code, ERROR_CODES.CHAIN_CONFLICT, 'mapped to CHAIN_CONFLICT, not a generic error');
  assert.ok(caught instanceof ValidationError);
});

