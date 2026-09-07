import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { resolveLegacyWholeFileReceiveGate } from './legacyWholeFileReceiveGate.js';
import type { LegacyWholeFileAuthPrincipal } from './legacyMediaAuditAttribution.js';

const bearerPrincipal: LegacyWholeFileAuthPrincipal = {
  subject: 'member-42',
  workspaceId: 'workspace-a',
  deviceId: 'device-a',
  sessionId: 'session-a',
  workspaceRole: 'editor',
};

async function withGateServer(input: {
  duplicate?: boolean;
  principal?: LegacyWholeFileAuthPrincipal;
  authMode: 'bearer' | 'pair-code' | 'pairing-challenge';
}, run: (baseUrl: string, sideEffects: { bodyReads: number; reservations: number; files: number; audits: number; duplicateChecks: number }) => Promise<void>) {
  const sideEffects = { bodyReads: 0, reservations: 0, files: 0, audits: 0, duplicateChecks: 0 };
  const server = http.createServer(async (req, res) => {
    try {
      const gate = await resolveLegacyWholeFileReceiveGate({
        req,
        defaultWorkspaceId: 'workspace-a',
        legacyOwnerUserId: 'legacy-owner',
        principal: input.principal,
        authMode: input.authMode,
        exists: ({ workspaceId, key }) => {
          sideEffects.duplicateChecks += 1;
          assert.equal(workspaceId, 'workspace-a');
          assert.ok(key.length > 0);
          return Boolean(input.duplicate);
        },
      });

      if (gate.state === 'duplicate') {
        res.writeHead(208, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ state: 'ALREADY_RECEIVED', key: gate.preflight.key }));
        return;
      }

      sideEffects.reservations += 1;
      for await (const _chunk of req) sideEffects.bodyReads += 1;
      sideEffects.files += 1;
      sideEffects.audits += 1;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ state: 'LOCAL_STORED', preflight: gate.preflight }));
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

test('whole-file receive gate rejects bearer binding mismatch before duplicate/body/quota/file/audit effects', async () => {
  await withGateServer({ principal: bearerPrincipal, authMode: 'bearer' }, async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-b',
        'x-photosync-device-id': 'device-a',
        'x-photosync-asset-id': 'asset-1',
      },
      body: Buffer.from('media'),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(sideEffects, { bodyReads: 0, reservations: 0, files: 0, audits: 0, duplicateChecks: 0 });
  });
});

test('whole-file receive gate rejects missing asset before duplicate/body/quota/file/audit effects', async () => {
  await withGateServer({ principal: bearerPrincipal, authMode: 'bearer' }, async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'device-a',
      },
      body: Buffer.from('media'),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(sideEffects, { bodyReads: 0, reservations: 0, files: 0, audits: 0, duplicateChecks: 0 });
  });
});

test('whole-file receive gate returns duplicate before body/quota/file/audit effects', async () => {
  await withGateServer({ principal: bearerPrincipal, authMode: 'bearer', duplicate: true }, async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'device-a',
        'x-photosync-asset-id': 'asset-2',
      },
      body: Buffer.from('duplicate-media'),
    });
    assert.equal(response.status, 208);
    assert.deepEqual(await response.json(), { state: 'ALREADY_RECEIVED', key: 'device-a:asset-2' });
    assert.deepEqual(sideEffects, { bodyReads: 0, reservations: 0, files: 0, audits: 0, duplicateChecks: 1 });
  });
});

test('whole-file receive gate preserves authenticated member attribution for ready ingest', async () => {
  await withGateServer({ principal: bearerPrincipal, authMode: 'bearer' }, async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'device-a',
        'x-photosync-asset-id': 'asset-3',
      },
      body: Buffer.from('media'),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.preflight.key, 'device-a:asset-3');
    assert.equal(body.preflight.audit.actorUserId, 'member-42');
    assert.equal(body.preflight.audit.actorDeviceId, 'device-a');
    assert.equal(body.preflight.audit.metadata.attribution, 'authenticated-member');
    assert.deepEqual(sideEffects, { bodyReads: 1, reservations: 1, files: 1, audits: 1, duplicateChecks: 1 });
  });
});

test('whole-file receive gate preserves explicit legacy compatibility attribution', async () => {
  await withGateServer({ authMode: 'pairing-challenge' }, async (baseUrl, sideEffects) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-photosync-workspace-id': 'workspace-a',
        'x-photosync-device-id': 'legacy-phone',
        'x-photosync-asset-id': 'asset-4',
      },
      body: Buffer.from('legacy-media'),
    });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.preflight.audit.actorUserId, 'legacy-owner');
    assert.equal(body.preflight.audit.actorDeviceId, 'legacy-phone');
    assert.equal(body.preflight.audit.metadata.attribution, 'legacy-compatibility');
    assert.equal(body.preflight.audit.metadata.authMode, 'pairing-challenge');
    assert.deepEqual(sideEffects, { bodyReads: 1, reservations: 1, files: 1, audits: 1, duplicateChecks: 1 });
  });
});
