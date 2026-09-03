import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { WebSocket } from 'ws';
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

function cookieValue(setCookie: string, name: string): string {
  const match = new RegExp(`(?:^|,\\s*|;\\s*)${name}=([^;,]+)`).exec(setCookie);
  assert.ok(match, `missing ${name} cookie`);
  return decodeURIComponent(match[1]);
}

async function openWebSocket(url: string, token: string, origin: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url, ['photox-v2', token], { origin });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function nextMessage(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('websocket message timeout')), 2_000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(String(data))); } catch (error) { reject(error); }
    });
  });
}

test('Web edge authenticates one-time ticket, workspace overview, CSRF, device/session APIs, WebSocket and signed Range streaming', async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-web-edge-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><html><head></head><body>PhotoX</body></html>');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const principal = {
    subject: 'user-a', workspaceId: 'workspace-a', workspaceRole: 'admin' as const,
    deviceId: 'web-device', sessionId: 'session-a',
    scopes: ['media:read', 'media:download', 'media:write', 'media:delete'] as const,
  };
  let auditCount = 0;
  let retryCount = 0;
  let rangeWorkspace = '';
  let revokedDevice = '';
  let revokedSession = '';
  const handlers: WebEdgeHandlers = {
    authorizeAccessToken: async (token) => {
      assert.equal(token, 'access-token');
      return { ...principal, scopes: [...principal.scopes] };
    },
    createWebSession: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' }),
    refreshSession: async (refreshToken) => {
      assert.equal(refreshToken, 'refresh-token');
      return { accessToken: 'access-token', accessExpiresAt: Date.now() + 60_000, sessionId: 'session-a' };
    },
    revokeSession: async () => undefined,
    getWorkspaceOverview: async (actor) => {
      assert.equal(actor.workspaceId, 'workspace-a');
      assert.equal(actor.subject, 'user-a');
      return {
        workspace: { id: actor.workspaceId, name: 'Workspace A', ownerUserId: 'owner-a', plan: 'personal', status: 'active' },
        membership: { userId: actor.subject, role: 'admin', status: 'active', joinedAt: 1 },
        usage: { managedStorageBytes: 10, monthlyIngressBytes: 5, members: 2, devices: 3, storageProviders: 1, publicShares: 0 },
        entitlements: { maxManagedStorageBytes: 100, maxMonthlyIngressBytes: 100, maxMembers: 5, maxDevices: 10, maxStorageProviders: 6, maxPublicShares: 20, targetOriginalReplicas: 2, publicSharing: true, remoteAccess: true, semanticSearch: false, priorityVideoProcessing: false },
        quota: { managedStorage: { current: 10, limit: 100, remaining: 90, percent: 10 } },
      };
    },
    listWorkspaceDevices: async (actor) => {
      assert.equal(actor.workspaceId, 'workspace-a');
      assert.equal(actor.subject, 'user-a');
      return [{ id: 'device-a', workspaceId: actor.workspaceId, userId: actor.subject, name: 'Phone', platform: 'ios', kind: 'mobile', createdAt: 1, lastSeenAt: 2 }];
    },
    listWorkspaceSessions: async (actor) => {
      assert.equal(actor.workspaceRole, 'admin');
      return [{ sessionId: 'session-a', subject: actor.subject, deviceId: actor.deviceId, scopes: ['media:read'], expiresAt: 20, createdAt: 10 }];
    },
    revokeWorkspaceSession: async (actor, sessionId) => {
      assert.equal(actor.workspaceId, 'workspace-a');
      revokedSession = sessionId;
      return { sessionId, revoked: true };
    },
    revokeWorkspaceDevice: async (actor, deviceId) => {
      assert.equal(actor.workspaceId, 'workspace-a');
      revokedDevice = deviceId;
      return { deviceId, sessionsRevoked: 2, activeDevices: 1 };
    },
    appendAudit: async () => { auditCount += 1; },
    getStatus: async () => ({ ok: true }),
    getTunnelStatus: async () => ({ state: 'idle' }),
    listLocalMedia: async () => [{ key: 'video/test.mp4' }],
    listCloudUploads: async () => [],
    getBackupHealth: async () => ({ healthy: true }),
    openLibrary: async () => ({ opened: true }),
    addGoogleAccount: async () => ({ ok: true }),
    listGoogleAccounts: async () => [],
    removeGoogleAccount: async () => ({ ok: true }),
    retryCloud: async () => { retryCount += 1; return { retried: true }; },
    listGooglePhotosAccounts: async () => [],
    connectGooglePhotosAccount: async () => ({ ok: true }),
    removeGooglePhotosAccount: async () => ({ ok: true }),
    listMigrations: async () => [],
    getMigration: async () => ({}),
    createMigration: async () => ({}),
    materializeMigration: async () => ({}),
    runMigration: async () => ({}),
    pauseMigration: async () => ({}),
    resumeMigration: async () => ({}),
    cancelMigration: async () => ({}),
    retryMigration: async () => ({}),
    streamMedia: async (req, res, key, variant, workspaceId) => {
      assert.equal(key, 'video/test.mp4');
      assert.equal(variant, 'original');
      assert.equal(req.headers.range, 'bytes=0-3');
      rangeWorkspace = workspaceId;
      const body = Buffer.from('0123');
      res.writeHead(206, {
        'content-type': 'video/mp4',
        'content-length': String(body.length),
        'content-range': 'bytes 0-3/10',
        'accept-ranges': 'bytes',
      });
      res.end(body);
    },
  };

  const edge = new PhotoXWebEdgeServer({
    enabled: true,
    host: '127.0.0.1',
    port,
    allowedOrigins: [origin],
    staticDir,
    publicBaseUrl: origin,
    rateLimitPerMinute: 300,
  }, handlers);

  let socket: WebSocket | undefined;
  try {
    const login = await edge.issueLoginTicket();
    const ticket = new URL(login.url).hash.replace(/^#ticket=/, '');
    assert.ok(ticket);
    await edge.start();

    const redeem = await fetch(`${origin}/api/web/v1/auth/ticket`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: decodeURIComponent(ticket) }),
    });
    assert.equal(redeem.status, 200);
    const redeemed = await redeem.json() as { accessToken: string; csrfToken: string };
    assert.equal(redeemed.accessToken, 'access-token');
    assert.ok(redeemed.csrfToken);
    const setCookie = redeem.headers.get('set-cookie') || '';
    assert.match(setCookie, /photox_refresh=[^;]+; Path=\/api\/web\/v1\/auth; HttpOnly; SameSite=Strict/);
    assert.match(setCookie, /photox_csrf=[^;]+; Path=\/; SameSite=Strict/);
    const refreshCookie = cookieValue(setCookie, 'photox_refresh');
    const csrfCookie = cookieValue(setCookie, 'photox_csrf');

    const replay = await fetch(`${origin}/api/web/v1/auth/ticket`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: decodeURIComponent(ticket) }),
    });
    assert.equal(replay.status, 401);

    const workspace = await fetch(`${origin}/api/web/v1/workspace`, { headers: { origin, authorization: 'Bearer access-token' } });
    assert.equal(workspace.status, 200);
    const workspaceSnapshot = await workspace.json() as { workspace: { id: string; plan: string }; membership: { role: string }; quota: { managedStorage: { percent: number } } };
    assert.equal(workspaceSnapshot.workspace.id, 'workspace-a');
    assert.equal(workspaceSnapshot.workspace.plan, 'personal');
    assert.equal(workspaceSnapshot.membership.role, 'admin');
    assert.equal(workspaceSnapshot.quota.managedStorage.percent, 10);

    const devices = await fetch(`${origin}/api/web/v1/devices`, { headers: { origin, authorization: 'Bearer access-token' } });
    assert.equal(devices.status, 200);
    assert.deepEqual((await devices.json() as Array<{id:string}>).map(item=>item.id), ['device-a']);

    const sessions = await fetch(`${origin}/api/web/v1/sessions`, { headers: { origin, authorization: 'Bearer access-token' } });
    assert.equal(sessions.status, 200);
    assert.deepEqual((await sessions.json() as Array<{sessionId:string}>).map(item=>item.sessionId), ['session-a']);

    const noCsrfRevoke = await fetch(`${origin}/api/web/v1/devices/device-a`, { method: 'DELETE', headers: { origin, authorization: 'Bearer access-token' } });
    assert.equal(noCsrfRevoke.status, 403);
    assert.equal(revokedDevice, '');

    const withoutCsrf = await fetch(`${origin}/api/web/v1/cloud/retry`, {
      method: 'POST', headers: { origin, authorization: 'Bearer access-token' },
    });
    assert.equal(withoutCsrf.status, 403);
    assert.equal(retryCount, 0);

    const cookieHeader = `photox_refresh=${encodeURIComponent(refreshCookie)}; photox_csrf=${encodeURIComponent(csrfCookie)}`;
    const revokeDevice = await fetch(`${origin}/api/web/v1/devices/device-a`, {
      method: 'DELETE', headers: { origin, authorization: 'Bearer access-token', cookie: cookieHeader, 'x-csrf-token': redeemed.csrfToken },
    });
    assert.equal(revokeDevice.status, 200);
    assert.equal(revokedDevice, 'device-a');

    const revokeSession = await fetch(`${origin}/api/web/v1/sessions/session-other`, {
      method: 'DELETE', headers: { origin, authorization: 'Bearer access-token', cookie: cookieHeader, 'x-csrf-token': redeemed.csrfToken },
    });
    assert.equal(revokeSession.status, 200);
    assert.equal(revokedSession, 'session-other');

    const withCsrf = await fetch(`${origin}/api/web/v1/cloud/retry`, {
      method: 'POST',
      headers: { origin, authorization: 'Bearer access-token', cookie: cookieHeader, 'x-csrf-token': redeemed.csrfToken },
    });
    assert.equal(withCsrf.status, 200);
    assert.equal(retryCount, 1);
    assert.equal(auditCount, 1);

    const refresh = await fetch(`${origin}/api/web/v1/auth/refresh`, {
      method: 'POST', headers: { origin, cookie: cookieHeader, 'x-csrf-token': redeemed.csrfToken },
    });
    assert.equal(refresh.status, 200);
    const refreshed = await refresh.json() as { accessToken: string };
    assert.equal(refreshed.accessToken, 'access-token');

    socket = await openWebSocket(`ws://127.0.0.1:${port}/api/web/v1/events`, 'access-token', origin);
    const eventPromise = nextMessage(socket);
    edge.publish('storage-updated', { workspaceId: 'workspace-a', usedBytes: 4 });
    const event = await eventPromise;
    assert.equal(event.event, 'storage-updated');
    assert.equal(event.workspaceId, 'workspace-a');

    const library = await fetch(`${origin}/api/web/v1/library`, {
      headers: { origin, authorization: 'Bearer access-token' },
    });
    assert.equal(library.status, 200);
    const items = await library.json() as Array<{ url: string }>;
    assert.equal(items.length, 1);
    const ranged = await fetch(items[0].url, { headers: { origin, range: 'bytes=0-3' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 0-3/10');
    assert.equal(await ranged.text(), '0123');
    assert.equal(rangeWorkspace, 'workspace-a');
  } finally {
    socket?.close();
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});