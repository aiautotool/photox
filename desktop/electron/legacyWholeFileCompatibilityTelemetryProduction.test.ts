import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareLegacyMediaIndexForSqlite } from './legacyMediaIndexPreparation.js';
import { resolveLegacyWholeFileReceiveGate } from './legacyWholeFileReceiveGate.js';
import {
  flushLegacyWholeFileCompatibilityTelemetry,
  legacyWholeFileCompatibilityDiagnostics,
  resetLegacyWholeFileCompatibilityTelemetryForTests,
} from './legacyWholeFileCompatibilityTelemetryProduction.js';
import type { LegacyWholeFileAuthPrincipal } from './legacyMediaAuditAttribution.js';

const principal: LegacyWholeFileAuthPrincipal = {
  subject: 'member-a',
  workspaceId: 'workspace-a',
  deviceId: 'device-a',
  sessionId: 'session-a',
  workspaceRole: 'editor',
};

function request(headers: Record<string, string>) {
  return { headers };
}

test('desktop startup state path durably records aggregate whole-file compatibility traffic', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-whole-file-production-'));
  try {
    resetLegacyWholeFileCompatibilityTelemetryForTests();
    const indexPath = path.join(directory, 'media-index.json');
    const preparation = await prepareLegacyMediaIndexForSqlite({ indexPath, workspaceId: 'workspace-a' });
    assert.equal(preparation.status, 'SOURCE_MISSING');

    const accepted = await resolveLegacyWholeFileReceiveGate({
      req: request({
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'device-a',
        'x-photosync-asset-id': 'asset-a',
      }),
      defaultWorkspaceId: 'workspace-a',
      legacyOwnerUserId: 'legacy-owner',
      authMode: 'bearer',
      principal,
      exists: () => false,
    });
    assert.equal(accepted.state, 'ready');

    const duplicate = await resolveLegacyWholeFileReceiveGate({
      req: request({
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'device-a',
        'x-photosync-asset-id': 'asset-b',
      }),
      defaultWorkspaceId: 'workspace-a',
      legacyOwnerUserId: 'legacy-owner',
      authMode: 'bearer',
      principal,
      exists: () => true,
    });
    assert.equal(duplicate.state, 'duplicate');

    await assert.rejects(
      resolveLegacyWholeFileReceiveGate({
        req: request({
          'x-photosync-workspace-id': 'workspace-b',
          'x-photosync-device-id': 'device-a',
          'x-photosync-asset-id': 'asset-c',
        }),
        defaultWorkspaceId: 'workspace-a',
        legacyOwnerUserId: 'legacy-owner',
        authMode: 'bearer',
        principal,
        exists: () => false,
      }),
      /WORKSPACE_BINDING_MISMATCH/,
    );

    await flushLegacyWholeFileCompatibilityTelemetry();
    const diagnostics = legacyWholeFileCompatibilityDiagnostics();
    assert.equal(diagnostics.initialized, true);
    if (!diagnostics.initialized) throw new Error('TELEMETRY_NOT_INITIALIZED');
    assert.equal(diagnostics.snapshot.total, 3);
    assert.equal(diagnostics.snapshot.byAuthMode.bearer, 3);
    assert.equal(diagnostics.snapshot.byOutcome.accepted, 1);
    assert.equal(diagnostics.snapshot.byOutcome.duplicate, 1);
    assert.equal(diagnostics.snapshot.byOutcome.rejected, 1);
    assert.equal(diagnostics.deprecationReadiness.ready, false);
    assert.equal(diagnostics.deprecationReadiness.physicalDeviceResumableAccepted, false);
    assert.ok(diagnostics.deprecationReadiness.blockers.includes('PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED'));

    const persistedPath = path.join(directory, 'legacy-whole-file-compatibility.json');
    const persisted = await fs.readFile(persistedPath, 'utf8');
    assert.equal(JSON.parse(persisted).total, 3);
    for (const secret of ['member-a', 'workspace-a', 'device-a', 'session-a', 'asset-a']) {
      assert.equal(persisted.includes(secret), false);
    }
  } finally {
    resetLegacyWholeFileCompatibilityTelemetryForTests();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
