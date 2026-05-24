import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchTokenInCss, patchBlockProperty } from '../patch.mjs';

test('patchTokenInCss updates a single declaration', () => {
  const css = `:root {
  --pop-color-primary: #642CDB;
  --pop-color-info:    #3B82F6;
}`;
  const out = patchTokenInCss(css, '--pop-color-primary', '#FF0000');
  assert.ok(out.includes('--pop-color-primary: #FF0000;'));
  assert.ok(out.includes('--pop-color-info:    #3B82F6;'));
});

test('patchTokenInCss preserves surrounding whitespace + trailing comments', () => {
  const css = `--pop-color-primary:   #642CDB;   /* primary accent */`;
  const out = patchTokenInCss(css, '--pop-color-primary', '#FF0000');
  assert.ok(out.includes('--pop-color-primary:   #FF0000;   /* primary accent */'));
});

test('patchTokenInCss throws when token not found', () => {
  const css = `--pop-color-primary: #642CDB;`;
  assert.throws(() => patchTokenInCss(css, '--pop-nonexistent', '#FF0000'), /not found/);
});

test('patchBlockProperty updates a property in the top-level selector', () => {
  const css = `.warning {
  border: 1px solid var(--pop-warning-ring);
  border-radius: var(--pop-block-radius);
}

.warning::before {
  color: var(--pop-warning-ring);
}`;
  const out = patchBlockProperty(css, 'warning', 'border-radius', '12px');
  assert.ok(out.includes('border-radius: 12px;'));
  // ::before block unchanged
  assert.ok(out.includes('.warning::before {\n  color: var(--pop-warning-ring);\n}'));
});

test('patchBlockProperty appends a missing property at the end of the top-level block', () => {
  const css = `.warning {
  border-radius: 8px;
}`;
  const out = patchBlockProperty(css, 'warning', 'background-color', '#FFFBEB');
  assert.ok(out.includes('background-color: #FFFBEB;'));
});
