// S3 commit 2 — turns repository unit behaviour (brief §3 rules 1–12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestRepos, expectCode } from './support/harness.mjs';
import { ERROR_CODES } from '../../app/src/data/errors.js';

const MS1 = 'nz-ms1';
const MS2 = 'nz-ms2';
const HSD1 = 'nz-hsd1';

async function seeded(t, overrides = {}) {
  const repos = await makeTestRepos(t, overrides);
  await repos.nozzles.seedDefaults();
  return repos;
}

const firstEntry = (value) => ({ value, reason: 'FIRST_ENTRY' });

test('first turn needs a FIRST_ENTRY override', async (t) => {
  const { turns } = await seeded(t);
  await expectCode(turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op' }), ERROR_CODES.OPENING_REQUIRED);

  const turn = await turns.start({
    id: 'a',
    shiftId: 's1',
    nozzleId: MS1,
    operatorId: 'op',
    openingOverride: firstEntry(164957772),
  });
  assert.equal(turn.opening, 164957772);
  assert.deepEqual(turn.override, { reason: 'FIRST_ENTRY', unaccounted: null, note: null });
  assert.equal(turn.status, 'draft');
  assert.equal(turn.seq, null);
  assert.equal(turn.recorded_at, null);
});

test('a caller-supplied opening is ignored while a chain exists', async (t) => {
  const { turns } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 5000);
  await turns.close('a');

  const next = await turns.start({ id: 'b', shiftId: 's2', nozzleId: MS1, operatorId: 'op2' });
  assert.equal(next.opening, 5000, 'computed from the previous closing');
  assert.equal(next.override, null);
});

test('an override with no reason, or FIRST_ENTRY on an existing chain, is a CHAIN_BREAK', async (t) => {
  const { turns } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 5000);
  await turns.close('a');

  await expectCode(
    turns.start({ id: 'b', shiftId: 's2', nozzleId: MS1, operatorId: 'op', openingOverride: { value: 6000 } }),
    ERROR_CODES.CHAIN_BREAK,
  );
  await expectCode(
    turns.start({ id: 'c', shiftId: 's2', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(6000) }),
    ERROR_CODES.CHAIN_BREAK,
  );
});

test('GAP_ACKNOWLEDGED records the unaccounted litres as an acknowledgement', async (t) => {
  const { turns, meter } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 5000);
  await turns.close('a');

  const gap = await turns.start({
    id: 'b',
    shiftId: 's2',
    nozzleId: MS1,
    operatorId: 'op2',
    openingOverride: { value: 5300, reason: 'GAP_ACKNOWLEDGED', note: 'handover slip' },
  });
  assert.equal(gap.opening, 5300);
  assert.equal(gap.override.unaccounted, 300, '5300 - 5000, the missing litres');
  assert.equal(gap.override.note, 'handover slip');

  await turns.setClosing('b', 9000);
  await turns.close('b');

  const report = await meter.verifyChain(MS1);
  assert.equal(report.length, 1, 'an acknowledged gap is reported, not an error');
  assert.equal(report[0].type, 'ACKNOWLEDGED_GAP');
  assert.equal(report[0].unaccounted, 300);
});

test('METER_REPLACED restarts the chain on the new meter', async (t) => {
  const { turns, meter } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 5000);
  await turns.close('a');

  await turns.start({
    id: 'b',
    shiftId: 's2',
    nozzleId: MS1,
    operatorId: 'op2',
    openingOverride: { value: 0, reason: 'METER_REPLACED', note: 'new meter fitted' },
  });
  await turns.setClosing('b', 400);
  await turns.close('b');

  const next = await turns.start({ id: 'c', shiftId: 's3', nozzleId: MS1, operatorId: 'op3' });
  assert.equal(next.opening, 400, 'the chain follows the new meter');

  const report = await meter.verifyChain(MS1);
  assert.equal(report.length, 1);
  assert.equal(report[0].type, 'ACKNOWLEDGED_REPLACEMENT');
});

test('drafts never affect lastClosing, and nozzles are independent', async (t) => {
  const { turns, meter } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 5000);
  await turns.close('a');

  // a second nozzle starts its own chain at 1
  await turns.start({ id: 'b', shiftId: 's1', nozzleId: MS2, operatorId: 'op', openingOverride: firstEntry(2000) });
  await turns.setClosing('b', 2500);
  const closedB = await turns.close('b');
  assert.equal(closedB.seq, 1, 'per-nozzle numbering');

  // an open draft on MS1 must not move lastClosing
  await turns.start({ id: 'c', shiftId: 's2', nozzleId: MS1, operatorId: 'op2' });
  await turns.setClosing('c', 9000);
  const last = await meter.lastClosing(MS1);
  assert.deepEqual(last, { closing: 5000, seq: 1, turnId: 'a' });

  assert.deepEqual(await meter.lastClosing(HSD1), null, 'a nozzle with no history');
});

test('one open draft per nozzle — a second shift is NOZZLE_BUSY, a restart is idempotent', async (t) => {
  const { turns } = await seeded(t);
  const first = await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });

  const again = await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  assert.equal(again.id, first.id, 'same id + same shift is a no-op');
  assert.equal(again.opening, 1000);

  await expectCode(
    turns.start({ id: 'b', shiftId: 's2', nozzleId: MS1, operatorId: 'op2' }),
    ERROR_CODES.NOZZLE_BUSY,
  );
});

test('closing below the opening is blocked; equal is allowed', async (t) => {
  const { turns } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(5000) });

  await expectCode(turns.setClosing('a', 4999), ERROR_CODES.CLOSING_BELOW_OPENING);
  await turns.setClosing('a', 5000);
  const closed = await turns.close('a');
  assert.equal(closed.closing, closed.opening);
});

test('late testing or credits that exceed the litres are refused at close', async (t) => {
  const { turns } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 2000); // 10.00 L
  await turns.setTesting('a', 600);
  await turns.setCredits('a', [{ label: 'S.O.T', litres: 500 }]);
  await expectCode(turns.close('a'), ERROR_CODES.SALES_NEGATIVE);

  await turns.setCredits('a', [{ label: 'S.O.T', litres: 400 }]);
  await turns.close('a');
});

test('floats, strings, NaN and negatives are rejected everywhere', async (t) => {
  const { turns } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });

  for (const bad of [1.5, '2000', NaN, Infinity]) {
    await expectCode(turns.setClosing('a', bad), ERROR_CODES.NOT_INTEGER);
  }
  await expectCode(turns.setClosing('a', -5), ERROR_CODES.NEGATIVE);
  await expectCode(turns.setTesting('a', -1), ERROR_CODES.NEGATIVE);
  await expectCode(turns.setTesting('a', 1.5), ERROR_CODES.NOT_INTEGER);
  await expectCode(turns.setCredits('a', [{ label: 'x', litres: -1 }]), ERROR_CODES.NEGATIVE);
});

test('a closed turn cannot be closed again or edited', async (t) => {
  const { turns } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.setClosing('a', 2000);
  await turns.close('a');

  await expectCode(turns.close('a'), ERROR_CODES.TURN_ALREADY_CLOSED);
  await expectCode(turns.setClosing('a', 3000), ERROR_CODES.TURN_ALREADY_CLOSED);
  await expectCode(turns.get('nope') === null ? Promise.reject(Object.assign(new Error(), { code: 'x' })) : Promise.reject(Object.assign(new Error(), { code: 'x' })), 'x');
  assert.equal(await turns.get('nope'), null);
});

test('TestingOnly turns may leave shift and operator empty but still chain', async (t) => {
  const { turns, meter } = await seeded(t);
  const turn = await turns.start({
    id: 'test-1',
    shiftId: null,
    nozzleId: MS1,
    operatorId: null,
    openingOverride: firstEntry(100),
  });
  assert.equal(turn.shift_id, null);
  assert.equal(turn.operator_id, null);

  await turns.setClosing('test-1', 600);
  const closed = await turns.close('test-1');
  assert.equal(closed.seq, 1);
  assert.deepEqual(await meter.verifyChain(MS1), []);

  const next = await turns.start({ id: 'test-2', shiftId: null, nozzleId: MS1, operatorId: null });
  assert.equal(next.opening, 600, 'testing turns are chained too');
});

test('byShift lists that shift\u2019s turns in a stable order', async (t) => {
  const { turns } = await seeded(t);
  await turns.start({ id: 'a', shiftId: 's1', nozzleId: MS1, operatorId: 'op', openingOverride: firstEntry(1000) });
  await turns.start({ id: 'b', shiftId: 's1', nozzleId: MS2, operatorId: 'op', openingOverride: firstEntry(2000) });
  await turns.start({ id: 'c', shiftId: 's2', nozzleId: HSD1, operatorId: 'op2', openingOverride: firstEntry(3000) });

  const rows = await turns.byShift('s1');
  assert.deepEqual(rows.map((row) => row.id).sort(), ['a', 'b']);
  assert.deepEqual(await turns.byShift('missing'), []);
});
