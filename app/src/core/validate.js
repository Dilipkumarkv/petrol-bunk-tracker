/**
 * core/validate.js — pure validation for litres and turns.
 *
 * Every function returns `{ ok: true }` on success, or `{ ok: false, code, msg, level? }`
 * where `code` maps to the data-layer `ERROR_CODES` and `msg` is ready to show on screen.
 * No arithmetic on money. No DOM. No storage.
 */

/** Validates that `value` is a non-negative safe integer. */
export function validateInteger(value, fieldName = 'value') {
  if (!Number.isSafeInteger(value)) {
    return { ok: false, code: 'NOT_INTEGER', msg: `${fieldName} must be an integer (got ${String(value)})` };
  }
  if (value < 0) {
    return { ok: false, code: 'NEGATIVE', msg: `${fieldName} must not be negative` };
  }
  return { ok: true };
}

/** Validates a credit-litres array. */
export function validateCredits(credits) {
  if (!Array.isArray(credits)) {
    return { ok: false, code: 'NOT_INTEGER', msg: 'credits must be an array' };
  }
  for (const entry of credits) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, code: 'NOT_INTEGER', msg: 'each credit must be { label, litres }' };
    }
    const litres = validateInteger(entry.litres, 'credit litres');
    if (!litres.ok) return litres;
  }
  return { ok: true };
}

/**
 * Validates the closing reading, testing litres and credit litres against the opening.
 * Returns `{ ok: true }` or the first blocking rule.
 */
export function validateTurnClose({ opening, closing, testing = 0, credits = [] }) {
  const o = validateInteger(opening, 'opening');
  if (!o.ok) return o;
  const c = validateInteger(closing, 'closing');
  if (!c.ok) return c;

  if (closing < opening) {
    return { ok: false, code: 'CLOSING_BELOW_OPENING', msg: 'Closing is lower than start. Check the meter.' };
  }
  if (closing === opening) {
    return { ok: true, code: 'ZERO_LITRES', level: 'warn', msg: 'No fuel sold on this nozzle?' };
  }

  const litres = closing - opening;
  const testingResult = validateInteger(testing, 'testing');
  if (!testingResult.ok) return testingResult;

  const creditsResult = validateCredits(credits);
  if (!creditsResult.ok) return creditsResult;

  const totalCredits = credits.reduce((sum, entry) => sum + entry.litres, 0);
  if (testing + totalCredits > litres) {
    return {
      ok: false,
      code: 'SALES_NEGATIVE',
      msg: 'Testing plus credit litres exceed litres sold. Check the numbers.',
    };
  }

  return { ok: true };
}
