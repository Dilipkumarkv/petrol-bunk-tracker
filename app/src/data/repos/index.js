/**
 * data/repos/index.js — assemble the repositories over one database handle.
 *
 * Dependencies are injected so tests get a fixed clock and a counter id generator
 * (and the app gets a real clock), and so nothing in /data reaches for a global.
 */
import { makeNozzleRepo } from './nozzles.js';
import { makeRateRepo } from './rates.js';
import { makeOperatorRepo } from './operators.js';

/**
 * @param {object} deps
 * @param {IDBDatabase} deps.db
 * @param {() => string} deps.now returns an ISO timestamp
 * @param {() => string} deps.newId returns a fresh id
 * @returns {{nozzles: object, rates: object, operators: object}}
 */
export function makeRepos({ db, now, newId } = {}) {
  if (!db) throw new TypeError('makeRepos requires a database handle');
  if (typeof now !== 'function') throw new TypeError('makeRepos requires now() for timestamps');
  if (typeof newId !== 'function') throw new TypeError('makeRepos requires newId() for identifiers');

  return {
    nozzles: makeNozzleRepo({ db, now, newId }),
    rates: makeRateRepo({ db, now }),
    operators: makeOperatorRepo({ db, now, newId }),
  };
}
