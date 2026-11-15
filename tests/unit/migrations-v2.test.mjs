// S3 addendum §1 — schema v2 migration (additive turn-chain indexes + backfill).
// These tests run against a v1 database built with the S1 migration, which is the
// only honest way to prove the upgrade path a real install will take.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { openDb, deleteDb, MIGRATIONS, SCHEMA_VERSION } from '../../app/src/data/db.js';

const v2Snapshot = JSON.parse(
  readFileSync(new URL('../fixtures/db-v2.json', import.meta.url), 'utf8'),
);

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

async function putAll(db, storeName, rows) {
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const row of rows) store.put(row);
  await done(tx);
}

async function getAll(db, storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return request(tx.objectStore(storeName).getAll());
}

async function indexCount(db, storeName, indexName) {
  const tx = db.transaction(storeName, 'readonly');
  return request(tx.objectStore(storeName).index(indexName).count());
}

/** Build a database at v1 using only S1's migration — exactly what shipped. */
async function buildV1Db(name, turns) {
  const db = await openDb({ name, version: 1, migrations: [MIGRATIONS[0]] });
  assert.equal(db.version, 1);
  assert.ok(!db.transaction('turns', 'readonly').objectStore('turns').indexNames.contains('nozzle_seq'));
  if (turns.length > 0) await putAll(db, 'turns', turns);
  db.close();
}

const seqOf = (rows, id) => rows.find((row) => row.id === id).seq;

test('v1 → v2 upgrades in place and the version is bumped', async (t) => {
  const name = 'fuel-v2-upgrade';
  await buildV1Db(name, []);
  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  assert.equal(db.version, 2);
  assert.equal(SCHEMA_VERSION, 2);
  const store = db.transaction('turns', 'readonly').objectStore('turns');
  assert.ok(store.indexNames.contains('nozzle_seq'), 'ordered-chain index added');
  assert.ok(store.indexNames.contains('nozzle_status'), 'busy-nozzle index added');
  assert.ok(store.indexNames.contains('nozzle_recorded_at'), 'v1 index deliberately kept');
});

test('closed turns are backfilled 1..N per nozzle, ordered by recorded_at then id', async (t) => {
  const name = 'fuel-v2-backfill';
  await buildV1Db(name, [
    // written deliberately out of order to prove the sort, not the insert order
    { id: 't3', nozzle_id: 'n1', status: 'closed', closing: 3000, recorded_at: '2026-11-14T12:00:00Z' },
    { id: 't1', nozzle_id: 'n1', status: 'closed', closing: 1000, recorded_at: '2026-11-14T08:00:00Z' },
    { id: 't2', nozzle_id: 'n1', status: 'closed', closing: 2000, recorded_at: '2026-11-14T10:00:00Z' },
  ]);

  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  const rows = await getAll(db, 'turns');
  assert.equal(rows.length, 3, 'no row lost');
  assert.equal(seqOf(rows, 't1'), 1);
  assert.equal(seqOf(rows, 't2'), 2);
  assert.equal(seqOf(rows, 't3'), 3);
  assert.equal(rows.find((r) => r.id === 't1').closing, 1000, 'payload untouched');
});

test('two nozzles are backfilled independently, each starting at 1', async (t) => {
  const name = 'fuel-v2-two-nozzles';
  await buildV1Db(name, [
    { id: 'a1', nozzle_id: 'n1', status: 'closed', closing: 10, recorded_at: '2026-11-14T08:00:00Z' },
    { id: 'a2', nozzle_id: 'n1', status: 'closed', closing: 20, recorded_at: '2026-11-14T09:00:00Z' },
    { id: 'b1', nozzle_id: 'n2', status: 'closed', closing: 30, recorded_at: '2026-11-14T10:00:00Z' },
  ]);

  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  const rows = await getAll(db, 'turns');
  assert.equal(seqOf(rows, 'a1'), 1);
  assert.equal(seqOf(rows, 'a2'), 2);
  assert.equal(seqOf(rows, 'b1'), 1, 'second nozzle restarts at 1');
});

test('ties in recorded_at are broken by id, deterministically', async (t) => {
  const name = 'fuel-v2-ties';
  const same = '2026-11-14T08:00:00Z';
  await buildV1Db(name, [
    { id: 'zz', nozzle_id: 'n1', status: 'closed', closing: 2, recorded_at: same },
    { id: 'aa', nozzle_id: 'n1', status: 'closed', closing: 1, recorded_at: same },
  ]);

  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  const rows = await getAll(db, 'turns');
  assert.equal(seqOf(rows, 'aa'), 1, 'lower id wins the tie');
  assert.equal(seqOf(rows, 'zz'), 2);
});

test('drafts get no seq, and unknown status falls back to "closed only if closing is an integer"', async (t) => {
  const name = 'fuel-v2-drafts';
  await buildV1Db(name, [
    { id: 'c1', nozzle_id: 'n1', status: 'closed', closing: 100, recorded_at: '2026-11-14T08:00:00Z' },
    { id: 'd1', nozzle_id: 'n1', status: 'draft', closing: null },
    { id: 'd2', nozzle_id: 'n2', status: 'draft' },
    // no status at all, but a numeric closing — treated as a closed turn
    { id: 'x1', nozzle_id: 'n2', closing: 500, recorded_at: '2026-11-14T09:00:00Z' },
    // no status and no numeric closing — treated as a draft
    { id: 'x2', nozzle_id: 'n2', closing: 'nope' },
  ]);

  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  const rows = await getAll(db, 'turns');
  assert.equal(seqOf(rows, 'c1'), 1);
  assert.equal(seqOf(rows, 'd1'), null, 'draft has no chain position');
  assert.equal(seqOf(rows, 'd2'), null);
  assert.equal(seqOf(rows, 'x1'), 1, 'numeric closing counts as closed on nozzle n2');
  assert.equal(seqOf(rows, 'x2'), null, 'non-numeric closing stays a draft');
});

test('nozzle_seq contains closed turns only — drafts are invisible to it', async (t) => {
  const name = 'fuel-v2-index-scope';
  await buildV1Db(name, [
    { id: 'c1', nozzle_id: 'n1', status: 'closed', closing: 100, recorded_at: '2026-11-14T08:00:00Z' },
    { id: 'c2', nozzle_id: 'n1', status: 'closed', closing: 200, recorded_at: '2026-11-14T09:00:00Z' },
  ]);

  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  // two drafts on the SAME nozzle must coexist without a null-key clash
  await putAll(db, 'turns', [
    { id: 'd1', nozzle_id: 'n1', status: 'draft', seq: null },
    { id: 'd2', nozzle_id: 'n1', status: 'draft', seq: null },
  ]);

  assert.equal(await indexCount(db, 'turns', 'nozzle_seq'), 2, 'only the two closed turns are indexed');
  assert.equal((await getAll(db, 'turns')).length, 4);
});

test('nozzle_seq is unique — a duplicate [nozzle_id, seq] raises ConstraintError', async (t) => {
  const name = 'fuel-v2-unique';
  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  await putAll(db, 'turns', [{ id: 'c1', nozzle_id: 'n1', seq: 1, status: 'closed', closing: 100 }]);

  // Inspect the request error directly: an abort leaves tx.error null, which would
  // hide the real ConstraintError if we only watched the transaction.
  const tx = db.transaction('turns', 'readwrite');
  const duplicate = tx.objectStore('turns').put({ id: 'c2', nozzle_id: 'n1', seq: 1, status: 'closed', closing: 200 });
  const error = await new Promise((resolve) => {
    duplicate.onsuccess = () => resolve(null);
    duplicate.onerror = () => resolve(duplicate.error);
  });

  assert.ok(error, 'the duplicate seq must fail');
  assert.equal(error.name, 'ConstraintError');

  const rows = await getAll(db, 'turns');
  assert.equal(rows.length, 1, 'the failed write left no row behind');
});

test('the same seq on two different nozzles is fine', async (t) => {
  const name = 'fuel-v2-unique-scope';
  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  await putAll(db, 'turns', [
    { id: 'c1', nozzle_id: 'n1', seq: 1, status: 'closed', closing: 100 },
    { id: 'c2', nozzle_id: 'n2', seq: 1, status: 'closed', closing: 200 },
  ]);
  assert.equal((await getAll(db, 'turns')).length, 2);
});

test('reopening a v2 database does not re-run migrations', async (t) => {
  const name = 'fuel-v2-reopen';
  let runs = 0;
  const spy = MIGRATIONS.map((migration) => ({
    version: migration.version,
    up: (...args) => {
      runs += 1;
      return migration.up(...args);
    },
  }));

  const first = await openDb({ name, migrations: spy });
  await putAll(first, 'turns', [{ id: 'c1', nozzle_id: 'n1', seq: 1, status: 'closed', closing: 100 }]);
  first.close();
  assert.equal(runs, 2, 'both migrations ran on creation');

  const second = await openDb({ name, migrations: spy });
  t.after(async () => {
    second.close();
    await deleteDb(name);
  });

  assert.equal(runs, 2, 'reopening ran none');
  assert.equal(second.version, 2);
  assert.equal((await getAll(second, 'turns')).length, 1);
});

test('the released v2 snapshot round-trips, draft included', async (t) => {
  const name = 'fuel-v2-snapshot';
  const db = await openDb({ name });
  for (const [storeName, rows] of Object.entries(v2Snapshot.stores)) {
    await putAll(db, storeName, rows);
  }
  db.close();

  const reopened = await openDb({ name });
  t.after(async () => {
    reopened.close();
    await deleteDb(name);
  });

  const turns = await getAll(reopened, 'turns');
  assert.equal(turns.length, v2Snapshot.stores.turns.length);

  const draft = turns.find((row) => row.status === 'draft');
  assert.ok(draft, 'the snapshot carries a draft');
  assert.equal(draft.seq, null, 'drafts keep a null chain position');

  const closed = turns.filter((row) => row.status === 'closed');
  assert.deepEqual([...new Set(closed.map((row) => row.nozzle_id))].length, 2, 'two chains in the snapshot');
  assert.equal(await indexCount(reopened, 'turns', 'nozzle_seq'), closed.length);
});
