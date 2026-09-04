import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { PhotoXWebEdgeServer, type WebEdgeHandlers, type WebPrincipal } from './webEdgeServer.js';

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

function baseHandlers(mutate: WebEdgeHandlers['mutateWorkspaceSubscription']): WebEdgeHandlers {
  const principalFor = (token: string): WebPrincipal => ({
    subject: token === 'member-token' ? 'member-a' : 'owner-a',
    workspaceId: 'workspace-a',
    workspaceRole: token === 'member-token' ? 'member' : 'owner',
    deviceId: 'web-device',
    sessionId: 'session-a',
    scopes: ['media:read'],
  });
  return {
    authorizeAccessToken: async (token) => principalFor(token),
    createWebSession: async () => ({ accessToken: 'owner-token', refreshToken: 'refresh-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    refreshSession: async () => ({ accessToken: 'owner-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    revokeSession: async () => undefined,
    mutateWorkspaceSubscription: mutate,
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

async function fixture(mutate: WebEdgeHandlers['mutateWorkspaceSubscription']) {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-web-billing-mutation-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const edge = new PhotoXWebEdgeServer({ enabled: true, host: '127.0.0.1', port, allowedOrigins: [origin], staticDir, publicBaseUrl: origin, rateLimitPerMinute: 300 }, baseHandlers(mutate));
  await edge.start();
  return { edge, staticDir, origin };
}

const csrfHeaders = (origin: string, token = 'csrf-token') => ({
  origin,
  authorization: 'Bearer owner-token',
  cookie: `photox_csrf=${token}`,
  'x-csrf-token': token,
  'content-type': 'application/json',
  'idempotency-key': 'billing-mutation-key-0001',
});

test('billing mutation web route requires auth, CSRF and owner/admin role', async () => {
  let calls = 0;
  const fx = await fixture(async () => { calls += 1; return { status: 'succeeded', replayed: false, attempts: 1, providerStateResult: 'APPLIED' }; });
  try {
    const anonymous = await fetch(`${fx.origin}/api/web/v1/workspace/subscription/mutations`, { method: 'POST', headers: { origin: fx.origin, 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'resume' }) });
    assert.equal(anonymous.status, 401);

    const noCsrf = await fetch(`${fx.origin}/api/web/v1/workspace/subscription/mutations`, { method: 'POST', headers: { origin: fx.origin, authorization: 'Bearer owner-token', 'content-type': 'application/json', 'idempotency-key': 'billing-mutation-key-0001' }, body: JSON.stringify({ operation: 'resume' }) });
    assert.equal(noCsrf.status, 403);

    const memberHeaders = { ...csrfHeaders(fx.origin), authorization: 'Bearer member-token' };
    const member = await fetch(`${fx.origin}/api/web/v1/workspace/subscription/mutations`, { method: 'POST', headers: memberHeaders, body: JSON.stringify({ operation: 'resume' }) });
    assert.equal(member.status, 403);
    assert.equal(calls, 0);
  } finally {
    await fx.edge.stop();
    await fs.rm(fx.staticDir, { recursive: true, force: true });
  }
});

test('billing mutation forwards only public body plus transport idempotency key', async () => {
  let received: { principal: WebPrincipal; body: unknown; key: string } | undefined;
  const fx = await fixture(async (principal, body, key) => {
    received = { principal, body, key };
    return { status: 'succeeded', replayed: false, attempts: 1, providerStateResult: 'APPLIED' };
  });
  try {
    const response = await fetch(`${fx.origin}/api/web/v1/workspace/subscription/mutations`, {
      method: 'POST', headers: csrfHeaders(fx.origin), body: JSON.stringify({ operation: 'change_plan', targetPlan: 'pro' }),
    });
    assert.equal(response.status, 200);
    assert.equal(received?.principal.workspaceId, 'workspace-a');
    assert.deepEqual(received?.body, { operation: 'change_plan', targetPlan: 'pro' });
    assert.equal(received?.key, 'billing-mutation-key-0001');
  } finally {
    await fx.edge.stop();
    await fs.rm(fx.staticDir, { recursive: true, force: true });
  }
});

test('billing mutation maps idempotency/provider failures and CORS allows Idempotency-Key', async () => {
  const fx = await fixture(async () => { throw new Error('BILLING_IDEMPOTENCY_KEY_REUSED'); });
  try {
    const preflight = await fetch(`${fx.origin}/api/web/v1/workspace/subscription/mutations`, {
      method: 'OPTIONS', headers: { origin: fx.origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-csrf-token,idempotency-key' },
    });
    assert.equal(preflight.status, 204);
    assert.match(String(preflight.headers.get('access-control-allow-headers')), /idempotency-key/i);

    const conflict = await fetch(`${fx.origin}/api/web/v1/workspace/subscription/mutations`, {
      method: 'POST', headers: csrfHeaders(fx.origin), body: JSON.stringify({ operation: 'resume' }),
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: 'BILLING_IDEMPOTENCY_KEY_REUSED' });
  } finally {
    await fx.edge.stop();
    await fs.rm(fx.staticDir, { recursive: true, force: true });
  }
});
