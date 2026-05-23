import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCrossCollectionWrite,
  isUnmappedComponent,
  isSidenavJsWrite,
  isWhitelistedProperty,
} from '../safety.mjs';

test('cross-collection write: POP Brand writing to a foundation var is refused', () => {
  assert.equal(isCrossCollectionWrite('POP Brand', '--body-font-family'), true);
  assert.equal(isCrossCollectionWrite('Foundation', '--pop-color-primary'), true);
});

test('same-collection write is allowed', () => {
  assert.equal(isCrossCollectionWrite('POP Brand', '--pop-color-primary'), false);
  assert.equal(isCrossCollectionWrite('Foundation', '--body-font-family'), false);
});

test('unmapped component name (not in sync-state.components) is refused', () => {
  const knownComponents = ['Note', 'Warning', 'Tip'];
  assert.equal(isUnmappedComponent('Callout', knownComponents), true);
  assert.equal(isUnmappedComponent('Note', knownComponents), false);
});

test('writes to blocks/sidenav/sidenav.js are refused', () => {
  assert.equal(isSidenavJsWrite('blocks/sidenav/sidenav.js'), true);
  assert.equal(isSidenavJsWrite('blocks/sidenav/sidenav_data.js'), true);
  assert.equal(isSidenavJsWrite('blocks/sidenav/sidenav.css'), false);
});

test('non-whitelisted property is rejected', () => {
  assert.equal(isWhitelistedProperty('border-radius'), true);
  assert.equal(isWhitelistedProperty('color'), true);
  assert.equal(isWhitelistedProperty('box-shadow'), false);
  assert.equal(isWhitelistedProperty('transform'), false);
});
