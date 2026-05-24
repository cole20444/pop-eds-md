import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBlockCss } from '../parse-block-css.mjs';

const FIXTURE = new URL('./fixtures/warning.css', import.meta.url);

test('extracts only whitelisted properties from the top-level selector', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseBlockCss(css, 'warning');

  // Whitelisted properties present:
  assert.equal(result.properties['border-radius'], 'var(--pop-block-radius)');
  assert.equal(result.properties['background-color'], 'var(--pop-warning-tint)');
  // `font-size` is whitelisted
  assert.equal(result.properties['font-size'], 'var(--body-font-size-xs)');

  // Non-whitelisted properties skipped:
  assert.equal(result.properties['display'], undefined);
  assert.equal(result.properties['flex'], undefined);
});

test('normalizes `background` shorthand to `background-color` when value is colorish', async () => {
  const css = '.warning { background: var(--pop-warning-tint); }';
  const result = parseBlockCss(css, 'warning');
  assert.equal(result.properties['background-color'], 'var(--pop-warning-tint)');
});

test('ignores nested selectors (::before, > div)', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseBlockCss(css, 'warning');
  // The ::before block has `color: var(--pop-warning-ring)` but we should NOT
  // pick that up — it belongs to a different selector.
  assert.equal(result.properties['color'], undefined);
});

test('returns name and properties shape', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseBlockCss(css, 'warning');
  assert.equal(result.name, 'warning');
  assert.ok(typeof result.properties === 'object');
});
