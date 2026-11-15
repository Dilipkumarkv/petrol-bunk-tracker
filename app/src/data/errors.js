/**
 * data/errors.js — the one place error codes live.
 *
 * Callers compare `error.code` against these constants; never against string
 * literals, so a typo becomes a missing property instead of a silent no-match.
 */

/** Every validation/failure code the data layer can raise. */
export const ERROR_CODES = Object.freeze({
  NOZZLE_ID_REQUIRED: 'NOZZLE_ID_REQUIRED',
  NOZZLE_LABEL_REQUIRED: 'NOZZLE_LABEL_REQUIRED',
  NOZZLE_BAD_PRODUCT: 'NOZZLE_BAD_PRODUCT',
  NOZZLE_BAD_USE: 'NOZZLE_BAD_USE',
  NOZZLE_BAD_SHEET: 'NOZZLE_BAD_SHEET',
  NOZZLE_LABEL_DUPLICATE: 'NOZZLE_LABEL_DUPLICATE',
  NOZZLE_NOT_FOUND: 'NOZZLE_NOT_FOUND',

  RATE_DUPLICATE: 'RATE_DUPLICATE',
  RATE_MISSING: 'RATE_MISSING',
  RATE_INVALID_PRICE: 'RATE_INVALID_PRICE',
  RATE_INVALID_DATE: 'RATE_INVALID_DATE',
  RATE_UNKNOWN_PRODUCT: 'RATE_UNKNOWN_PRODUCT',

  OPERATOR_NAME_REQUIRED: 'OPERATOR_NAME_REQUIRED',
  OPERATOR_NAME_TOO_LONG: 'OPERATOR_NAME_TOO_LONG',
  OPERATOR_NOT_FOUND: 'OPERATOR_NOT_FOUND',
});

/**
 * A rejected write, carrying a stable machine-readable code.
 * `message` is for developers; the UI maps `code` to translated copy.
 */
export class ValidationError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message ?? code);
    this.name = 'ValidationError';
    this.code = code;
  }
}
