import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createResumableMediaIngestHttpHandler } from './resumableMediaIngestHttp.js';

const lifecycle = {
  async create() { throw new Error('UNEXPECTED_CREATE'); },
  async status() { throw new Error('UNEXPECTED_STATUS'); },
  async appendChunk() { throw new Error('UNEXPECTED_CHUNK'); },
  async finalize() { throw new Error('UNEXPECTED_FINALIZE'); },
};

async function withServer(
  handler: ReturnType<typeof createResumableMediaIngestHttpHandler>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = http.createServer(async (req, res) => {
    if (!(await handler(req, res))) {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SERVER_ADDRESS_UNAVAILABLE');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('physical resumable acceptance transport uses authenticated workspace/device binding', async () => {
  const calls: unknown[] = [];
  const handler = createResumableMediaIngestHttpHandler({
    authorize: async req => {
      if (req.headers.authorization !== 'Bearer device-session') throw new Error('UNAUTHORIZED');
      return { workspaceId: 'ws-authoritative', deviceId: 'device-authoritative', actorUserId: 'member-1' };
    },
    lifecycle,
    acceptanceIngestion: {
      async ingest(input) {
        calls.push(input);
        return { provesAcceptance: true };
      },
    },
    maxJsonBytes: 4096,
  });

  await withServer(handler, async baseUrl => {
    const report = {
      version: 1,
      runId: 'acceptance-run-1',
      workspaceId: 'spoofed-workspace',
      deviceId: 'spoofed-device',
    };
    const denied = await fetch(`${baseUrl}/api/v1/media/uploads/acceptance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    assert.equal(denied.status, 401);
    assert.equal(calls.length, 0);

    const accepted = await fetch(`${baseUrl}/api/v1/media/uploads/acceptance`, {
      method: 'POST',
      headers: { authorization: 'Bearer device-session', 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), { provesAcceptance: true });
    assert.equal(calls.length, 1);
    const call = calls[0] as { workspaceId: string; deviceId: string; report: unknown };
    assert.equal(call.workspaceId, 'ws-authoritative');
    assert.equal(call.deviceId, 'device-authoritative');
    assert.deepEqual(call.report, report);
  });
});

test('acceptance route is unavailable when no authoritative ingestion service is wired', async () => {
  let authorizeCalls = 0;
  const handler = createResumableMediaIngestHttpHandler({
    authorize: async () => {
      authorizeCalls += 1;
      return { workspaceId: 'ws-a', deviceId: 'device-a' };
    },
    lifecycle,
  });

  await withServer(handler, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/media/uploads/acceptance`, {
      method: 'POST',
      headers: { authorization: 'Bearer anything', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'RESUMABLE_UPLOAD_ROUTE_NOT_FOUND' });
    assert.equal(authorizeCalls, 0);
  });
});

test('acceptance route enforces the existing JSON body limit before ingestion', async () => {
  let ingestCalls = 0;
  const handler = createResumableMediaIngestHttpHandler({
    authorize: async () => ({ workspaceId: 'ws-a', deviceId: 'device-a' }),
    lifecycle,
    acceptanceIngestion: {
      async ingest() {
        ingestCalls += 1;
        return { provesAcceptance: false };
      },
    },
    maxJsonBytes: 32,
  });

  await withServer(handler, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/media/uploads/acceptance`, {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(128) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'REQUEST_BODY_TOO_LARGE' });
    assert.equal(ingestCalls, 0);
  });
});