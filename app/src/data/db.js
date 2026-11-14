/**
 * data/db.js — IndexedDB open + versioned migration runner (M2 slice S1).
 *
 * Responsibilities, deliberately narrow:
 *   1. name the database and its schema version
 *   2. describe every object store and index in one place (`STORE_SPECS`)
 *   3. run ordered migrations on upgrade, and refuse a broken migration plan
 *
 * Not here: entity repositories (S2+), validation, arithmetic, UI, network.
 * M2 guard rules: no float arithmetic on money, no `/ui` imports, no third-party
 * runtime dependencies. `fake-indexeddb` is a dev-only test shim.
 *
 * Representation rule inherited from the spec (§2): litres are integer hundredths,
 * money is integer paise/paisa-hundredths. This module never stores or computes
 * either — it only defines where they are kept — so it performs no arithmetic.
 */

/** Production database name. */
export const DB_NAME = 'fuel';

/** Current schema version. Bumping this requires a new migration in the same commit. */
export const SCHEMA_VERSION = 1;

/**
 * The v1 schema, exactly as the M2 plan lists it.
 * `keyPath: null` with `autoIncrement: true` means a generated numeric key (audit log).
 * @type {ReadonlyArray<{name: string, keyPath: string|string[]|null, autoIncrement?: boolean,
 *                       indexes?: ReadonlyArray<{name: string, keyPath: string|string[]}>}>}
 */
export const STORE_SPECS = Object.freeze([
  { name: 'nozzles', keyPath: 'id' },
  { name: 'rates', keyPath: ['product', 'effective_from'] },
  { name: 'operators', keyPath: 'id', indexes: [{ name: 'nameNorm', keyPath: 'nameNorm' }] },
  {
    name: 'shifts',
    keyPath: 'id',
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'date_shift_no', keyPath: ['date', 'shift_no'] },
      { name: 'status', keyPath: 'status' },
    ],
  },
  {
    name: 'turns',
    keyPath: 'id',
    indexes: [
      { name: 'shift_id', keyPath: 'shift_id' },
      { name: 'nozzle_recorded_at', keyPath: ['nozzle_id', 'recorded_at'] },
    ],
  },
  { name: 'payments', keyPath: 'id', indexes: [{ name: 'shift_id', keyPath: 'shift_id' }] },
  { name: 'deductions', keyPath: 'id', indexes: [{ name: 'shift_id', keyPath: 'shift_id' }] },
  { name: 'deposits', keyPath: 'id', indexes: [{ name: 'shift_id', keyPath: 'shift_id' }] },
  { name: 'days', keyPath: 'date' },
  { name: 'audit', keyPath: null, autoIncrement: true },
  { name: 'drafts', keyPath: 'shift_id' },
  { name: 'meta', keyPath: 'k' },
]);

/**
 * Create every store in `STORE_SPECS`. Must run inside an upgrade transaction.
 * Exported through `MIGRATIONS` so a later migration can re-use it when a legacy
 * database skipped an earlier version.
 * @param {IDBDatabase} db
 */
export function createStores(db) {
  for (const spec of STORE_SPECS) {
    if (db.objectStoreNames.contains(spec.name)) continue;
    const store = db.createObjectStore(spec.name, {
      keyPath: spec.keyPath,
      autoIncrement: spec.autoIncrement === true,
    });
    for (const index of spec.indexes ?? []) {
      store.createIndex(index.name, index.keyPath, { unique: false });
    }
  }
}

/**
 * Ordered migration plan. Each entry upgrades the schema to `version`.
 * Rule (M2 plan): any schema change is a new version here plus a migration and a
 * snapshot fixture in the same commit.
 */
export const MIGRATIONS = Object.freeze([
  { version: 1, up: (db) => createStores(db) },
]);

/**
 * Validate a migration plan against the version being opened.
 * Rejects duplicates, non-positive versions, and gaps that would leave a database
 * half-upgraded.
 * @param {ReadonlyArray<{version: number, up: Function}>} migrations
 * @param {number} targetVersion
 */
function validatePlan(migrations, targetVersion) {
  const seen = new Set();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version)) {
      throw new TypeError(`migration version must be an integer (got ${migration.version})`);
    }
    if (migration.version < 1) {
      throw new RangeError(`migration version must be positive (got ${migration.version})`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration version ${migration.version}`);
    }
    if (typeof migration.up !== 'function') {
      throw new TypeError(`migration ${migration.version} has no up() function`);
    }
    seen.add(migration.version);
  }

  const missing = [];
  for (let version = 1; version <= targetVersion; version += 1) {
    if (!seen.has(version)) missing.push(version);
  }
  if (missing.length > 0) {
    throw new Error(
      `missing migration for version ${missing.join(', ')} — every version up to ${targetVersion} needs one`,
    );
  }
}

/**
 * Run the migrations needed to move a database from `oldVersion` to `newVersion`.
 *
 * Must be called from inside an `upgradeneeded` handler: migrations run in the
 * upgrade transaction, so a failure aborts every store change made so far.
 *
 * @param {IDBDatabase} db
 * @param {IDBTransaction|null} tx upgrade transaction (only touched by migrations)
 * @param {number} oldVersion version the database was at (0 for a brand-new database)
 * @param {number} newVersion version requested
 * @param {ReadonlyArray<{version: number, up: (db: IDBDatabase, tx: IDBTransaction|null) => void}>} migrations
 */
export function applyMigrations(db, tx, oldVersion, newVersion, migrations) {
  validatePlan(migrations, newVersion);

  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    if (migration.version <= oldVersion) continue;
    if (migration.version > newVersion) break;
    migration.up(db, tx);
  }
}

/**
 * Open the database, upgrading it through the migration plan if needed.
 *
 * Resolves with an open `IDBDatabase`. The caller owns the handle and must close it.
 *
 * @param {object} [options]
 * @param {string} [options.name] database name
 * @param {number} [options.version] target schema version
 * @param {ReadonlyArray<{version: number, up: Function}>} [options.migrations]
 * @param {IDBFactory|null} [options.factory] injectable for tests
 * @returns {Promise<IDBDatabase>}
 */
export function openDb(options = {}) {
  const {
    name = DB_NAME,
    version = SCHEMA_VERSION,
    migrations = MIGRATIONS,
    factory,
  } = options;

  const idb = factory === undefined ? globalThis.indexedDB : factory;
  if (!idb) {
    return Promise.reject(
      new Error('IndexedDB is not available in this environment'),
    );
  }

  try {
    validatePlan(migrations, version);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const req = idb.open(name, version);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      try {
        applyMigrations(
          db,
          tx,
          event.oldVersion ?? 0,
          event.newVersion ?? version,
          migrations,
        );
      } catch (error) {
        // Abort so a half-migrated database is never committed.
        try {
          tx?.abort();
        } catch {
          /* already aborting */
        }
        reject(error);
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Another tab wants to upgrade: get out of the way instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    req.onerror = () => {
      const error = req.error;
      reject(
        new Error(
          `IndexedDB open failed for "${name}" at version ${version}: ${error?.name}: ${error?.message}`,
        ),
      );
    };

    req.onblocked = () => {
      reject(
        new Error(
          `IndexedDB upgrade for "${name}" is blocked by another open connection at an older version`,
        ),
      );
    };
  });
}

/**
 * Delete a database. Used by tests and the owner-only "start over" action.
 * @param {string} [name]
 * @param {IDBFactory} [factory]
 * @returns {Promise<void>}
 */
export function deleteDb(name = DB_NAME, factory) {
  const idb = factory === undefined ? globalThis.indexedDB : factory;
  if (!idb) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  return new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`could not delete database "${name}"`));
    req.onblocked = () =>
      reject(new Error(`delete of "${name}" is blocked by another open connection`));
  });
}
