/**
 * data/repos/tx.js — the only place that touches IndexedDB requests.
 *
 * Kept tiny on purpose: repositories read rows, then decide in plain JavaScript.
 * A single-request transaction is awaited directly, which keeps the handle valid
 * (IndexedDB auto-commits only when control returns to the event loop).
 */

/**
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
export function toPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Resolve when a write transaction has actually committed.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

/**
 * Read every row of a store.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {{index?: string, query?: IDBValidKey}} [options]
 * @returns {Promise<any[]>}
 */
export async function readAll(db, storeName, options = {}) {
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const request = options.index ? store.index(options.index).getAll(options.query) : store.getAll();
  return toPromise(request);
}

/**
 * Read one row by key.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {IDBValidKey} key
 * @returns {Promise<any|null>} null when absent
 */
export async function readOne(db, storeName, key) {
  const tx = db.transaction(storeName, 'readonly');
  const row = await toPromise(tx.objectStore(storeName).get(key));
  return row ?? null;
}

/**
 * Insert or replace one row.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {any} value
 * @returns {Promise<any>} the stored value
 */
export async function writeOne(db, storeName, value) {
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await txDone(tx);
  return value;
}

/**
 * Insert or replace several rows in one transaction — all or nothing.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {any[]} values
 * @returns {Promise<any[]>}
 */
export async function writeMany(db, storeName, values) {
  if (values.length === 0) return values;
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await txDone(tx);
  return values;
}
