/**
 * data/repos/operators.js — the 12-odd people who take shifts (brief §5).
 *
 * Names are free text in Kannada or English. De-duplication is by `nameNorm`, which
 * normalises Latin diacritics away but preserves Kannada combining marks — see
 * text.js for why that distinction matters.
 */
import { ERROR_CODES, ValidationError } from '../errors.js';
import { MAX_OPERATOR_NAME_LENGTH } from './constants.js';
import { readAll, readOne, writeOne } from './tx.js';
import { normalizeName, editDistance, cleanDisplayName } from './text.js';

const byName = (a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1);

/**
 * @param {{db: IDBDatabase, now: () => string, newId: () => string}} deps
 */
export function makeOperatorRepo({ db, now, newId }) {
  async function requireOperator(id) {
    const operator = await readOne(db, 'operators', id);
    if (!operator) throw new ValidationError(ERROR_CODES.OPERATOR_NOT_FOUND, `no operator ${id}`);
    return operator;
  }

  return {
    /**
     * Resolve a typed name to one operator: existing if `nameNorm` matches,
     * otherwise newly created. Never renames — that needs the audit log (S6).
     * @param {string} name
     * @returns {Promise<{operator: object, created: boolean}>}
     */
    async upsertByName(name) {
      if (typeof name !== 'string') {
        throw new ValidationError(ERROR_CODES.OPERATOR_NAME_REQUIRED, 'operator name is required');
      }
      const display = cleanDisplayName(name);
      if (display === '') {
        throw new ValidationError(ERROR_CODES.OPERATOR_NAME_REQUIRED, 'operator name is required');
      }
      if ([...display].length > MAX_OPERATOR_NAME_LENGTH) {
        throw new ValidationError(
          ERROR_CODES.OPERATOR_NAME_TOO_LONG,
          `operator name must be at most ${MAX_OPERATOR_NAME_LENGTH} characters`,
        );
      }

      const nameNorm = normalizeName(display);
      const rows = await readAll(db, 'operators');
      const existing = rows.find((operator) => operator.nameNorm === nameNorm);
      if (existing) return { operator: existing, created: false };

      const operator = {
        id: newId(),
        name: display,
        nameNorm,
        active: true,
        created_at: now(),
      };
      return { operator: await writeOne(db, 'operators', operator), created: true };
    },

    /**
     * @param {{activeOnly?: boolean}} [options]
     * @returns {Promise<object[]>} sorted by name
     */
    async list({ activeOnly = true } = {}) {
      const rows = await readAll(db, 'operators');
      const visible = activeOnly ? rows.filter((operator) => operator.active !== false) : rows;
      return visible.sort(byName);
    },

    /**
     * @param {string} id
     * @returns {Promise<object|null>} null when unknown
     */
    async get(id) {
      return readOne(db, 'operators', id);
    },

    /**
     * Soft-delete: past shifts keep resolving the person.
     * @param {string} id
     * @returns {Promise<object>}
     */
    async deactivate(id) {
      const operator = await requireOperator(id);
      return writeOne(db, 'operators', { ...operator, active: false });
    },

    /**
     * @param {string} id
     * @returns {Promise<object>}
     */
    async reactivate(id) {
      const operator = await requireOperator(id);
      return writeOne(db, 'operators', { ...operator, active: true });
    },

    /**
     * "Did you mean Raju?" — active operators one typo away, never the exact match.
     * @param {string} name
     * @param {number} [maxDistance=1]
     * @returns {Promise<object[]>} closest first, then by name
     */
    async findSimilar(name, maxDistance = 1) {
      if (typeof name !== 'string') {
        throw new ValidationError(ERROR_CODES.OPERATOR_NAME_REQUIRED, 'operator name is required');
      }
      const target = normalizeName(name);
      const rows = await readAll(db, 'operators');
      const scored = [];

      for (const operator of rows) {
        if (operator.active === false) continue;
        const distance = editDistance(target, operator.nameNorm);
        if (distance > 0 && distance <= maxDistance) scored.push({ operator, distance });
      }

      return scored
        .sort((a, b) => a.distance - b.distance || byName(a.operator, b.operator))
        .map((hit) => hit.operator);
    },
  };
}
