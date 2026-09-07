import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { resolveLegacyWholeFileReceiverPreflight, type LegacyWholeFileAuthMode } from './legacyWholeFileReceiverPreflight.js';
import type { LegacyWholeFileAuthPrincipal } from './legacyMediaAuditAttribution.js';

async function withServer(
  principal: LegacyWholeFileAuthPrincipal | undefined,
  authMode: LegacyWholeFileAuthMode,
  run: (baseUrl: string, sideEffects: { bodyReads: number; reservations: number; audits: number }) => Promise<void>,
) {
  const sideEffects = { bodyReads: 0, reservations: 0, audits: 0 };
  const server = http.createServer(async (req, res) => {
    try {
      const preflight = resolveLegacyWholeFileReceiverPreflight({
        req,
        defaultWorkspaceId: 'workspace-a',
        legacyOwnerUserId: 'legacy-owner',
        principal,
        authMode,
      });
      sideEffects.reservations += 1;
      for await (const _chunk of req) sideEffects.bodyReads += 1;
      sideEffects.audits += 1;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify(preflight));
    } catch (error) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE');
  try {
    await run(`http://127.0.0.1:${address.port}`, sideEffects);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const bearerPrincipal: LegacyWholeFileAuthPrincipal = {
  subject: 'member-42',
  workspaceId: 'workspace-a',
  deviceId: 'device-a',
  sessionId: 'session-a',
  workspaceRole: 'editor',
};

test('HTTP preflight attributes a bound bearer upload to the authenticated member', async () => {
  await withServer(bearerPrincipal, 'bearer', async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'device-a',
        'x-photosync-asset-id': 'asset-1',
      },
      body: Buffer.from('media'),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.key, 'device-a:asset-1');
    assert.equal(body.audit.actorUserId, 'member-42');
    assert.equal(body.audit.actorDeviceId, 'device-a');
    assert.equal(body.audit.metadata.attribution, 'authenticated-member');
    assert.equal(body.audit.metadata.sessionId, 'session-a');
    assert.equal(sideEffects.reservations, 1);
    assert.equal(sideEffects.audits, 1);
    assert.ok(sideEffects.bodyReads > 0);
  });
});

test('HTTP preflight rejects bearer binding mismatch before body/reservation/audit side effects', async () => {
  await withServer(bearerPrincipal, 'bearer', async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-b',
        'x-photosync-device-id': 'device-a',
        'x-photosync-asset-id': 'asset-2',
      },
      body: Buffer.from('should-not-ingest'),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(sideEffects, { bodyReads: 0, reservations: 0, audits: 0 });
  });
});

test('HTTP preflight keeps pair-code attribution explicitly legacy-compatible', async () => {
  await withServer(undefined, 'pair-code', async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'legacy-phone',
        'x-photosync-asset-id': 'asset-3',
      },
      body: Buffer.from('legacy-media'),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.audit.actorUserId, 'legacy-owner');
    assert.equal(body.audit.actorDeviceId, 'legacy-phone');
    assert.equal(body.audit.metadata.attribution, 'legacy-compatibility');
    assert.equal(body.audit.metadata.authMode, 'pair-code');
    assert.equal(sideEffects.reservations, 1);
    assert.equal(sideEffects.audits, 1);
  });
});

test('HTTP preflight rejects missing asset identity before side effects', async () => {
  await withServer(bearerPrincipal, 'bearer', async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'device-a',
      },
      body: Buffer.from('media'),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(sideEffects, { bodyReads: 0, reservations: 0, audits: 0 });
  });
});
