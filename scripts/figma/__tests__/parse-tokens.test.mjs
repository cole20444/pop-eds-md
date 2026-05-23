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
