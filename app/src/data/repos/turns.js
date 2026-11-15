/**
 * data/repos/turns.js — turn storage + meter continuity queries.
 *
 * Rules (M2 S3 brief §3):
 * - Opening is ALWAYS computed from the previous closed turn on that nozzle.
 * - One open draft per nozzle (enforced by `nozzle_status` index).
 * - `seq` assigned inside the close transaction, then written.
 * - `closeTurnInTx` is the low-level primitive S5 will call to close several
 *   turns in one transaction; it maps `ConstraintError` on `nozzle_seq` to
 *   `CHAIN_CONFLICT`.
 */
import { ERROR_CODES, ValidationError } from '../errors.js';
import { readAll, readOne, writeOne, writeMany, txDone } from './tx.js';
import { validateTurnClose, validateCredits, validateInteger } from '../../core/validate.js';

const findDraftByNozzle = async (db, nozzleId) => {
  const rows = await readAll(db, 'turns', { index: 'nozzle_status', query: [nozzleId, 'draft'] });
  return rows[0] ?? null;
};

const getLastClosed = async (db, nozzleId) => {
  const store = db.transaction('turns', 'readonly').objectStore('turns');
  const index = store.index('nozzle_seq');
  const request = index.openCursor(
    [nozzleId, Infinity],
    'prev',
  );
  return new Promise((resolve, reject) => {
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && cursor.value.status === 'closed') {
        resolve(cursor.value);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
};

const IDBKeyRange = globalThis.IDBKeyRange;

/** Returns all rows for a nozzle from a composite-key index [nozzle_id, seq]. */
async function readAllByNozzleSeq(db, nozzleId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('turns', 'readonly');
    const index = tx.objectStore('turns').index('nozzle_seq');
    const range = IDBKeyRange.bound([nozzleId, -Infinity], [nozzleId, Infinity]);
    const request = index.getAll(range);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Returns `{ closing, seq, turnId } | null` for the latest closed turn on a nozzle. */
export async function lastClosing(db, nozzleId) {
  const rows = await readAllByNozzleSeq(db, nozzleId);
  const closed = rows.filter((row) => row.status === 'closed');
  if (closed.length === 0) return null;
  const last = closed[closed.length - 1];
  return { closing: last.closing, seq: last.seq, turnId: last.id };
}

/** Returns all closed turns on a nozzle in seq order (oldest first). */
export async function chain(db, nozzleId, { fromSeq = 1, toSeq = Infinity } = {}) {
  const rows = await readAllByNozzleSeq(db, nozzleId);
  return rows
    .filter((row) => row.status === 'closed' && row.seq >= fromSeq && row.seq <= toSeq)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Verifies the chain on a nozzle.
 * Returns an array of `{ type, seq, expected, actual, unaccounted?, note? }`.
 * Types: BREAK | ACKNOWLEDGED_GAP | ACKNOWLEDGED_REPLACEMENT | SEQ_GAP.
 */
export async function verifyChain(db, nozzleId) {
  const closed = await chain(db, nozzleId);
  const issues = [];

  for (let i = 1; i < closed.length; i += 1) {
    const prev = closed[i - 1];
    const curr = closed[i];

    if (curr.seq !== prev.seq + 1) {
      issues.push({ type: 'SEQ_GAP', seq: curr.seq, expected: prev.seq + 1, actual: curr.seq });
      continue;
    }

    if (curr.opening !== prev.closing) {
      if (curr.override?.reason === 'GAP_ACKNOWLEDGED') {
        issues.push({
          type: 'ACKNOWLEDGED_GAP',
          seq: curr.seq,
          expected: prev.closing,
          actual: curr.opening,
          unaccounted: curr.opening - prev.closing,
          note: curr.override?.note,
        });
      } else if (curr.override?.reason === 'METER_REPLACED') {
        issues.push({
          type: 'ACKNOWLEDGED_REPLACEMENT',
          seq: curr.seq,
          expected: prev.closing,
          actual: curr.opening,
          note: curr.override?.note,
        });
      } else {
        issues.push({
          type: 'BREAK',
          seq: curr.seq,
          expected: prev.closing,
          actual: curr.opening,
        });
      }
    }
  }

  return issues;
}

/**
 * Start a turn. Returns the turn (draft).
 * If an open draft on this nozzle exists for a different shift → NOZZLE_BUSY.
 * Same shift + same id → idempotent restart.
 */
async function startTurn({ db, now, newId, id, shiftId, nozzleId, operatorId, openingOverride }) {
  const existingDraft = await findDraftByNozzle(db, nozzleId);
  if (existingDraft) {
    if (existingDraft.shift_id !== shiftId) {
      throw new ValidationError(ERROR_CODES.NOZZLE_BUSY, `Nozzle ${nozzleId} has an open draft on shift ${existingDraft.shift_id}`);
    }
    if (existingDraft.id === id) return existingDraft; // idempotent restart
    throw new ValidationError(ERROR_CODES.NOZZLE_BUSY, `Nozzle ${nozzleId} has a different open draft`);
  }

  let opening;
  const last = await lastClosing(db, nozzleId);

  if (!last) {
    if (!openingOverride || openingOverride.reason !== 'FIRST_ENTRY') {
      throw new ValidationError(ERROR_CODES.OPENING_REQUIRED, 'First turn on this nozzle must include a FIRST_ENTRY override');
    }
    opening = openingOverride.value;
    openingOverride = { reason: 'FIRST_ENTRY', unaccounted: null, note: null };
  } else if (openingOverride) {
    if (openingOverride.reason === 'FIRST_ENTRY') {
      throw new ValidationError(ERROR_CODES.CHAIN_BREAK, 'FIRST_ENTRY only valid on a fresh nozzle');
    }
    if (!['GAP_ACKNOWLEDGED', 'METER_REPLACED'].includes(openingOverride.reason)) {
      throw new ValidationError(ERROR_CODES.CHAIN_BREAK, 'Override without a valid reason');
    }
    if (openingOverride.value !== last.closing) {
      const unaccounted = openingOverride.value - last.closing;
      opening = openingOverride.value;
      if (openingOverride.reason === 'GAP_ACKNOWLEDGED') {
        openingOverride = { reason: 'GAP_ACKNOWLEDGED', unaccounted, note: openingOverride.note ?? null };
      } else if (openingOverride.reason === 'METER_REPLACED') {
        openingOverride = { reason: 'METER_REPLACED', unaccounted: 0, note: openingOverride.note ?? null };
      }
    } else {
      opening = last.closing;
      openingOverride = { reason: openingOverride.reason, unaccounted: 0, note: openingOverride.note ?? null };
    }
  } else {
    opening = last.closing;
  }

  const turn = {
    id,
    shift_id: shiftId ?? null,
    nozzle_id: nozzleId,
    operator_id: operatorId ?? null,
    status: 'draft',
    opening,
    closing: null,
    testing: 0,
    credits: [],
    seq: null,
    override: openingOverride ?? null,
    started_at: now(),
    recorded_at: null,
  };
  return writeOne(db, 'turns', turn);
}

async function setClosing({ db, now, newId, id, closing }) {
  const turn = await readOne(db, 'turns', id);
  if (!turn) throw new ValidationError(ERROR_CODES.TURN_NOT_FOUND, `Turn ${id} not found`);
  if (turn.status === 'closed') throw new ValidationError(ERROR_CODES.TURN_ALREADY_CLOSED, `Turn ${id} is already closed`);

  const validated = validateTurnClose({ opening: turn.opening, closing });
  if (!validated.ok) throw new ValidationError(validated.code, validated.msg);

  return writeOne(db, 'turns', { ...turn, closing });
}

async function setTesting({ db, now, newId, id, testing }) {
  const turn = await readOne(db, 'turns', id);
  if (!turn) throw new ValidationError(ERROR_CODES.TURN_NOT_FOUND, `Turn ${id} not found`);
  if (turn.status === 'closed') throw new ValidationError(ERROR_CODES.TURN_ALREADY_CLOSED, `Turn ${id} is already closed`);

  const validated = validateInteger(testing, 'testing');
  if (!validated.ok) throw new ValidationError(validated.code, validated.msg);

  return writeOne(db, 'turns', { ...turn, testing });
}

async function setCredits({ db, now, newId, id, credits }) {
  const turn = await readOne(db, 'turns', id);
  if (!turn) throw new ValidationError(ERROR_CODES.TURN_NOT_FOUND, `Turn ${id} not found`);
  if (turn.status === 'closed') throw new ValidationError(ERROR_CODES.TURN_ALREADY_CLOSED, `Turn ${id} is already closed`);

  const validated = validateCredits(credits);
  if (!validated.ok) throw new ValidationError(validated.code, validated.msg);

  return writeOne(db, 'turns', { ...turn, credits });
}

/**
 * Close a single turn inside the given transaction.
 * Computes `seq` as max(seq) + 1 on that nozzle, writes the turn with
 * `status=closed`, `recorded_at=now()`, `seq`, and validates the chain
 * inside the transaction. Returns the closed turn.
 *
 * @param {IDBTransaction} tx
 * @param {string} id
 * @param {() => string} now
 * @param {() => string} newId
 * @returns {Promise<object>} the closed turn
 * @throws {ValidationError} CHAIN_CONFLICT on a unique-index violation
 */
export async function closeTurnInTx(tx, id, now, newId) {
  const store = tx.objectStore('turns');
  const turnRequest = store.get(id);
  const turn = await new Promise((resolve, reject) => {
    turnRequest.onsuccess = () => resolve(turnRequest.result ?? null);
    turnRequest.onerror = () => reject(turnRequest.error);
  });
  if (!turn) throw new ValidationError(ERROR_CODES.TURN_NOT_FOUND, `Turn ${id} not found`);
  if (turn.status === 'closed') throw new ValidationError(ERROR_CODES.TURN_ALREADY_CLOSED, `Turn ${id} is already closed`);

  // Rule 6: at close, testing + credits may not exceed the litres sold.
  const validated = validateTurnClose({
    opening: turn.opening,
    closing: turn.closing,
    testing: turn.testing ?? 0,
    credits: turn.credits ?? [],
  });
  if (!validated.ok) throw new ValidationError(validated.code, validated.msg);

  // Find the last closed turn on this nozzle inside this transaction
  const last = await new Promise((resolve, reject) => {
    const index = store.index('nozzle_seq');
    const IDBKeyRange = globalThis.IDBKeyRange;
    const range = IDBKeyRange.bound([turn.nozzle_id, -Infinity], [turn.nozzle_id, Infinity]);
    const request = index.getAll(range);
    request.onsuccess = () => {
      const rows = request.result.filter((row) => row.status === 'closed');
      resolve(rows.length > 0 ? rows[rows.length - 1] : null);
    };
    request.onerror = () => reject(request.error);
  });

  if (last) {
    if (turn.opening !== last.closing && !(turn.override?.reason && ['GAP_ACKNOWLEDGED', 'METER_REPLACED'].includes(turn.override.reason))) {
      throw new ValidationError(ERROR_CODES.CHAIN_CONFLICT, 'Chain broken while closing — another turn closed on this nozzle');
    }
  }

  const nextSeq = last ? last.seq + 1 : 1;

  const closedTurn = {
    ...turn,
    status: 'closed',
    recorded_at: now(),
    seq: nextSeq,
  };

  return new Promise((resolve, reject) => {
    const putRequest = store.put(closedTurn);
    putRequest.onsuccess = () => resolve(closedTurn);
    putRequest.onerror = () => {
      const error = putRequest.error;
      if (error?.name === 'ConstraintError') {
        reject(new ValidationError(ERROR_CODES.CHAIN_CONFLICT, 'Duplicate seq — another turn closed simultaneously'));
      } else {
        reject(error);
      }
    };
  });
}

/**
 * Public API, injected with the database handle.
 * @param {{db: IDBDatabase, now: () => string, newId: () => string}} deps
 */
export function makeTurnRepo({ db, now, newId }) {
  return {
    async start({ id, shiftId, nozzleId, operatorId, openingOverride }) {
      return startTurn({ db, now, newId, id, shiftId, nozzleId, operatorId, openingOverride });
    },
    async setClosing(id, closing) {
      return setClosing({ db, now, newId, id, closing });
    },
    async setTesting(id, testing) {
      return setTesting({ db, now, newId, id, testing });
    },
    async setCredits(id, credits) {
      return setCredits({ db, now, newId, id, credits });
    },
    async close(id) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('turns', 'readwrite');
        closeTurnInTx(tx, id, now, newId).then(resolve, reject);
      });
    },
    async get(id) {
      return readOne(db, 'turns', id);
    },
    async byShift(shiftId) {
      return readAll(db, 'turns', { index: 'shift_id', query: shiftId });
    },
    // expose the low-level primitive for S5
    _closeTurnInTx: (tx, id) => closeTurnInTx(tx, id, now, newId),
  };
}

/** Meter queries — stateless functions that take a database handle. */
export const meter = {
  lastClosing,
  chain,
  verifyChain,
};
