// Reads and writes .figma-sync.json. Validates shape on every read/write.

import { readFile, writeFile } from 'node:fs/promises';

const REQUIRED = ['figmaFileKey', 'variables', 'components', 'figmaFileUrl', 'lastSyncedVersionId', 'lastSyncedAt'];

export function validateSyncState(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('sync-state: not an object');
  }
  for (const key of REQUIRED) {
    if (!(key in state)) throw new Error(`sync-state: missing required field "${key}"`);
  }
  if (typeof state.variables !== 'object') throw new Error('sync-state: variables must be an object');
  if (typeof state.components !== 'object') throw new Error('sync-state: components must be an object');
}

export async function loadSyncState(path) {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  validateSyncState(parsed);
  return parsed;
}

export async function saveSyncState(path, state) {
  validateSyncState(state);
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}
