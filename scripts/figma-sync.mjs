#!/usr/bin/env node
// figma-sync — CLI orchestrator for Phase 2.
//
//   node scripts/figma-sync.mjs           — interactive, reads MCP via stdin
//   node scripts/figma-sync.mjs --auto    — non-interactive, exit non-zero
//                                            on conflicts. Used by tests.
//
// See specs/2026-05-22-figma-mcp-bootstrap-design.md.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSyncState, saveSyncState } from './figma/sync-state.mjs';
import { parseTokens } from './figma/parse-tokens.mjs';
import { parseBlockCss } from './figma/parse-block-css.mjs';
import { diffTokens, diffComponents } from './figma/diff.mjs';
import { patchTokenInCss, patchBlockProperty } from './figma/patch.mjs';
import { makeStdinClient } from './figma/figma-client.mjs';
import { isSidenavJsWrite } from './figma/safety.mjs';

export async function runSync({ repoRoot, client, autoApprove = false }) {
  const statePath = join(repoRoot, '.figma-sync.json');
  const state = await loadSyncState(statePath);
  const figma = await client.fetchSnapshot(state.figmaFileKey);

  // Build CODE side: parse tokens from styles.css, parse properties for each known component.
  const stylesCss = await readFile(join(repoRoot, 'styles/styles.css'), 'utf8');
  const codeTokens = flattenCssVarValues(stylesCss);

  const codeComponents = {};
  for (const [compName, info] of Object.entries(state.components)) {
    const cssPath = join(repoRoot, info.blockFolder, `${info.blockFolder.split('/').pop()}.css`);
    const blockCss = await readFile(cssPath, 'utf8');
    const parsed = parseBlockCss(blockCss, info.blockFolder.split('/').pop());
    codeComponents[compName] = parsed.properties;
  }

  const tokensDiff = diffTokens(state.variables, figma.variables, codeTokens);
  const compsDiff = diffComponents(state.components, figma.components, codeComponents);

  // Conflicts halt apply, even with --auto.
  if (!autoApprove && (tokensDiff.conflict.length || compsDiff.conflict.length)) {
    process.stderr.write('Conflicts detected; review required. No writes performed.\n');
    return { diff: { tokens: tokensDiff, components: compsDiff }, applied: false };
  }

  // Apply token changes.
  let nextStyles = stylesCss;
  for (const change of tokensDiff.apply) {
    nextStyles = patchTokenInCss(nextStyles, change.cssVar, change.to);
  }
  await writeFile(join(repoRoot, 'styles/styles.css'), nextStyles, 'utf8');

  // Apply component property changes. Refuse sidenav JS (defense in depth — we only write CSS anyway).
  const fileWrites = new Map();
  for (const change of compsDiff.apply) {
    const cssPath = join(change.blockFolder, `${change.blockFolder.split('/').pop()}.css`);
    if (isSidenavJsWrite(cssPath.replace(/\.css$/, '.js'))) {
      // We never write JS, so this is purely a sanity guard.
      continue;
    }
    const absPath = join(repoRoot, cssPath);
    if (!fileWrites.has(absPath)) {
      fileWrites.set(absPath, await readFile(absPath, 'utf8'));
    }
    const blockName = change.blockFolder.split('/').pop();
    fileWrites.set(absPath, patchBlockProperty(fileWrites.get(absPath), blockName, change.property, change.to));
  }
  for (const [path, contents] of fileWrites) {
    await writeFile(path, contents, 'utf8');
  }

  // Update sync-state: new versionId, new variable/component snapshot.
  const newState = {
    ...state,
    lastSyncedVersionId: figma.versionId,
    lastSyncedAt: new Date().toISOString(),
    variables: figma.variables,
    components: figma.components,
  };
  await saveSyncState(statePath, newState);

  return { diff: { tokens: tokensDiff, components: compsDiff }, applied: true };
}

function flattenCssVarValues(css) {
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  const out = {};
  let m;
  while ((m = re.exec(css)) !== null) out[m[1]] = m[2].trim();
  return out;
}

// CLI entry — only runs when invoked directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = process.cwd();
  const client = makeStdinClient();
  const autoApprove = process.argv.includes('--auto');
  const result = await runSync({ repoRoot, client, autoApprove });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
