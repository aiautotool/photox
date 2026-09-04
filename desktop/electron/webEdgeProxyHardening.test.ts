import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { PhotoXWebEdgeServer, webEdgeConfigFromEnv, type WebEdgeHandlers } from './webEdgeServer.js';

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
  return {
    authorizeAccessToken: async () => ({ subject: 'user', workspaceId: 'workspace', workspaceRole: 'admin', scopes: ['media:read'] }),
    createWebSession: async () => ({ accessToken: 'access', refreshToken: 'refresh', accessExpiresAt: Date.now() + 60_000, sessionId: 'session' }),
    refreshSession: async () => ({ accessToken: 'access', accessExpiresAt: Date.now() + 60_000, sessionId: 'session' }),
    revokeSession: async () => undefined,
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
    streamMedia: async (_req, res) => { res.writeHead(204); res.end(); },
  };
}

async function makeStaticDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-web-proxy-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body>PhotoX</body></html>');
  return dir;
}

test('environment rejects malformed public URL, rate limit and trusted proxy settings', () => {
  const previous = { ...process.env };
  try {
    process.env.PHOTOX_WEB_RATE_LIMIT = 'not-a-number';
    assert.throws(() => webEdgeConfigFromEnv('/tmp'), /PHOTOX_WEB_RATE_LIMIT is invalid/);
    process.env.PHOTOX_WEB_RATE_LIMIT = '300';
    process.env.PHOTOX_WEB_PUBLIC_BASE_URL = 'https://user:pass@example.com';
    assert.throws(() => webEdgeConfigFromEnv('/tmp'), /PHOTOX_WEB_PUBLIC_BASE_URL is invalid/);
    process.env.PHOTOX_WEB_PUBLIC_BASE_URL = 'https://photos.example.com';
    process.env.PHOTOX_WEB_TRUSTED_PROXIES = 'loopback,10.0.0.2';
    const config = webEdgeConfigFromEnv('/tmp');
    assert.equal(config.publicBaseUrl, 'https://photos.example.com');
    assert.deepEqual(config.trustedProxyAddresses, ['127.0.0.1', '::1', '10.0.0.2']);
  } finally {
    process.env = previous;
  }
});

test('untrusted forwarded proto cannot force Secure cookies', async () => {
  const staticDir = await makeStaticDir();
  const port = await freePort();
  const edge = new PhotoXWebEdgeServer({ enabled: true, host: '127.0.0.1', port, allowedOrigins: [], staticDir, rateLimitPerMinute: 50, trustedProxyAddresses: [] }, handlers());
  try {
    const login = await edge.issueLoginTicket();
    const ticket = new URL(login.url).hash.replace(/^#ticket=/, '');
    await edge.start();
    const response = await fetch(`http://127.0.0.1:${port}/api/web/v1/auth/ticket`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ ticket: decodeURIComponent(ticket) }),
    });
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.headers.get('set-cookie') || '', /; Secure/);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});

test('trusted reverse proxy may supply HTTPS and distinct client rate-limit identities', async () => {
  const staticDir = await makeStaticDir();
  const port = await freePort();
  const edge = new PhotoXWebEdgeServer({ enabled: true, host: '127.0.0.1', port, allowedOrigins: [], staticDir, rateLimitPerMinute: 1, trustedProxyAddresses: ['127.0.0.1'] }, handlers());
  try {
    const login = await edge.issueLoginTicket();
    const ticket = new URL(login.url).hash.replace(/^#ticket=/, '');
    await edge.start();
    const redeem = await fetch(`http://127.0.0.1:${port}/api/web/v1/auth/ticket`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ ticket: decodeURIComponent(ticket) }),
    });
    assert.equal(redeem.status, 200);
    assert.match(redeem.headers.get('set-cookie') || '', /; Secure/);

    const secondClient = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'x-forwarded-for': '198.51.100.11' } });
    assert.equal(secondClient.status, 200);
    const firstClientAgain = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'x-forwarded-for': '198.51.100.10' } });
    assert.equal(firstClientAgain.status, 429);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});
