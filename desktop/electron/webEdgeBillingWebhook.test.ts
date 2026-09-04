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

function baseHandlers(webhook: WebEdgeHandlers['handleStripeWebhook']): WebEdgeHandlers {
  return {
    authorizeAccessToken: async () => { throw new Error('WEBHOOK_MUST_NOT_REQUIRE_BROWSER_AUTH'); },
    createWebSession: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    refreshSession: async () => ({ accessToken: 'access-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    revokeSession: async () => undefined,
    handleStripeWebhook: webhook,
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

async function withEdge(handlers: WebEdgeHandlers, fn: (origin: string) => Promise<void>) {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-web-billing-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const edge = new PhotoXWebEdgeServer({ enabled: true, host: '127.0.0.1', port, allowedOrigins: [origin], staticDir, publicBaseUrl: origin, rateLimitPerMinute: 300 }, handlers);
  try {
    await edge.start();
    await fn(origin);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
}

test('billing webhook ingress accepts provider request without bearer or CSRF and preserves exact raw bytes', async () => {
  const expectedBody = '{"id":"evt_1","data":{"object":{"metadata":{"x":" spacing matters "}}}}';
  const expectedSignature = 't=1800000000,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  let calls = 0;
  await withEdge(baseHandlers(async (raw, signature) => {
    calls += 1;
    assert.equal(raw.toString('utf8'), expectedBody);
    assert.equal(signature, expectedSignature);
    return { applied: true };
  }), async origin => {
    const response = await fetch(`${origin}/api/web/v1/billing/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': expectedSignature },
      body: expectedBody,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { applied: true });
  });
  assert.equal(calls, 1);
});

test('billing webhook ingress rejects missing signature without invoking backing mutation', async () => {
  let calls = 0;
  await withEdge(baseHandlers(async () => { calls += 1; return { applied: true }; }), async origin => {
    const response = await fetch(`${origin}/api/web/v1/billing/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'BILLING_WEBHOOK_REJECTED' });
  });
  assert.equal(calls, 0);
});

test('billing webhook ingress returns service-unavailable when signing secret is not configured', async () => {
  await withEdge(baseHandlers(async () => { throw new Error('BILLING_WEBHOOK_NOT_CONFIGURED'); }), async origin => {
    const response = await fetch(`${origin}/api/web/v1/billing/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      body: '{}',
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'BILLING_WEBHOOK_REJECTED' });
  });
});
