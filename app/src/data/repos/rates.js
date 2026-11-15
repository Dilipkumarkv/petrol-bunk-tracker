/**
 * data/repos/rates.js — price history (brief §4).
 *
 * Rates are append-only: a correction is a new row, never an edit. Dates are ISO
 * strings compared as strings, so there is no Date object and no timezone surprise.
 */
import { ERROR_CODES, ValidationError } from '../errors.js';
import { PRODUCTS } from './constants.js';
import { readAll, readOne, writeOne } from './tx.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Is this a real calendar day? Integer arithmetic only — no Date parsing.
 * @param {string} value
 * @returns {boolean}
 */
function isRealDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const limit = month === 2 && isLeapYear ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= limit;
}

function assertProduct(product) {
  if (!PRODUCTS.includes(product)) {
    throw new ValidationError(
      ERROR_CODES.RATE_UNKNOWN_PRODUCT,
      `product must be one of ${PRODUCTS.join(', ')}`,
    );
  }
}

function assertDate(effectiveFrom) {
  if (!isRealDate(effectiveFrom)) {
    throw new ValidationError(
      ERROR_CODES.RATE_INVALID_DATE,
      `effective_from must be a real YYYY-MM-DD date (got ${String(effectiveFrom)})`,
    );
  }
}

function assertPrice(pricePaise) {
  // 11086 is ₹110.86. A float, a string or anything <= 0 is a bug upstream.
  if (!Number.isSafeInteger(pricePaise) || pricePaise <= 0) {
    throw new ValidationError(
      ERROR_CODES.RATE_INVALID_PRICE,
      `price must be a positive integer of paise (got ${String(pricePaise)})`,
    );
  }
}

const newestFirst = (a, b) =>
  a.effective_from === b.effective_from ? 0 : a.effective_from < b.effective_from ? 1 : -1;

/**
 * @param {{db: IDBDatabase, now: () => string}} deps
 */
export function makeRateRepo({ db, now }) {
  return {
    /**
     * Append a rate. Rejects a second rate for the same product and day.
     * @param {string} product
     * @param {number} pricePaise integer paise per litre
     * @param {string} effectiveFrom ISO date
     * @returns {Promise<object>} the stored rate
     */
    async add(product, pricePaise, effectiveFrom) {
      assertProduct(product);
      assertPrice(pricePaise);
      assertDate(effectiveFrom);

      const existing = await readOne(db, 'rates', [product, effectiveFrom]);
      if (existing) {
        throw new ValidationError(
          ERROR_CODES.RATE_DUPLICATE,
          `${product} already has a rate from ${effectiveFrom} — append a new date instead`,
        );
      }

      const rate = {
        product,
        effective_from: effectiveFrom,
        price_paise: pricePaise,
        created_at: now(),
      };
      return writeOne(db, 'rates', rate);
    },

    /**
     * The rate in force on `date`: the newest row on or before it.
     * @param {string} product
     * @param {string} date ISO date
     * @returns {Promise<object>}
     * @throws {ValidationError} RATE_MISSING when no rate has ever applied
     */
    async current(product, date) {
      assertProduct(product);
      assertDate(date);

      const rows = await readAll(db, 'rates');
      const applicable = rows
        .filter((rate) => rate.product === product && rate.effective_from <= date)
        .sort(newestFirst);

      if (applicable.length === 0) {
        throw new ValidationError(
          ERROR_CODES.RATE_MISSING,
          `no ${product} rate on or before ${date} — enter one before a shift is closed`,
        );
      }
      return applicable[0];
    },

    /**
     * @param {string} product
     * @returns {Promise<object[]>} newest first
     */
    async history(product) {
      assertProduct(product);
      const rows = await readAll(db, 'rates');
      return rows.filter((rate) => rate.product === product).sort(newestFirst);
    },
  };
}
