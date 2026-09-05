import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('desktop main routes ingest, video, and replica writes through exact runtime writer', async () => {
  const source = await fs.readFile(path.resolve('electron/main.ts'), 'utf8');
  assert.match(source, /createMediaIndexRuntimeWriter<MediaIndexRow>\(indexFile\(\)\)/);
  assert.match(source, /mediaIndexWriter\(\)\.ingest\(row\)/);
  assert.match(source, /writer\.patchVideo\(workspaceId,key,/);
  assert.match(source, /mediaIndexWriter\(\)\.syncReplicas\(row\.workspaceId,row\.key,replicas\)/);
  assert.doesNotMatch(source, /rows\.push\(row\);\s*await writeIndex\(rows,requestWorkspace\)/);
  assert.doesNotMatch(source, /await updateIndexRow\(key,\{videoProcessing:/);
});
