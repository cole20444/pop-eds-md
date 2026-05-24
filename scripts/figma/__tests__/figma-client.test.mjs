import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixtureClient } from '../figma-client.mjs';

test('makeFixtureClient returns the fixture snapshot unchanged', async () => {
  const fixture = {
    versionId: 'v42',
    variables: { 'POP Brand': { 'Color/primary': { value: '#FF0000', cssVar: '--pop-color-primary' } } },
    components: {},
  };
  const client = makeFixtureClient(fixture);
  const got = await client.fetchSnapshot('any-key');
  assert.deepEqual(got, fixture);
});
