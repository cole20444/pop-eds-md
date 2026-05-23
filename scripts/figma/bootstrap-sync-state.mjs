// One-off generator: produces .figma-sync.json at the repo root.
// This file is the BASE for Phase 2's three-way diff between:
//   FIGMA (current Figma file via MCP) × CODE (styles.css + blocks/*/*.css) × BASE (this snapshot).
//
// Run once: node scripts/figma/bootstrap-sync-state.mjs
// Re-run any time you need to re-bootstrap (e.g. after a full styles.css regeneration).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { parseTokens } from './parse-tokens.mjs';
import { parseBlockCss } from './parse-block-css.mjs';

// ── Paths ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../');

// ── Known live values ──────────────────────────────────────────────────────
const FIGMA_FILE_URL = 'https://www.figma.com/design/qGfExcnCToIzAnNJzTEioH';
const FIGMA_FILE_KEY = 'qGfExcnCToIzAnNJzTEioH';

// NOTE: `lastSyncedVersionId` is a placeholder — we don't have the actual Figma
// version ID without burning an MCP call. The first real Phase 2 sync overwrites
// this field with the true version ID returned by the Figma API.
const LAST_SYNCED_VERSION_ID = 'bootstrap-2026-05-23';

// ── Components to capture (Figma names → lowercase block folder names) ──────
const COMPONENTS = [
  'Note', 'Warning', 'Tip', 'Caution', 'Important', 'Table',
  'Header', 'Footer', 'Sidenav', 'Minitoc',
];

// ── 1. Parse tokens from styles.css ────────────────────────────────────────
const stylesCss = readFileSync(join(REPO_ROOT, 'styles/styles.css'), 'utf8');
const tokenTree = parseTokens(stylesCss);

// ── 2. Convert token tree to sync-state `variables` shape ─────────────────
// parseTokens output shape:
//   { collections: { '<collection>': { groups: { '<Group>': { '<token>': { value, cssVar, alias? } } } } } }
// Target sync-state shape:
//   { '<collection>': { 'Group/token': { value, cssVar[, alias] } } }
//
// Transformation: drop the `groups` wrapper, flatten Group + token → "Group/token" key.
// `alias` is preserved when present so Phase 2 diff can track aliased tokens.

const variables = {};
for (const [collectionName, collectionData] of Object.entries(tokenTree.collections)) {
  variables[collectionName] = {};
  for (const [groupName, groupTokens] of Object.entries(collectionData.groups)) {
    for (const [tokenName, tokenData] of Object.entries(groupTokens)) {
      const flatKey = `${groupName}/${tokenName}`;
      const record = { value: tokenData.value, cssVar: tokenData.cssVar };
      if (tokenData.alias) record.alias = tokenData.alias;
      variables[collectionName][flatKey] = record;
    }
  }
}

// ── 3. Parse block CSS for each component ─────────────────────────────────
// NOTE: Some components don't have a top-level `.blockname { ... }` rule in
// their CSS (e.g. sidenav.css uses `main div.title-close-wrapper`, `sidenav-container`,
// etc. — no `.sidenav { }` rule). parseBlockCss returns `properties: {}` for those.
// This is expected and intentional; we preserve it as-is in the snapshot.

const components = {};
for (const componentName of COMPONENTS) {
  const blockName = componentName.toLowerCase();
  const cssPath = join(REPO_ROOT, `blocks/${blockName}/${blockName}.css`);
  const cssText = readFileSync(cssPath, 'utf8');
  const parsed = parseBlockCss(cssText, blockName);
  components[componentName] = {
    blockFolder: `blocks/${blockName}`,
    properties: parsed.properties,
  };
}

// ── 4. Assemble sync-state object ─────────────────────────────────────────
const syncState = {
  figmaFileUrl: FIGMA_FILE_URL,
  figmaFileKey: FIGMA_FILE_KEY,
  lastSyncedVersionId: LAST_SYNCED_VERSION_ID,
  lastSyncedAt: new Date().toISOString(),
  variables,
  components,
};

// ── 5. Write to .figma-sync.json ───────────────────────────────────────────
const outputPath = join(REPO_ROOT, '.figma-sync.json');
writeFileSync(outputPath, JSON.stringify(syncState, null, 2) + '\n', 'utf8');
console.log('Wrote .figma-sync.json');
