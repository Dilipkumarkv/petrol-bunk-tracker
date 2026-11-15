// S2 · operators repository (brief §5). Soft-delete only; names are free text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestRepos, expectCode } from './support/harness.mjs';
import { ERROR_CODES } from '../../app/src/data/errors.js';

test('upsertByName creates once, then returns the existing operator', async (t) => {
  const { operators } = await makeTestRepos(t);

  const first = await operators.upsertByName('Raju');
  assert.equal(first.created, true);
  assert.equal(typeof first.operator.id, 'string');
  assert.equal(first.operator.name, 'Raju', 'display name keeps the typed casing');
  assert.equal(first.operator.nameNorm, 'raju');
  assert.equal(first.operator.active, true);
  assert.equal(typeof first.operator.created_at, 'string');

  const second = await operators.upsertByName('Raju');
  assert.equal(second.created, false);
  assert.equal(second.operator.id, first.operator.id);
  assert.equal((await operators.list()).length, 1);
});

test('case and spacing variants resolve to the same operator', async (t) => {
  const { operators } = await makeTestRepos(t);
  const raju = await operators.upsertByName('Raju');

  for (const variant of ['raju', 'RAJU', '  raju  ', 'Raju ']) {
    const again = await operators.upsertByName(variant);
    assert.equal(again.operator.id, raju.operator.id, variant);
    assert.equal(again.created, false, variant);
  }
  assert.equal((await operators.list()).length, 1);
});

test('Kannada names differing by a vowel sign stay distinct', async (t) => {
  const { operators } = await makeTestRepos(t);
  const a = await operators.upsertByName('ರಾಜು');
  const b = await operators.upsertByName('ರಾಜ');

  assert.notEqual(a.operator.id, b.operator.id, 'must not merge two different people');
  assert.equal(a.operator.nameNorm, 'ರಾಜು');
  assert.equal(b.operator.nameNorm, 'ರಾಜ');
  assert.equal((await operators.list()).length, 2);
});

test('Latin diacritics dedupe, Kannada marks do not', async (t) => {
  const { operators } = await makeTestRepos(t);
  const jose = await operators.upsertByName('José');
  const joseAgain = await operators.upsertByName('Jose');
  assert.equal(joseAgain.operator.id, jose.operator.id, 'José and Jose are one operator');

  const first = await operators.upsertByName('Suresh');
  assert.equal(first.created, true);
  assert.equal((await operators.upsertByName('Suresh')).created, false);
});

test('empty, blank and over-long names are rejected', async (t) => {
  const { operators } = await makeTestRepos(t);
  await expectCode(operators.upsertByName(''), ERROR_CODES.OPERATOR_NAME_REQUIRED);
  await expectCode(operators.upsertByName('   '), ERROR_CODES.OPERATOR_NAME_REQUIRED);
  await expectCode(operators.upsertByName('\t\n'), ERROR_CODES.OPERATOR_NAME_REQUIRED);
  await expectCode(operators.upsertByName(null), ERROR_CODES.OPERATOR_NAME_REQUIRED);
  await expectCode(operators.upsertByName('x'.repeat(41)), ERROR_CODES.OPERATOR_NAME_TOO_LONG);
  await operators.upsertByName('x'.repeat(40));
});

test('list is sorted by name and hides inactive operators by default', async (t) => {
  const { operators } = await makeTestRepos(t);
  for (const name of ['Suresh', 'Raju', 'Anil']) await operators.upsertByName(name);

  assert.deepEqual((await operators.list()).map((o) => o.name), ['Anil', 'Raju', 'Suresh']);

  const suresh = await operators.upsertByName('Suresh');
  await operators.deactivate(suresh.operator.id);
  assert.deepEqual((await operators.list()).map((o) => o.name), ['Anil', 'Raju']);
  assert.equal((await operators.list({ activeOnly: false })).length, 3, 'still stored');

  const byId = await operators.get(suresh.operator.id);
  assert.ok(byId, 'get() still resolves a deactivated operator — history needs it');
  assert.equal(byId.active, false);

  await operators.reactivate(suresh.operator.id);
  assert.equal((await operators.get(suresh.operator.id)).active, true);
  assert.equal((await operators.list()).length, 3);
});

test('findSimilar suggests near misses but not unrelated names', async (t) => {
  const { operators } = await makeTestRepos(t);
  await operators.upsertByName('Raju');
  await operators.upsertByName('Suresh');

  const jo = await operators.findSimilar('Rajo');
  assert.deepEqual(jo.map((o) => o.name), ['Raju'], 'one edit away from Raju');

  assert.deepEqual(await operators.findSimilar('Ravi'), [], 'two edits away — not suggested');
  assert.deepEqual(await operators.findSimilar('Raju'), [], 'the exact name is not "similar", it is the same');
});

test('findSimilar honours maxDistance and ignores inactive operators', async (t) => {
  const { operators } = await makeTestRepos(t);
  const raju = await operators.upsertByName('Raju');

  assert.deepEqual((await operators.findSimilar('Raj', 1)).map((o) => o.name), ['Raju']);
  assert.deepEqual(await operators.findSimilar('Raj', 0), [], 'maxDistance 0 only matches an exact name');

  await operators.deactivate(raju.operator.id);
  assert.deepEqual(await operators.findSimilar('Rajo'), [], 'inactive operators are not suggested');

  await operators.reactivate(raju.operator.id);
  assert.equal((await operators.findSimilar('Rajo')).length, 1);
});

test('findSimilar works across Kannada spellings without merging them', async (t) => {
  const { operators } = await makeTestRepos(t);
  await operators.upsertByName('ರಾಜು');
  const near = await operators.findSimilar('ರಾಜ');
  assert.deepEqual(near.map((o) => o.nameNorm), ['ರಾಜು'], 'one vowel sign away');
});

test('unknown ids are reported, not silently ignored', async (t) => {
  const { operators } = await makeTestRepos(t);
  await expectCode(operators.deactivate('nope'), ERROR_CODES.OPERATOR_NOT_FOUND);
  await expectCode(operators.reactivate('nope'), ERROR_CODES.OPERATOR_NOT_FOUND);
});
