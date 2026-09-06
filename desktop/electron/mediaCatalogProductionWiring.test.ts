import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const source=fs.readFileSync(path.resolve('electron/main.ts'),'utf8');

test('Desktop production lifecycle activates sqlite before recovery and uses it as sole runtime authority',()=>{
  assert.match(source,/openActiveMediaCatalogBackend<MediaIndexRow>/);
  assert.match(source,/function mediaIndexWriter\(\)\{ return requireMediaCatalog\(\)\.writer; \}/);
  assert.match(source,/readAllIndex\(\):Promise<MediaIndexRow\[]>\{return requireMediaCatalog\(\)\.listAll\(\)\}/);
  assert.match(source,/readIndex\(workspaceId=LEGACY_WORKSPACE_ID\):Promise<MediaIndexRow\[]>\{return requireMediaCatalog\(\)\.listWorkspace\(workspaceId\)\}/);
  assert.doesNotMatch(source,/createMediaIndexRuntimeWriter<MediaIndexRow>\(indexFile\(\)\)/);
  const open=source.indexOf('mediaCatalogBackend=openActiveMediaCatalogBackend<MediaIndexRow>');
  const recover=source.indexOf('ingestRecoveryJournal().recover(await readAllIndexForRecovery())');
  assert.ok(open>=0&&recover>open,'SQLite authority must activate before ingest recovery');
  assert.match(source,/mediaCatalogBackend\?\.close\(\);mediaCatalogBackend=null/);
});
