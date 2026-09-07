import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createResumableMediaIngestHttpHandler } from './resumableMediaIngestHttp.js';

function fixture() {
  const calls: any[] = [];
  let acknowledgedBytes = 0;
  const lifecycle = {
    async create(principal: any, input: any) {
      calls.push(['create', principal, input]);
      return { sessionId: 'upload-1', expectedBytes: input.expectedBytes, acknowledgedBytes: 0, expiresAtIso: '2030-01-01T00:00:00.000Z' };
    },
    async status(principal: any, sessionId: string) {
      calls.push(['status', principal, sessionId]);
      return { sessionId, expectedBytes: 6, acknowledgedBytes, expiresAtIso: '2030-01-01T00:00:00.000Z' };
    },
    async appendChunk(principal: any, input: any) {
      calls.push(['chunk', principal, input.sessionId, input.offset, Buffer.from(input.chunk).toString('utf8')]);
      if (input.offset !== acknowledgedBytes) throw new Error(`UPLOAD_OFFSET_MISMATCH:${acknowledgedBytes}`);
      acknowledgedBytes += input.chunk.byteLength;
      return { sessionId: input.sessionId, expectedBytes: 6, acknowledgedBytes, expiresAtIso: '2030-01-01T00:00:00.000Z' };
    },
    async finalize(principal: any, input: any) {
      calls.push(['finalize', principal, input]);
      if (acknowledgedBytes !== 6) throw new Error(`UPLOAD_INCOMPLETE:${acknowledgedBytes}`);
      return { state: 'COMMITTED', key: `${principal.deviceId}:asset-1`, sha256: input.sha256 };
    },
  };
  const handler = createResumableMediaIngestHttpHandler({
    authorize: async req => {
      if (req.headers.authorization !== 'Bearer valid') throw new Error('NOPE');
      return { workspaceId: 'ws-a', deviceId: 'device-a' };
    },
    lifecycle,
    maxJsonBytes: 1024,
    maxChunkBytes: 4,
  });
  return { handler, calls };
}

async function withServer(handler: ReturnType<typeof createResumableMediaIngestHttpHandler>, run: (baseUrl: string) => Promise<void>) {
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

const auth = { authorization: 'Bearer valid' };

test('resumable HTTP transport requires authenticated principal and never trusts body workspace/device ids', async () => {
  const fx = fixture();
  await withServer(fx.handler, async baseUrl => {
    const denied = await fetch(`${baseUrl}/api/v1/media/uploads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: 'UNAUTHORIZED' });

    const response = await fetch(`${baseUrl}/api/v1/media/uploads`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'evil', deviceId: 'evil', assetId: 'asset-1', filename: 'photo.jpg', mimeType: 'image/jpeg', mediaType: 'photo', createdAt: 1, expectedBytes: 6 }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('location'), '/api/v1/media/uploads/upload-1');
    const call = fx.calls[0];
    assert.equal(call[1].workspaceId, 'ws-a');
    assert.equal(call[1].deviceId, 'device-a');
  });
});

test('resumable HTTP transport reports server acknowledged offset and rejects stale offset', async () => {
  const fx = fixture();
  await withServer(fx.handler, async baseUrl => {
    const first = await fetch(`${baseUrl}/api/v1/media/uploads/upload-1/chunks`, {
      method: 'PATCH', headers: { ...auth, 'x-photox-upload-offset': '0', 'content-type': 'application/octet-stream' }, body: Buffer.from('abc'),
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-photox-upload-offset'), '3');
    assert.equal((await first.json()).acknowledgedBytes, 3);

    const stale = await fetch(`${baseUrl}/api/v1/media/uploads/upload-1/chunks`, {
      method: 'PATCH', headers: { ...auth, 'x-photox-upload-offset': '0', 'content-type': 'application/octet-stream' }, body: Buffer.from('d'),
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: 'UPLOAD_OFFSET_MISMATCH', acknowledgedBytes: 3 });
  });
});

test('resumable HTTP transport enforces chunk limit before lifecycle mutation', async () => {
  const fx = fixture();
  await withServer(fx.handler, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/media/uploads/upload-1/chunks`, {
      method: 'PATCH', headers: { ...auth, 'x-photox-upload-offset': '0', 'content-type': 'application/octet-stream' }, body: Buffer.from('abcde'),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'REQUEST_BODY_TOO_LARGE' });
    assert.equal(fx.calls.length, 0);
  });
});

test('resumable HTTP transport exposes status and finalize without filesystem metadata', async () => {
  const fx = fixture();
  await withServer(fx.handler, async baseUrl => {
    await fetch(`${baseUrl}/api/v1/media/uploads/upload-1/chunks`, { method: 'PATCH', headers: { ...auth, 'x-photox-upload-offset': '0' }, body: Buffer.from('abcd') });
    await fetch(`${baseUrl}/api/v1/media/uploads/upload-1/chunks`, { method: 'PATCH', headers: { ...auth, 'x-photox-upload-offset': '4' }, body: Buffer.from('ef') });

    const status = await fetch(`${baseUrl}/api/v1/media/uploads/upload-1`, { headers: auth });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { sessionId: 'upload-1', expectedBytes: 6, acknowledgedBytes: 6, expiresAt: '2030-01-01T00:00:00.000Z' });

    const finalize = await fetch(`${baseUrl}/api/v1/media/uploads/upload-1/finalize`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ sha256: 'a'.repeat(64) }),
    });
    assert.equal(finalize.status, 200);
    assert.equal((await finalize.json()).state, 'COMMITTED');
  });
});

test('resumable HTTP transport leaves unrelated receiver routes untouched', async () => {
  const fx = fixture();
  await withServer(fx.handler, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/status`, { headers: auth });
    assert.equal(response.status, 404);
  });
});
