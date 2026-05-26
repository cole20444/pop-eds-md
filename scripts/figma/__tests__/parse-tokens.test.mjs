import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTokens } from '../parse-tokens.mjs';

const FIXTURE = new URL('./fixtures/styles-minimal.css', import.meta.url);

test('parses --pop-color-* into POP Brand / Color group', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  assert.equal(result.collections['POP Brand'].groups.Color['primary'].value, '#642CDB');
  assert.equal(result.collections['POP Brand'].groups.Color['primary'].cssVar, '--pop-color-primary');
  assert.equal(result.collections['POP Brand'].groups.Color['info'].value, '#3B82F6');
});

test('parses --pop-*-tint and --pop-*-ring into Block tints group', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  assert.equal(result.collections['POP Brand'].groups['Block tints']['note-tint'].value, '#EFF6FF');
});

test('resolves alias var() references and records the alias source', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  const noteRing = result.collections['POP Brand'].groups['Block tints']['note-ring'];
  assert.equal(noteRing.value, '#3B82F6'); // resolved from --pop-color-info
  assert.equal(noteRing.alias, '--pop-color-info');
});

test('parses --pop-block-* into Layout group', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  assert.equal(result.collections['POP Brand'].groups.Layout['block-radius'].value, '8px');
});

test('parses the real styles/styles.css without errors', async () => {
  const css = await readFile(new URL('../../../styles/styles.css', import.meta.url), 'utf8');
  const result = parseTokens(css);

  // Spot-check the known POP brand tokens from the spec
  assert.equal(result.collections['POP Brand'].groups.Color['primary'].value, '#642CDB');
  assert.equal(result.collections['POP Brand'].groups.Color['info'].value, '#3B82F6');
  assert.equal(result.collections['POP Brand'].groups.Color['danger'].value, '#EF4444');

  // Block tints
  assert.equal(result.collections['POP Brand'].groups['Block tints']['note-tint'].value, '#EFF6FF');
  assert.equal(result.collections['POP Brand'].groups['Block tints']['warning-tint'].value, '#FFFBEB');

  // Layout
  assert.equal(result.collections['POP Brand'].groups.Layout['block-radius'].value, '8px');

  // Foundation
  assert.ok(result.collections.Foundation.groups.Typography['body-font-family'].value.startsWith('Poppins'));
});

test('classifies header, nav, hover, breadcrumbs into the right Foundation groups', () => {
  const css = `:root {
    --header-bg-color: #0B1D59;
    --nav-height: 4rem;
    --hover-bg-color: rgba(50,50,50,.05);
    --brdcrmb-primary-color: #000;
    --brdcrmb-secondary-color: #000;
  }`;
  const result = parseTokens(css);
  assert.equal(result.collections.Foundation.groups.Header['header-bg-color'].value, '#0B1D59');
  assert.equal(result.collections.Foundation.groups.Layout['nav-height'].value, '4rem');
  assert.equal(result.collections.Foundation.groups.Color['hover-bg-color'].value, 'rgba(50,50,50,.05)');
  assert.equal(result.collections.Foundation.groups.Breadcrumbs['brdcrmb-primary-color'].value, '#000');
  assert.equal(result.collections.Foundation.groups.Breadcrumbs['brdcrmb-secondary-color'].value, '#000');
});
