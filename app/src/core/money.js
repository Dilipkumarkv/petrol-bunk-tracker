/**
 * core/money.js — pure money and volume arithmetic for the fuel tracker.
 *
 * §4 of the spec is the single source of truth for everything here.
 * No DOM, no storage, no network, no clock, no floating point.
 *
 * Units
 * -----
 * Litres   integer hundredths of a litre  (25687 = 256.87 L)          -> suffix `H`
 * Rate     integer paise per litre        (11086  = ₹110.86/L)
 * Amount   integer hundredths of a paise  (284766082 = ₹28,476.6082)  -> suffix `X100`
 *
 * Why amounts are in 1/100 paise
 * ------------------------------
 * §4.1 says `sales_paise = sales_litres × rate_paise`. With litres held as
 * hundredths, that is `salesLitresH × ratePaise / 100` — genuinely not an integer.
 * Truncating here would silently pre-empt the §4.4 rounding rule, which is still an
 * open decision (OQ-1). So this module keeps the value exact in integer hundredths of a
 * paise and the single division by 100 happens once, later, at the operator-shift total
 * where §4.4 applies. Nothing is lost and no float is ever created. See decisions.md D2.
 */

/** Litre hundredths in one litre. */
export const LITRES_PER_UNIT = 100;
/** Paise in one rupee. */
export const PAISE_PER_RUPEE = 100;
/** Hundredths of a paise in one paise. */
export const PAISE_X100_PER_PAISE = 100;

/**
 * Assert a value is an integer JavaScript number.
 * @param {unknown} value
 * @param {string} name field name for the error message
 * @returns {number} the same value, typed
 */
function assertInteger(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer (got ${String(value)})`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} is outside the safe integer range (got ${value})`);
  }
  return value;
}

/**
 * Assert an integer that must also be >= 0.
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
function assertNonNegativeInteger(value, name) {
  const n = assertInteger(value, name);
  if (n < 0) throw new RangeError(`${name} must not be negative (got ${n})`);
  return n;
}

/**
 * Per-nozzle turn arithmetic (§4.1).
 *
 *   litres       = closing - opening
 *   salesLitres  = litres - testing - Σ credits
 *   salesX100    = salesLitres × ratePaise        (exact, in 1/100 paise)
 *
 * Testing fuel goes back into the tank and credit litres were never cash sales, so both
 * are removed before pricing. Callers that deal with a TestingOnly nozzle must ignore
 * `salesX100` for it and report `litresH` as returned-to-tank instead — that is a nozzle
 * property, not arithmetic, so it is deliberately not decided here.
 *
 * Closure rule: `closing < opening` is physically impossible, so it throws rather than
 * returning a number. `validate.js` owns the friendly §6 message ("Closing is lower than
 * start. Check the meter."); this module is the invariant fence. See decisions.md D3.
 *
 * @param {number} opening   meter reading at shift start, litre hundredths
 * @param {number} closing   meter reading at shift end,   litre hundredths
 * @param {number} [testing=0]  litres run through the meter but not sold, litre hundredths
 * @param {number[]} [credits=[]] free/credit litres handed out, litre hundredths each
 * @param {number} ratePaise  price per litre, integer paise
 * @returns {{openingH:number, closingH:number, testingH:number, creditH:number,
 *            litresH:number, salesLitresH:number, ratePaise:number, salesX100:number}}
 * @throws {TypeError} for non-integer or non-numeric input (floats are never accepted)
 * @throws {RangeError} for negative input, or when testing + credits exceed litres
 */
export function nozzleSales(opening, closing, testing = 0, credits = [], ratePaise) {
  const openingH = assertNonNegativeInteger(opening, 'opening');
  const closingH = assertNonNegativeInteger(closing, 'closing');
  const testingH = assertNonNegativeInteger(testing, 'testing');
  const rate = assertNonNegativeInteger(ratePaise, 'ratePaise');

  if (!Array.isArray(credits)) {
    throw new TypeError(`credits must be an array (got ${typeof credits})`);
  }
  const creditH = credits.reduce(
    (sum, litres, i) => sum + assertNonNegativeInteger(litres, `credits[${i}]`),
    0,
  );

  if (closingH < openingH) {
    throw new RangeError(
      `Closing reading (${closingH}) is lower than opening (${openingH}) — check the meter`,
    );
  }

  const litresH = closingH - openingH;
  const salesLitresH = litresH - testingH - creditH;

  if (salesLitresH < 0) {
    throw new RangeError(
      `Sales litres would be negative (${salesLitresH}): testing (${testingH}) plus credits ` +
        `(${creditH}) exceed litres (${litresH})`,
    );
  }

  const salesX100 = salesLitresH * rate;

  return Object.freeze({
    openingH,
    closingH,
    testingH,
    creditH,
    litresH,
    salesLitresH,
    ratePaise: rate,
    salesX100: assertInteger(salesX100, 'salesX100'),
  });
}
