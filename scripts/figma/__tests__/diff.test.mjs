import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffTokens } from '../diff.mjs';

const BASE = {
  'POP Brand': {
    'Color/primary': { value: '#642CDB', cssVar: '--pop-color-primary' },
    'Color/info':    { value: '#3B82F6', cssVar: '--pop-color-info' },
  },
};

test('detects FIGMA changed, CODE unchanged → apply', () => {
  const figma = {
    'POP Brand': {
      'Color/primary': { value: '#FF0000', cssVar: '--pop-color-primary' },
      'Color/info':    { value: '#3B82F6', cssVar: '--pop-color-info' },
    },
  };
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.apply.length, 1);
  assert.deepEqual(diff.apply[0], {
    collection: 'POP Brand',
    name: 'Color/primary',
    cssVar: '--pop-color-primary',
    from: '#642CDB',
    to: '#FF0000',
  });
});

test('detects FIGMA unchanged, CODE changed → drift', () => {
  const figma = BASE;
  const code = { '--pop-color-primary': '#000000', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.drift.length, 1);
  assert.equal(diff.drift[0].cssVar, '--pop-color-primary');
});

test('detects FIGMA and CODE both changed → conflict', () => {
  const figma = {
    'POP Brand': {
      'Color/primary': { value: '#FF0000', cssVar: '--pop-color-primary' },
      'Color/info':    { value: '#3B82F6', cssVar: '--pop-color-info' },
    },
  };
  const code = { '--pop-color-primary': '#00FF00', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.conflict.length, 1);
  assert.deepEqual(diff.conflict[0], {
    collection: 'POP Brand',
    name: 'Color/primary',
    cssVar: '--pop-color-primary',
    base: '#642CDB',
    figma: '#FF0000',
    code: '#00FF00',
  });
});

test('detects added in FIGMA → proposeAdd', () => {
  const figma = {
    'POP Brand': {
      ...BASE['POP Brand'],
      'Color/accent': { value: '#FFFF00', cssVar: '--pop-color-accent' },
    },
  };
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.proposeAdd.length, 1);
  assert.equal(diff.proposeAdd[0].cssVar, '--pop-color-accent');
});

test('detects removed from FIGMA → deprecated (never auto-remove)', () => {
  const figma = {
    'POP Brand': {
      'Color/primary': { value: '#642CDB', cssVar: '--pop-color-primary' },
      // Color/info missing
    },
  };
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.deprecated.length, 1);
  assert.equal(diff.deprecated[0].cssVar, '--pop-color-info');
  // critically: NOT in `apply`
  assert.equal(diff.apply.length, 0);
});

test('no changes → all categories empty', () => {
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, BASE, code);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.drift.length, 0);
  assert.equal(diff.conflict.length, 0);
  assert.equal(diff.proposeAdd.length, 0);
  assert.equal(diff.deprecated.length, 0);
});

// ---------------------------------------------------------------------------
// diffComponents tests
// ---------------------------------------------------------------------------

import { diffComponents } from '../diff.mjs';

const BASE_COMPS = {
  Warning: {
    blockFolder: 'blocks/warning',
    properties: {
      'border-color': 'var(--pop-warning-ring)',
      'border-radius': 'var(--pop-block-radius)',
    },
  },
};

test('component property: FIGMA changed, CODE unchanged → apply', () => {
  const figma = {
    Warning: {
      blockFolder: 'blocks/warning',
      properties: {
        'border-color': '#FF0000',
        'border-radius': 'var(--pop-block-radius)',
      },
    },
  };
  const codeByBlock = {
    Warning: {
      'border-color': 'var(--pop-warning-ring)',
      'border-radius': 'var(--pop-block-radius)',
    },
  };
  const diff = diffComponents(BASE_COMPS, figma, codeByBlock);
  assert.equal(diff.apply.length, 1);
  assert.deepEqual(diff.apply[0], {
    component: 'Warning',
    blockFolder: 'blocks/warning',
    property: 'border-color',
    from: 'var(--pop-warning-ring)',
    to: '#FF0000',
  });
});

test('component property: drift surfaces but no apply', () => {
  const figma = BASE_COMPS;
  const codeByBlock = {
    Warning: {
      'border-color': '#000',
      'border-radius': 'var(--pop-block-radius)',
    },
  };
  const diff = diffComponents(BASE_COMPS, figma, codeByBlock);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.drift.length, 1);
});

test('component property: both changed → conflict', () => {
  const figma = {
    Warning: {
      blockFolder: 'blocks/warning',
      properties: { 'border-color': '#FF0000', 'border-radius': 'var(--pop-block-radius)' },
    },
  };
  const codeByBlock = {
    Warning: {
      'border-color': '#00FF00',
      'border-radius': 'var(--pop-block-radius)',
    },
  };
  const diff = diffComponents(BASE_COMPS, figma, codeByBlock);
  assert.equal(diff.conflict.length, 1);
  assert.equal(diff.apply.length, 0);
});
