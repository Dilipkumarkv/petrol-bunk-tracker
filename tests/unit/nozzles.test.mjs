// S2 · nozzles repository (brief §3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestRepos, expectCode } from './support/harness.mjs';
import { ERROR_CODES } from '../../app/src/data/errors.js';

const byLabel = (list, label) => list.find((n) => n.label === label);

test('seedDefaults installs the 10 default nozzles', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();

  const all = await nozzles.list({ activeOnly: false });
  assert.equal(all.length, 10);

  const labels = all.map((n) => n.label).sort();
  assert.deepEqual(labels, ['HSD1', 'HSD2', 'HSD3', 'HSD4', 'MS1', 'MS2', 'MS3', 'MS5', 'MS6', 'XP1']);

  // placeholders per the brief: which nozzles are really testing-only is still open (OQ-5)
  assert.equal(byLabel(all, 'MS5').use, 'TestingOnly');
  assert.equal(byLabel(all, 'MS6').use, 'TestingOnly');
  assert.equal(byLabel(all, 'MS1').use, 'Sales');
  assert.equal(byLabel(all, 'MS1').product, 'Petrol');
  assert.equal(byLabel(all, 'MS1').sheet, 'MS');
  assert.equal(byLabel(all, 'XP1').product, 'XP');
  assert.equal(byLabel(all, 'HSD1').product, 'Diesel');
  assert.equal(byLabel(all, 'HSD1').sheet, 'HSD');
  for (const nozzle of all) assert.equal(nozzle.active, true);
});

test('seedDefaults is idempotent and never overwrites a user change', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();

  const ms1 = byLabel(await nozzles.list({ activeOnly: false }), 'MS1');
  await nozzles.setUse(ms1.id, 'TestingOnly');

  await nozzles.seedDefaults();
  const after = await nozzles.list({ activeOnly: false });
  assert.equal(after.length, 10, 'still exactly 10 rows');
  assert.equal(byLabel(after, 'MS1').use, 'TestingOnly', 'seed did not reset the edit');
});

test('list is sorted by sheet then label, and stable across calls', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();

  const first = await nozzles.list({ activeOnly: false });
  const second = await nozzles.list({ activeOnly: false });

  assert.deepEqual(first.map((n) => n.id), second.map((n) => n.id), 'stable order');
  assert.deepEqual(
    first.map((n) => `${n.sheet}/${n.label}`),
    ['HSD/HSD1', 'HSD/HSD2', 'HSD/HSD3', 'HSD/HSD4', 'MS/MS1', 'MS/MS2', 'MS/MS3', 'MS/MS5', 'MS/MS6', 'XP/XP1'],
  );
});

test('get returns the nozzle, and null for an unknown id', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();
  const ms2 = byLabel(await nozzles.list(), 'MS2');

  assert.deepEqual(await nozzles.get(ms2.id), ms2);
  assert.equal(await nozzles.get('nope'), null);
});

test('upsert validates every field and reports a code', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  const base = { id: 'nz-x', label: 'ZZ1', product: 'Petrol', use: 'Sales', sheet: 'MS', active: true };

  await expectCode(nozzles.upsert({ ...base, product: 'Kerosene' }), ERROR_CODES.NOZZLE_BAD_PRODUCT);
  await expectCode(nozzles.upsert({ ...base, use: 'Maybe' }), ERROR_CODES.NOZZLE_BAD_USE);
  await expectCode(nozzles.upsert({ ...base, sheet: 'LPG' }), ERROR_CODES.NOZZLE_BAD_SHEET);
  await expectCode(nozzles.upsert({ ...base, id: '' }), ERROR_CODES.NOZZLE_ID_REQUIRED);
  await expectCode(nozzles.upsert({ ...base, id: undefined }), ERROR_CODES.NOZZLE_ID_REQUIRED);
});

test('duplicate labels are rejected case-insensitively among active nozzles', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();

  const clash = { id: 'nz-clash', label: 'ms1', product: 'Petrol', use: 'Sales', sheet: 'MS', active: true };
  await expectCode(nozzles.upsert(clash), ERROR_CODES.NOZZLE_LABEL_DUPLICATE);

  // updating the same nozzle with its own label is not a clash
  const ms1 = byLabel(await nozzles.list(), 'MS1');
  await nozzles.upsert({ ...ms1, label: 'MS1' });

  // once the original is deactivated the label is free again
  await nozzles.deactivate(ms1.id);
  await nozzles.upsert({ ...clash, label: 'MS1' });
  assert.equal(byLabel(await nozzles.list(), 'MS1').id, 'nz-clash');
});

test('setUse switches between Sales and TestingOnly and persists', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();
  const ms1 = byLabel(await nozzles.list(), 'MS1');

  await nozzles.setUse(ms1.id, 'TestingOnly');
  assert.equal((await nozzles.get(ms1.id)).use, 'TestingOnly');

  await nozzles.setUse(ms1.id, 'Sales');
  assert.equal((await nozzles.get(ms1.id)).use, 'Sales');

  await expectCode(nozzles.setUse(ms1.id, 'Broken'), ERROR_CODES.NOZZLE_BAD_USE);
  await expectCode(nozzles.setUse('nope', 'Sales'), ERROR_CODES.NOZZLE_NOT_FOUND);
});

test('deactivate hides from list but never deletes the row', async (t) => {
  const { nozzles } = await makeTestRepos(t);
  await nozzles.seedDefaults();
  const hsd4 = byLabel(await nozzles.list(), 'HSD4');

  await nozzles.deactivate(hsd4.id);
  assert.equal(await nozzles.get(hsd4.id) !== null, true, 'history still resolves the nozzle');
  assert.equal((await nozzles.get(hsd4.id)).active, false);
  assert.equal(byLabel(await nozzles.list(), 'HSD4'), undefined, 'hidden by default');
  assert.equal(byLabel(await nozzles.list({ activeOnly: false }), 'HSD4').id, hsd4.id);

  await expectCode(nozzles.deactivate('nope'), ERROR_CODES.NOZZLE_NOT_FOUND);
});
