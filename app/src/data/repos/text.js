/**
 * data/repos/text.js — name normalisation and edit distance. Pure, no storage.
 *
 * The subtle requirement (brief §5.1): "diacritic-insensitive" applies to LATIN
 * letters only. Kannada vowel signs (ಾ ಿ ು ೆ) are combining marks too — stripping
 * them would collapse ರಾಜು and ರಾಜ into one operator, which is a data-loss bug.
 */

const COMBINING_MARK = /\p{M}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * Remove combining marks that sit on a Latin base letter; keep every mark whose
 * base is in another script.
 * @param {string} input already case-folded
 * @returns {string} NFC
 */
function stripLatinMarks(input) {
  const decomposed = input.normalize('NFD');
  let out = '';
  let baseIsLatin = false;

  for (const char of decomposed) {
    if (COMBINING_MARK.test(char)) {
      if (!baseIsLatin) out += char;
      continue;
    }
    out += char;
    baseIsLatin = LATIN.test(char);
  }

  return out.normalize('NFC');
}

/**
 * Normalise an operator name for de-duplication.
 *
 * Order matters: case-fold before stripping marks, otherwise a character such as
 * "İ" (whose lowercase is "i" + combining dot) would gain a mark on one pass and
 * lose it on the next, breaking idempotency.
 *
 * @param {string} value raw name as typed
 * @returns {string} NFC, trimmed, single-spaced, Latin-lowercased, Latin marks removed
 * @throws {TypeError} when value is not a string
 */
export function normalizeName(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`name must be a string (got ${typeof value})`);
  }
  const collapsed = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  const folded = collapsed.toLowerCase().normalize('NFC');
  return stripLatinMarks(folded);
}

/**
 * Levenshtein distance over code points (so a Kannada vowel sign counts as one).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  const left = [...a];
  const right = [...b];
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }

  return previous[right.length];
}

/** Display form: trimmed, single-spaced, original casing preserved. */
export function cleanDisplayName(value) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}
