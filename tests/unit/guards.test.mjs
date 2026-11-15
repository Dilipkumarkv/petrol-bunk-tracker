// S2 · guard rules (brief §7) — static checks on the repository sources.
// These are cheap tripwires for rules that are otherwise easy to break by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const REPO_DIR = new URL('../../app/src/data/repos/', import.meta.url);
const sources = readdirSync(REPO_DIR)
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({ file, source: readFileSync(new URL(file, REPO_DIR), 'utf8') }));

test('there are repository sources to check', () => {
  assert.ok(sources.length >= 4, `expected the S2 files, found ${sources.length}`);
});

test('no store is ever deleted or cleared in these repos', () => {
  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /\.delete\s*\(/, `${file} must not delete rows`);
    assert.doesNotMatch(source, /\.clear\s*\(/, `${file} must not clear a store`);
    assert.doesNotMatch(source, /deleteDatabase/, `${file} must not drop databases`);
  }
});

test('time and ids are injected, never taken from the globe', () => {
  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /Date\.now\s*\(/, `${file} must use the injected now()`);
    assert.doesNotMatch(source, /new Date\s*\(/, `${file} must not build Date objects`);
    assert.doesNotMatch(source, /crypto\.randomUUID/, `${file} must use the injected newId()`);
    assert.doesNotMatch(source, /Math\.random/, `${file} must be deterministic`);
  }
});

test('no floats, no toFixed, no /ui imports in the data layer', () => {
  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /\btoFixed\s*\(/, `${file}: no toFixed on money`);
    assert.doesNotMatch(source, /\bparseFloat\s*\(/, `${file}: no parseFloat on money`);
    assert.doesNotMatch(source, /from\s+['"][^'"]*\/ui\//, `${file}: no UI imports`);
  }
});

test('ValidationError is always constructed with a shared code constant', () => {
  for (const { file, source } of sources) {
    if (file === 'errors.js') continue;
    assert.doesNotMatch(
      source,
      /new ValidationError\(\s*['"]/,
      `${file} must pass ERROR_CODES.X, not a string literal`,
    );
  }
});
