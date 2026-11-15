// Shared test support for the S2 repository tests.
// Deterministic by construction: fixed clock, counter ids, seeded PRNG.
import 'fake-indexeddb/auto';
import { openDb, deleteDb } from '../../../app/src/data/db.js';
import { makeRepos } from '../../../app/src/data/repos/index.js';

let dbCounter = 0;

/** A clock that advances one second per call, starting 2026-11-15 09:00 IST. */
export function fixedClock(startMs = Date.UTC(2026, 10, 15, 3, 30, 0)) {
  let tick = 0;
  return () => new Date(startMs + tick++ * 1000).toISOString();
}

/** Deterministic id generator: id-1, id-2, ... */
export function counterIds(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** mulberry32 — seeded, reproducible, no Math.random (§8.4 rule 5). */
export function prng(seed = 20261115) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a throwaway database with the full repo set, cleaned up after the test. */
export async function makeTestRepos(t, overrides = {}) {
  const name = `fuel-s2-${++dbCounter}`;
  const db = await openDb({ name });
  t.after(async () => {
    db.close();
    await deleteDb(name);
  });
  return makeRepos({ db, now: fixedClock(), newId: counterIds(), ...overrides });
}

/** Assert a promise rejects with a specific error code. */
export async function expectCode(promise, code) {
  await assertRejectsWithCode(promise, code);
}

async function assertRejectsWithCode(promise, code) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error(`expected rejection with ${code}, but it resolved`);
  if (caught.code !== code) {
    throw new Error(`expected code ${code}, got ${caught.code ?? caught.message}`);
  }
}
