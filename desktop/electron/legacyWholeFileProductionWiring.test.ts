import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, 'main.ts');

test('production whole-file receiver consumes the shared pre-ingest gate', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const receiveStart = source.indexOf('async function receiveMedia(');
  const receiveEnd = source.indexOf('\nasync function desktopStatus', receiveStart);
  assert.ok(receiveStart >= 0, 'receiveMedia function must exist');
  assert.ok(receiveEnd > receiveStart, 'receiveMedia function boundary must be discoverable');

  const receiveSource = source.slice(receiveStart, receiveEnd);
  assert.match(receiveSource, /resolveLegacyWholeFileReceiveGate\s*\(/);
  assert.match(receiveSource, /gate\.preflight\.workspaceId/);
  assert.match(receiveSource, /gate\.preflight/);
  assert.match(receiveSource, /gate\.state\s*===\s*'duplicate'/);
  assert.doesNotMatch(receiveSource, /legacyWholeFileAuditAttribution\s*\(/);
  assert.doesNotMatch(receiveSource, /const\s+deviceId\s*=\s*String\(req\.headers\['x-photosync-device-id'\]/);
  assert.doesNotMatch(receiveSource, /const\s+assetId\s*=\s*String\(req\.headers\['x-photosync-asset-id'\]/);
});
