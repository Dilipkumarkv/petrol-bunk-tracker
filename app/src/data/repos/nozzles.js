/**
 * data/repos/nozzles.js — nozzle master data (brief §3).
 *
 * Nozzles are never hard-deleted: turns and readings reference them forever, so
 * `deactivate` only flips `active`.
 */
import { ERROR_CODES, ValidationError } from '../errors.js';
import { PRODUCTS, USES, SHEETS, DEFAULT_NOZZLES } from './constants.js';
import { readAll, readOne, writeOne, writeMany } from './tx.js';

const bySheetThenLabel = (a, b) => {
  if (a.sheet !== b.sheet) return a.sheet < b.sheet ? -1 : 1;
  if (a.label === b.label) return 0;
  return a.label < b.label ? -1 : 1;
};

function assertLabel(nozzle) {
  if (typeof nozzle.label !== 'string' || nozzle.label.trim() === '') {
    throw new ValidationError(ERROR_CODES.NOZZLE_LABEL_REQUIRED, 'nozzle label is required');
  }
}

function assertEnums(nozzle) {
  if (!PRODUCTS.includes(nozzle.product)) {
    throw new ValidationError(
      ERROR_CODES.NOZZLE_BAD_PRODUCT,
      `product must be one of ${PRODUCTS.join(', ')}`,
    );
  }
  if (!USES.includes(nozzle.use)) {
    throw new ValidationError(ERROR_CODES.NOZZLE_BAD_USE, `use must be one of ${USES.join(', ')}`);
  }
  if (!SHEETS.includes(nozzle.sheet)) {
    throw new ValidationError(
      ERROR_CODES.NOZZLE_BAD_SHEET,
      `sheet must be one of ${SHEETS.join(', ')}`,
    );
  }
}

/**
 * @param {{db: IDBDatabase, now: () => string, newId: () => string}} deps
 */
export function makeNozzleRepo({ db }) {
  return {
    /**
     * Insert the 10 defaults that are not already present. Existing rows — including
     * any user edits — are left exactly as they are.
     * @returns {Promise<{inserted: number, total: number}>}
     */
    async seedDefaults() {
      const existing = await readAll(db, 'nozzles');
      const present = new Set(existing.map((nozzle) => nozzle.id));
      const missing = DEFAULT_NOZZLES.filter((nozzle) => !present.has(nozzle.id)).map((nozzle) => ({
        ...nozzle,
        active: true,
      }));

      await writeMany(db, 'nozzles', missing);
      return { inserted: missing.length, total: existing.length + missing.length };
    },

    /**
     * @param {{activeOnly?: boolean}} [options]
     * @returns {Promise<object[]>} sorted by sheet, then label
     */
    async list({ activeOnly = true } = {}) {
      const rows = await readAll(db, 'nozzles');
      const visible = activeOnly ? rows.filter((nozzle) => nozzle.active !== false) : rows;
      return visible.sort(bySheetThenLabel);
    },

    /**
     * @param {string} id
     * @returns {Promise<object|null>} null when unknown
     */
    async get(id) {
      return readOne(db, 'nozzles', id);
    },

    /**
     * Validate and write a nozzle. Inserts when the id is new, updates otherwise.
     * @param {object} nozzle
     * @returns {Promise<object>} the stored nozzle
     */
    async upsert(nozzle) {
      if (typeof nozzle?.id !== 'string' || nozzle.id.trim() === '') {
        throw new ValidationError(ERROR_CODES.NOZZLE_ID_REQUIRED, 'nozzle id is required');
      }
      assertLabel(nozzle);
      assertEnums(nozzle);

      const rows = await readAll(db, 'nozzles');
      const label = nozzle.label.trim().toLowerCase();
      const clash = rows.find(
        (other) =>
          other.id !== nozzle.id &&
          other.active !== false &&
          String(other.label).trim().toLowerCase() === label,
      );
      if (clash) {
        throw new ValidationError(
          ERROR_CODES.NOZZLE_LABEL_DUPLICATE,
          `label ${nozzle.label} is already used by an active nozzle`,
        );
      }

      const stored = {
        id: nozzle.id,
        label: nozzle.label.trim(),
        product: nozzle.product,
        use: nozzle.use,
        sheet: nozzle.sheet,
        active: nozzle.active !== false,
      };
      return writeOne(db, 'nozzles', stored);
    },

    /**
     * Switch a nozzle between Sales and TestingOnly.
     * @param {string} id
     * @param {'Sales'|'TestingOnly'} use
     * @returns {Promise<object>} the updated nozzle
     */
    async setUse(id, use) {
      if (!USES.includes(use)) {
        throw new ValidationError(ERROR_CODES.NOZZLE_BAD_USE, `use must be one of ${USES.join(', ')}`);
      }
      const nozzle = await readOne(db, 'nozzles', id);
      if (!nozzle) throw new ValidationError(ERROR_CODES.NOZZLE_NOT_FOUND, `no nozzle ${id}`);
      return writeOne(db, 'nozzles', { ...nozzle, use });
    },

    /**
     * Soft-delete: history keeps resolving the nozzle.
     * @param {string} id
     * @returns {Promise<object>} the deactivated nozzle
     */
    async deactivate(id) {
      const nozzle = await readOne(db, 'nozzles', id);
      if (!nozzle) throw new ValidationError(ERROR_CODES.NOZZLE_NOT_FOUND, `no nozzle ${id}`);
      return writeOne(db, 'nozzles', { ...nozzle, active: false });
    },
  };
}
