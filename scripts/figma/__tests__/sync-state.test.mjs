import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSyncState, saveSyncState, validateSyncState } from '../sync-state.mjs';

const FIXTURE = new URL('./fixtures/sync-state-valid.json', import.meta.url);

test('loads a valid sync-state file', async () => {
  const state = await loadSyncState(FIXTURE);
  assert.equal(state.figmaFileKey, 'abc123');
  assert.equal(state.variables['POP Brand']['Color/primary'].value, '#642CDB');
});

test('validateSyncState accepts a valid shape', async () => {
  const valid = JSON.parse(await readFile(FIXTURE, 'utf8'));
  assert.doesNotThrow(() => validateSyncState(valid));
});

test('validateSyncState rejects missing required fields', () => {
  assert.throws(() => validateSyncState({}), /figmaFileKey/);
  assert.throws(() => validateSyncState({ figmaFileKey: 'x' }), /variables/);
});

test('saves and round-trips a sync-state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'figma-sync-'));
  try {
    const path = join(dir, 'state.json');
    const original = JSON.parse(await readFile(FIXTURE, 'utf8'));
    await saveSyncState(path, original);
    const reloaded = await loadSyncState(path);
    assert.deepEqual(reloaded, original);
  } finally {
    await rm(dir, { recursive: true });
  }
});
