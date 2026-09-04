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
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function handlers(role: 'owner'|'admin'|'member'|'viewer', onUpdate: (principal: any, accountId: string, body: unknown) => Promise<unknown>): WebEdgeHandlers {
  return {
    authorizeAccessToken: async () => ({ subject: 'user-a', workspaceId: 'workspace-a', workspaceRole: role, deviceId: 'web-device', sessionId: 'session-a', scopes: ['media:read'] }),
    createWebSession: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    refreshSession: async () => ({ accessToken: 'access-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    revokeSession: async () => undefined,
    appendAudit: async () => undefined,
    getStatus: async () => ({}),
    getTunnelStatus: async () => ({}),
    listLocalMedia: async () => [],
    listCloudUploads: async () => [],
    getBackupHealth: async () => ({}),
    openLibrary: async () => undefined,
    addGoogleAccount: async () => ({}),
    listGoogleAccounts: async () => [],
    updateGoogleDriveAllocation: onUpdate,
    removeGoogleAccount: async () => ({}),
    retryCloud: async () => ({}),
    listGooglePhotosAccounts: async () => [],
    connectGooglePhotosAccount: async () => ({}),
    removeGooglePhotosAccount: async () => undefined,
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

async function startEdge(role: 'owner'|'admin'|'member'|'viewer', onUpdate: (principal: any, accountId: string, body: unknown) => Promise<unknown>) {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-drive-edge-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const edge = new PhotoXWebEdgeServer({ enabled: true, host: '127.0.0.1', port, allowedOrigins: [origin], staticDir, publicBaseUrl: origin, rateLimitPerMinute: 300 }, handlers(role, onUpdate));
  await edge.start();
  return { edge, staticDir, origin };
}

test('Drive allocation Web route allows PATCH in CORS and requires CSRF', async () => {
  let calls = 0;
  const { edge, staticDir, origin } = await startEdge('admin', async () => { calls += 1; return {}; });
  try {
    const preflight = await fetch(`${origin}/api/web/v1/google-drive/accounts/account-a/allocation`, { method: 'OPTIONS', headers: { origin } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /PATCH/);

    const noCsrf = await fetch(`${origin}/api/web/v1/google-drive/accounts/account-a/allocation`, {
      method: 'PATCH', headers: { origin, authorization: 'Bearer access-token', 'content-type': 'application/json' }, body: JSON.stringify({ maxUsageRatio: 2 / 3 }),
    });
    assert.equal(noCsrf.status, 403);
    assert.equal(calls, 0);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});

test('Drive allocation Web route derives workspace principal and forwards strict policy payload', async () => {
  let received: any;
  const { edge, staticDir, origin } = await startEdge('admin', async (principal, accountId, body) => {
    received = { principal, accountId, body };
    return { id: accountId, email: 'a@example.com', status: 'unavailable', totalBytes: 0, usedBytes: 0, freeBytes: 0, maxUsageRatio: 0.5, safetyReserveBytes: 104857600, photoXAllocationLimitBytes: 0, photoXUsedBytes: 0, photoXRemainingBytes: 0, effectiveWritableBytes: 0 };
  });
  try {
    const csrf = 'csrf-token';
    const response = await fetch(`${origin}/api/web/v1/google-drive/accounts/account-a/allocation`, {
      method: 'PATCH',
      headers: { origin, authorization: 'Bearer access-token', cookie: `photox_csrf=${csrf}`, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ maxUsageRatio: 0.5 }),
    });
    assert.equal(response.status, 200);
    assert.equal(received.accountId, 'account-a');
    assert.equal(received.principal.workspaceId, 'workspace-a');
    assert.equal(received.principal.subject, 'user-a');
    assert.equal(received.principal.workspaceRole, 'admin');
    assert.deepEqual(received.body, { maxUsageRatio: 0.5 });
    assert.equal((await response.json() as any).maxUsageRatio, 0.5);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});

test('Drive allocation Web route blocks member mutations before handler execution', async () => {
  let calls = 0;
  const { edge, staticDir, origin } = await startEdge('member', async () => { calls += 1; return {}; });
  try {
    const csrf = 'csrf-token';
    const response = await fetch(`${origin}/api/web/v1/google-drive/accounts/account-a/allocation`, {
      method: 'PATCH',
      headers: { origin, authorization: 'Bearer access-token', cookie: `photox_csrf=${csrf}`, 'x-csrf-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ maxUsageRatio: 0.5 }),
    });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});