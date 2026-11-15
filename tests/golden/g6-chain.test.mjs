// Golden G6 — the real meter chain from the 12-Nov sheet (MS1).
// The meter is the ONLY state that carries between operators: each opening must be
// the previous closing, filled in automatically, and ordered by seq.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTestRepos } from '../unit/support/harness.mjs';

const g6 = JSON.parse(readFileSync(new URL('../../harness/fixtures/g6-chain.json', import.meta.url), 'utf8'));

test('G6 — a three-operator chain on one nozzle, openings filled automatically', async (t) => {
  const { turns, meter, nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();

  const closedTurns = [];
  for (const [index, expected] of g6.turns.entries()) {
    const started = await turns.start({
      id: expected.id,
      shiftId: expected.shift_id,
      nozzleId: g6.nozzle_id,
      operatorId: expected.operator_id,
      // only the first turn needs an override; the rest must be computed
      openingOverride: index === 0 ? { value: expected.opening, reason: 'FIRST_ENTRY' } : null,
    });

    assert.equal(started.opening, expected.opening, `turn ${expected.seq} opening`);
    assert.equal(started.status, 'draft');

    await turns.setClosing(expected.id, expected.closing);
    const closed = await turns.close(expected.id);
    assert.equal(closed.seq, expected.seq, `turn ${expected.seq} seq`);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closing, expected.closing);
    assert.equal(closed.closing - closed.opening, expected.litres, `turn ${expected.seq} litres`);

    closedTurns.push(closed);
  }

  // the openings of turns 2 and 3 were never typed by a caller
  assert.equal(closedTurns[1].opening, g6.turns[0].closing);
  assert.equal(closedTurns[2].opening, g6.turns[1].closing);

  assert.deepEqual(await meter.verifyChain(g6.nozzle_id), [], 'a clean notebook chain verifies');
  assert.deepEqual((await meter.chain(g6.nozzle_id)).map((row) => row.seq), [1, 2, 3]);

  const last = await meter.lastClosing(g6.nozzle_id);
  assert.deepEqual(last, { closing: g6.expected.last_closing, seq: 3, turnId: 'g6-3' });

  const totalLitres = closedTurns.reduce((sum, turn) => sum + (turn.closing - turn.opening), 0);
  assert.equal(totalLitres, g6.expected.total_litres, '55.47 + 51.61 + 42.90 L');
  assert.equal(
    g6.expected.last_closing - g6.expected.first_opening,
    g6.expected.total_litres,
    'the fixture itself is self-consistent',
  );
});

test('G6 — the chain is rebuilt by seq even if the clock disagrees', async (t) => {
  // A clock that runs backwards must not reorder the chain.
  const { turns, meter, nozzles } = await makeTestRepos(t, {
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
  await nozzles.seedDefaults();

  for (const [index, expected] of g6.turns.entries()) {
    await turns.start({
      id: expected.id,
      shiftId: expected.shift_id,
      nozzleId: g6.nozzle_id,
      operatorId: expected.operator_id,
      openingOverride: index === 0 ? { value: expected.opening, reason: 'FIRST_ENTRY' } : null,
    });
    await turns.setClosing(expected.id, expected.closing);
    await turns.close(expected.id);
  }

  const chain = await meter.chain(g6.nozzle_id);
  assert.deepEqual(chain.map((row) => row.seq), [1, 2, 3]);
  assert.deepEqual(chain.map((row) => row.closing), g6.turns.map((row) => row.closing));
  assert.deepEqual(await meter.verifyChain(g6.nozzle_id), []);
  assert.equal((await meter.lastClosing(g6.nozzle_id)).closing, g6.expected.last_closing);
});
