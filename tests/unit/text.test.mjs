// S2 · text.js — name normalisation (brief §5.1).
// The critical rule: diacritic stripping applies to LATIN letters only.
// Kannada vowel signs are combining marks; stripping them would merge different people.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, editDistance } from '../../app/src/data/repos/text.js';

test('trims and collapses inner whitespace, lowercases', () => {
  assert.equal(normalizeName('  Raju   K '), 'raju k');
  assert.equal(normalizeName('A\tB\nC'), 'a b c');
});

test('case variants all normalise to the same string', () => {
  const forms = ['RAJU', 'raju', 'Raju', '  rAjU  '];
  for (const form of forms) assert.equal(normalizeName(form), 'raju', form);
});

test('Latin diacritics are stripped: José equals Jose', () => {
  assert.equal(normalizeName('José'), 'jose');
  assert.equal(normalizeName('JOSE'), normalizeName('José'));
  assert.equal(normalizeName('François'), 'francois');
  assert.equal(normalizeName('Ãlvaro'), 'alvaro');
});

test('Kannada is NEVER diacritic-stripped — ರಾಜು and ರಾಜ stay distinct', () => {
  const raaju = 'ರಾಜು';
  const raaja = 'ರಾಜ';
  assert.equal(normalizeName(raaju), raaju, 'every combining mark preserved');
  assert.equal(normalizeName(raaja), raaja);
  assert.notEqual(normalizeName(raaju), normalizeName(raaja), 'must not merge two people');
  // the final ು is a combining mark: prove it survived explicitly
  assert.equal([...normalizeName(raaju)].length, [...raaju].length);
});

test('mixed scripts normalise each part by its own rules', () => {
  assert.equal(normalizeName('Raju ರಾಜು'), 'raju ರಾಜು');
  assert.equal(normalizeName('  José   ರಾಜ  '), 'jose ರಾಜ');
});

test('NFC and NFD spellings of the same Kannda name agree', () => {
  const composed = 'ರಾಜು';
  const decomposed = composed.normalize('NFD');
  assert.equal(normalizeName(decomposed), normalizeName(composed));
  assert.equal(normalizeName(decomposed), composed.normalize('NFC'));
});

test('normalisation is idempotent', () => {
  for (const sample of ['  Raju   K ', 'José', 'ರಾಜು', 'Raju ರಾಜು', 'İstanbul', 'ＡＢＣ']) {
    const once = normalizeName(sample);
    assert.equal(normalizeName(once), once, `idempotent for ${JSON.stringify(sample)}`);
  }
});

test('non-string input is rejected', () => {
  assert.throws(() => normalizeName(null), TypeError);
  assert.throws(() => normalizeName(42), TypeError);
});

test('editDistance counts code points, not UTF-16 units', () => {
  assert.equal(editDistance('raju', 'raju'), 0);
  assert.equal(editDistance('raju', 'rajo'), 1);
  assert.equal(editDistance('raju', 'ravi'), 2);
  assert.equal(editDistance('', 'abc'), 3);
  // one Kannada vowel sign apart is a distance of 1
  assert.equal(editDistance('ರಾಜು', 'ರಾಜ'), 1);
});
