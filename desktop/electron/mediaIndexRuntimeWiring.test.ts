import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('desktop main routes ingest, video, and replica writes through exact runtime writer', async () => {
  const source = await fs.readFile(path.resolve('electron/main.ts'), 'utf8');
  assert.match(source, /function mediaIndexWriter\(\)\{ return requireMediaCatalog\(\)\.writer; \}/);
  assert.doesNotMatch(source, /createMediaIndexRuntimeWriter<MediaIndexRow>\(indexFile\(\)\)/);
  assert.match(source, /mediaIndexWriter\(\)\.ingest\(row\)/);
  assert.match(source, /writer\.patchVideo\(workspaceId,key,/);
  assert.match(source, /mediaIndexWriter\(\)\.syncReplicas\(row\.workspaceId,row\.key,replicas\)/);
  assert.doesNotMatch(source, /rows\.push\(row\);\s*await writeIndex\(rows,requestWorkspace\)/);
  assert.doesNotMatch(source, /await updateIndexRow\(key,\{videoProcessing:/);
  assert.match(source, /createMediaProviderOperationGate\(\)/);
  assert.match(source, /mediaProviderOperationGate\.run\(row\.workspaceId,row\.key,/);
  assert.match(source, /writer\.claimDeletion\(workspaceId,key,requestedClaimId\)/);
  assert.match(source, /writer\.removeClaimed\(workspaceId,key,claimId\)/);
  assert.doesNotMatch(source, /rows\.splice\(index,1\);await writeIndex\(rows,workspaceId\)/);
});
