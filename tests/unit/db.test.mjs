// S1 — versioned IndexedDB open + migration runner (M2 plan, slice S1).
// Test-first: these assertions define data/db.js before it exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import {
  openDb,
  deleteDb,
  applyMigrations,
  MIGRATIONS,
  SCHEMA_VERSION,
  DB_NAME,
} from '../../app/src/data/db.js';

const v1Snapshot = JSON.parse(
  readFileSync(new URL('../fixtures/db-v1.json', import.meta.url), 'utf8'),
);
const v0Legacy = JSON.parse(
  readFileSync(new URL('../fixtures/db-v0.json', import.meta.url), 'utf8'),
);

/**
 * The current (v2) schema, as the S3 addendum specifies it. Deliberately hardcoded
 * rather than read from the module: a drift in STORE_SPECS must fail this loudly.
 */
const EXPECTED_V2 = {
  nozzles: { keyPath: 'id' },
  rates: { keyPath: ['product', 'effective_from'] },
  operators: { keyPath: 'id', indexes: { nameNorm: { keyPath: 'nameNorm' } } },
  shifts: {
    keyPath: 'id',
    indexes: {
      date: { keyPath: 'date' },
      date_shift_no: { keyPath: ['date', 'shift_no'] },
      status: { keyPath: 'status' },
    },
  },
  turns: {
    keyPath: 'id',
    indexes: {
      shift_id: { keyPath: 'shift_id' },
      nozzle_recorded_at: { keyPath: ['nozzle_id', 'recorded_at'] },
      // v2 additions: the ordered chain, unique so a racing close cannot duplicate a seq
      nozzle_seq: { keyPath: ['nozzle_id', 'seq'], unique: true },
      nozzle_status: { keyPath: ['nozzle_id', 'status'] },
    },
  },
  payments: { keyPath: 'id', indexes: { shift_id: { keyPath: 'shift_id' } } },
  deductions: { keyPath: 'id', indexes: { shift_id: { keyPath: 'shift_id' } } },
  deposits: { keyPath: 'id', indexes: { shift_id: { keyPath: 'shift_id' } } },
  days: { keyPath: 'date' },
  audit: { keyPath: null, autoIncrement: true },
  drafts: { keyPath: 'shift_id' },
  meta: { keyPath: 'k' },
};

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
  for (const row of rows) tx.objectStore(storeName).put(row);
  await done(tx);
}

async function getAll(db, storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return request(tx.objectStore(storeName).getAll());
}

async function getAllKeys(db, storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return request(tx.objectStore(storeName).getAllKeys());
}

/**
 * `getAll()` returns rows in key order, which for a composite key such as
 * [product, effective_from] is not the order a fixture lists them in. Compare
 * contents, not storage order.
 */
const canon = (rows) =>
  [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

/** Create the fixture's legacy DB shape at its recorded version. */
async function buildLegacyDb(name) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, v0Legacy.version);
    req.onupgradeneeded = () => {
      for (const store of v0Legacy.stores) {
        req.result.createObjectStore(store.name, { keyPath: store.keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const store of v0Legacy.stores) await putAll(db, store.name, store.rows);
  return db;
}

test('fresh database creates every v2 store with the planned keys and indexes', async (t) => {
  const name = 'fuel-test-fresh';
  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  assert.equal(db.version, SCHEMA_VERSION, 'opens at the current schema version');
  assert.equal(SCHEMA_VERSION, 2, 'S3 ships schema v2 (additive turn-chain indexes)');
  assert.equal(DB_NAME, 'fuel', 'production database name is fuel');

  const names = [...db.objectStoreNames].sort();
  assert.deepEqual(names, Object.keys(EXPECTED_V2).sort(), 'exactly the planned stores');

  const tx = db.transaction(names, 'readonly');
  for (const [storeName, spec] of Object.entries(EXPECTED_V2)) {
    const store = tx.objectStore(storeName);
    assert.deepEqual(store.keyPath, spec.keyPath, `${storeName}.keyPath`);
    assert.equal(store.autoIncrement, spec.autoIncrement === true, `${storeName}.autoIncrement`);

    const expectedIndexes = spec.indexes ?? {};
    assert.deepEqual(
      [...store.indexNames].sort(),
      Object.keys(expectedIndexes).sort(),
      `${storeName} index names`,
    );
    for (const [indexName, indexSpec] of Object.entries(expectedIndexes)) {
      const index = store.index(indexName);
      assert.deepEqual(index.keyPath, indexSpec.keyPath, `${storeName}.${indexName}.keyPath`);
      assert.equal(index.unique, indexSpec.unique === true, `${storeName}.${indexName}.unique`);
    }
  }
});

test('reopening at the same version is a no-op and keeps data', async (t) => {
  const name = 'fuel-test-reopen';
  let runs = 0;
  const spyMigrations = MIGRATIONS.map((m) => ({
    version: m.version,
    up: (...args) => {
      runs += 1;
      return m.up(...args);
    },
  }));

  const first = await openDb({ name, migrations: spyMigrations });
  await putAll(first, 'meta', [{ k: 'device_id', v: 'device-a' }]);
  first.close();
  assert.equal(runs, 2, 'both migrations ran on creation');

  const second = await openDb({ name, migrations: spyMigrations });
  t.after(async () => {
    second.close();
    await deleteDb(name);
  });

  assert.equal(runs, 2, 'reopening did not re-run any migration');
  assert.equal(second.version, 2);
  assert.deepEqual(await getAll(second, 'meta'), [{ k: 'device_id', v: 'device-a' }]);
});

test('legacy v0 snapshot upgrades to the current version without data loss', async (t) => {
  const name = 'fuel-test-upgrade';
  const legacy = await buildLegacyDb(name);
  assert.deepEqual([...legacy.objectStoreNames].sort(), ['nozzlesLegacy', 'opsLegacy']);
  legacy.close();

  const TARGET = 2;
  const migrations = [
    MIGRATIONS[0],
    {
      // A legacy install arrives at S1's shape, skipping v1 entirely. So version 2
      // must do both jobs: build the v1 stores, run the v2 upgrade, then carry rows.
      version: 2,
      up: (db, tx) => {
        MIGRATIONS[0].up(db, tx);
        MIGRATIONS[1].up(db, tx);
        const legacyStore = tx.objectStore('nozzlesLegacy');
        const nozzles = tx.objectStore('nozzles');
        legacyStore.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          nozzles.put({ id: cursor.value.id, label: cursor.value.label });
          cursor.continue();
        };
      },
    },
  ];

  const db = await openDb({ name, version: TARGET, migrations });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });

  assert.equal(db.version, 2);
  assert.deepEqual(
    [...db.objectStoreNames].sort(),
    [...Object.keys(EXPECTED_V2), 'nozzlesLegacy', 'opsLegacy'].sort(),
    'v1 stores added alongside the untouched legacy stores',
  );

  const nozzles = await getAll(db, 'nozzles');
  assert.deepEqual(
    nozzles.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'n1', label: 'Nozzle 1' },
      { id: 'n2', label: 'Nozzle 2' },
    ],
    'legacy rows carried forward unchanged',
  );
  assert.equal((await getAll(db, 'nozzlesLegacy')).length, 2, 'legacy store still intact');
  assert.equal((await getAll(db, 'opsLegacy')).length, 2, 'legacy rows never dropped');
});

test('the released v1 snapshot opens at the current version with every row intact', async (t) => {
  const name = 'fuel-test-snapshot';
  const db = await openDb({ name });

  for (const [storeName, rows] of Object.entries(v1Snapshot.stores)) {
    assert.ok(db.objectStoreNames.contains(storeName), `snapshot store ${storeName} exists`);
    await putAll(db, storeName, rows);
  }
  db.close();

  // Reopening is what a future version will do to this snapshot.
  const reopened = await openDb({ name });
  t.after(async () => {
    reopened.close();
    await deleteDb(name);
  });

  assert.equal(reopened.version, SCHEMA_VERSION);
  for (const [storeName, rows] of Object.entries(v1Snapshot.stores)) {
    const stored = await getAll(reopened, storeName);
    assert.equal(stored.length, rows.length, `${storeName} row count`);
    if (storeName === 'audit') {
      // An autoIncrement store uses out-of-line keys: the generated number is the
      // record key, not a property on the value. Assert both halves explicitly.
      assert.deepEqual(await getAllKeys(reopened, 'audit'), [1], 'autoIncrement key assigned');
      assert.deepEqual(canon(stored), canon(rows), 'audit payloads survive');
    } else {
      assert.deepEqual(canon(stored), canon(rows), `${storeName} rows survive unchanged`);
    }
  }
});

test('a downgrade request is rejected instead of silently destroying stores', async (t) => {
  const name = 'fuel-test-downgrade';
  const db = await openDb({ name });
  db.close();
  t.after(() => deleteDb(name));

  await assert.rejects(() => openDb({ name, version: 0 }), /version/i);
});

test('the migration runner skips applied versions and rejects a broken plan', () => {
  const applied = [];
  const migration = (version) => ({ version, up: () => applied.push(version) });

  applyMigrations({}, null, 1, 3, [migration(1), migration(2), migration(3)]);
  assert.deepEqual(applied, [2, 3], 'only migrations above oldVersion run');

  applied.length = 0;
  applyMigrations({}, null, 0, 1, [migration(1), migration(2)]);
  assert.deepEqual(applied, [1], 'never runs above newVersion');

  assert.throws(() => applyMigrations({}, null, 0, 3, [migration(1), migration(3)]), /missing/i);
  assert.throws(
    () => applyMigrations({}, null, 0, 2, [migration(1), migration(1), migration(2)]),
    /duplicate/i,
  );
  assert.throws(() => applyMigrations({}, null, 0, 1, [migration(0)]), /positive/i);
});

test('openDb fails clearly when IndexedDB is unavailable', async () => {
  await assert.rejects(() => openDb({ name: 'fuel-test-noidb', factory: null }), /IndexedDB/i);
});

test('data/db.js imports no UI code and does no float money formatting', () => {
  const source = readFileSync(new URL('../../app/src/data/db.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"][^'"]*\/ui\//, 'no imports from /ui');
  assert.doesNotMatch(source, /from\s+['"][^'"]*\/ui\.js/, 'no imports from ui.js');
  assert.doesNotMatch(source, /\btoFixed\s*\(/, 'no toFixed on money');
  assert.doesNotMatch(source, /\bparseFloat\s*\(/, 'no parseFloat on money');
});
