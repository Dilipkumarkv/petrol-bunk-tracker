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

/* ------------------------------------------------------------------------- *
 * Rounding — owner-confirmed 2026-11-15 (closes OQ-1)
 *
 *   Petrol & Diesel : per operator-shift, per product: sum net litres, x rate,
 *                     TRUNCATE to whole rupees
 *   XP              : round half-up to whole rupees (.50 and above up)
 *   tolerance       : +/- 1 rupee at flag time
 *
 * The rounding site is the shift total per product — never a single nozzle turn,
 * never the combined shift total (that would round across products).
 * Known exception accepted by the owner: p.27 records 17,709.885 as 17,710;
 * truncation yields 17,709 and the ₹1 gap sits inside the tolerance.
 * See decisions.md D6.
 * ------------------------------------------------------------------------- */

/** Owner-confirmed rounding policy per product. */
export const ROUNDING_POLICY = Object.freeze({
  Petrol: 'truncate',
  Diesel: 'truncate',
  XP: 'half-up',
});

/** Units of 1/100 paise in one rupee: 100 paise x 100 hundredths-of-a-paise. */
export const X100_PER_RUPEE = 10000;

/** §4.2 default flag tolerance: ₹1, owner-configurable. */
export const DEFAULT_TOLERANCE_PAISE = 100;

/**
 * Exact integer division for non-negative safe integers.
 * Avoids producing a fractional intermediate for money, which `x / y` would.
 * @param {number} n
 * @param {number} d
 * @returns {number}
 */
function divExact(n, d) {
  return (n - (n % d)) / d;
}

/**
 * The rounding policy for a product.
 * @param {string} product Petrol | Diesel | XP
 * @returns {'truncate'|'half-up'}
 * @throws {TypeError|RangeError} for a non-string or an unknown product
 */
export function policyFor(product) {
  if (typeof product !== 'string') {
    throw new TypeError(`product must be a string (got ${typeof product})`);
  }
  const policy = ROUNDING_POLICY[product];
  if (!policy) {
    throw new RangeError(`no rounding policy for product "${product}" — refused rather than guessed`);
  }
  return policy;
}

/**
 * Round an exact amount (1/100 paise) to whole rupees.
 *
 * @param {number} amountX100 exact amount from `nozzleSales().salesX100`
 * @param {'truncate'|'half-up'} policy
 * @returns {number} whole rupees as integer paise
 * @throws {TypeError} non-integer input
 * @throws {RangeError} negative amount or unknown policy
 */
export function roundToRupees(amountX100, policy) {
  const x = assertInteger(amountX100, 'amountX100');
  if (x < 0) {
    throw new RangeError(`amountX100 must not be negative (got ${x})`);
  }
  if (policy === 'truncate') {
    return divExact(x, X100_PER_RUPEE) * PAISE_PER_RUPEE;
  }
  if (policy === 'half-up') {
    // +0.50 rupee before truncating turns ".50 and above" into a round-up and is
    // still pure integer arithmetic.
    return divExact(x + X100_PER_RUPEE / 2, X100_PER_RUPEE) * PAISE_PER_RUPEE;
  }
  throw new RangeError(`unknown rounding policy "${policy}"`);
}

/**
 * Round a shift's nozzle turns, per product.
 *
 * Turns are grouped by product **and rate**, so a rate change mid-shift can never
 * multiply litres by the wrong price; with a single rate the result is identical to
 * grouping by product alone. Order of the returned groups is stable (product, then
 * rate) so the same shift always produces the same output.
 *
 * @param {ReadonlyArray<{product: string, ratePaise: number, salesLitresH: number, salesX100: number}>} turns
 * @returns {{groups: ReadonlyArray<object>, totalPaise: number, totalSalesLitresH: number}}
 */
export function shiftSales(turns) {
  if (!Array.isArray(turns)) {
    throw new TypeError(`turns must be an array (got ${typeof turns})`);
  }

  const groups = new Map();
  turns.forEach((turn, i) => {
    if (!turn || typeof turn !== 'object') {
      throw new TypeError(`turns[${i}] must be an object`);
    }
    const policy = policyFor(turn.product);
    const ratePaise = assertNonNegativeInteger(turn.ratePaise, `turns[${i}].ratePaise`);
    const salesLitresH = assertNonNegativeInteger(turn.salesLitresH, `turns[${i}].salesLitresH`);
    const salesX100 = assertNonNegativeInteger(turn.salesX100, `turns[${i}].salesX100`);

    const key = `${turn.product}\u0000${ratePaise}`;
    const group = groups.get(key) ?? {
      product: turn.product,
      ratePaise,
      policy,
      salesLitresH: 0,
      exactX100: 0,
    };
    group.salesLitresH += salesLitresH;
    group.exactX100 += salesX100;
    groups.set(key, group);
  });

  const rounded = [...groups.values()]
    .map((group) =>
      Object.freeze({ ...group, roundedPaise: roundToRupees(group.exactX100, group.policy) }),
    )
    .sort((a, b) =>
      a.product === b.product ? a.ratePaise - b.ratePaise : a.product < b.product ? -1 : 1,
    );

  return Object.freeze({
    groups: Object.freeze(rounded),
    totalPaise: rounded.reduce((sum, group) => sum + group.roundedPaise, 0),
    totalSalesLitresH: rounded.reduce((sum, group) => sum + group.salesLitresH, 0),
  });
}

/**
 * Classify the gap between cash deposited and cash expected (§4.2).
 *
 * @param {number} diffPaise cash_deposited - expected_cash, integer paise
 * @param {number} [tolerancePaise] defaults to ₹1
 * @returns {'SHORT'|'EXCESS'|'OK'}
 */
export function flagFor(diffPaise, tolerancePaise = DEFAULT_TOLERANCE_PAISE) {
  const diff = assertInteger(diffPaise, 'diffPaise');
  const tolerance = assertNonNegativeInteger(tolerancePaise, 'tolerancePaise');
  if (diff < 0 && diff <= -tolerance) return 'SHORT';
  if (diff > 0 && diff >= tolerance) return 'EXCESS';
  return 'OK';
}
