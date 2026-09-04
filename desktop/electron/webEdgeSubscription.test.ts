import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { PhotoXWebEdgeServer, type WebEdgeHandlers } from './webEdgeServer.js';

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function handlers(): WebEdgeHandlers {
  const principal = {
    subject: 'owner-a', workspaceId: 'workspace-a', workspaceRole: 'owner' as const,
    deviceId: 'web-device', sessionId: 'session-a', scopes: ['media:read'] as const,
  };
  return {
    authorizeAccessToken: async (token) => {
      assert.equal(token, 'access-token');
      return { ...principal, scopes: [...principal.scopes] };
    },
    createWebSession: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    refreshSession: async () => ({ accessToken: 'access-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    revokeSession: async () => undefined,
    getWorkspaceSubscription: async (actor) => {
      assert.equal(actor.workspaceId, 'workspace-a');
      assert.equal(actor.subject, 'owner-a');
      return {
        workspaceId: actor.workspaceId,
        plan: 'personal',
        source: 'billing',
        status: 'active',
        currentPeriodStart: 1_700_000_000_000,
        currentPeriodEnd: 1_702_592_000_000,
        cancelAtPeriodEnd: false,
        updatedAt: 1_700_000_000_000,
      };
    },
    appendAudit: async () => undefined,
    getStatus: async () => ({}),
    getTunnelStatus: async () => ({}),
    listLocalMedia: async () => [],
    listCloudUploads: async () => [],
    getBackupHealth: async () => ({}),
    openLibrary: async () => ({}),
    addGoogleAccount: async () => ({}),
    listGoogleAccounts: async () => [],
    removeGoogleAccount: async () => ({}),
    retryCloud: async () => ({}),
    listGooglePhotosAccounts: async () => [],
    connectGooglePhotosAccount: async () => ({}),
    removeGooglePhotosAccount: async () => ({}),
    listMigrations: async () => [],
    getMigration: async () => ({}),
    createMigration: async () => ({}),
    materializeMigration: async () => ({}),
    runMigration: async () => ({}),
    pauseMigration: async () => ({}),
    resumeMigration: async () => ({}),
    cancelMigration: async () => ({}),
    retryMigration: async () => ({}),
    streamMedia: async (_req, res) => { res.writeHead(404); res.end(); },
  };
}

test('Web edge exposes authenticated workspace subscription snapshot without provider identifiers', async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-web-subscription-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const edge = new PhotoXWebEdgeServer({ enabled: true, host: '127.0.0.1', port, allowedOrigins: [origin], staticDir, publicBaseUrl: origin, rateLimitPerMinute: 300 }, handlers());
  try {
    await edge.start();
    const anonymous = await fetch(`${origin}/api/web/v1/workspace/subscription`, { headers: { origin } });
    assert.equal(anonymous.status, 401);

    const response = await fetch(`${origin}/api/web/v1/workspace/subscription`, { headers: { origin, authorization: 'Bearer access-token' } });
    assert.equal(response.status, 200);
    const snapshot = await response.json() as Record<string, unknown>;
    assert.equal(snapshot.workspaceId, 'workspace-a');
    assert.equal(snapshot.plan, 'personal');
    assert.equal(snapshot.source, 'billing');
    assert.equal(snapshot.status, 'active');
    assert.equal(snapshot.cancelAtPeriodEnd, false);
    assert.equal('providerCustomerId' in snapshot, false);
    assert.equal('providerSubscriptionId' in snapshot, false);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});