import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../../figma-sync.mjs';
import { makeFixtureClient } from '../figma-client.mjs';

async function setupTempRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'figma-orch-'));
  // styles.css with primary token
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'styles', 'styles.css'),
    `:root {\n  --pop-color-primary: #642CDB;\n}\n`);
  // blocks/note/note.css with bg
  await mkdir(join(dir, 'blocks', 'note'), { recursive: true });
  await writeFile(join(dir, 'blocks', 'note', 'note.css'),
    `.note {\n  background-color: #EFF6FF;\n}\n`);
  // .figma-sync.json baseline
  const state = {
    figmaFileUrl: 'x', figmaFileKey: 'k', lastSyncedVersionId: 'v1', lastSyncedAt: '2026-01-01T00:00:00Z',
    variables: {
      'POP Brand': { 'Color/primary': { value: '#642CDB', cssVar: '--pop-color-primary' } },
      Foundation: {},
    },
    components: {
      Note: { blockFolder: 'blocks/note', properties: { 'background-color': '#EFF6FF' } },
    },
  };
  await writeFile(join(dir, '.figma-sync.json'), JSON.stringify(state, null, 2));
  return dir;
}

test('runSync surfaces a token apply when Figma changed and code did not', async (t) => {
  const dir = await setupTempRepo();
  t.after(() => rm(dir, { recursive: true }));

  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/figma-snapshot-after-color-change.json', import.meta.url), 'utf8'),
  );
  const client = makeFixtureClient(fixture);

  const result = await runSync({ repoRoot: dir, client, autoApprove: true });
  // Assert: --pop-color-primary now FF0000 in styles.css
  const css = await readFile(join(dir, 'styles', 'styles.css'), 'utf8');
  assert.ok(css.includes('--pop-color-primary: #FF0000;'), 'styles.css updated');
  // Sync-state updated with new versionId
  const newState = JSON.parse(await readFile(join(dir, '.figma-sync.json'), 'utf8'));
  assert.equal(newState.lastSyncedVersionId, 'v2');
  // No conflicts
  assert.equal(result.diff.tokens.conflict.length, 0);
  assert.equal(result.diff.tokens.apply.length, 1);
});
