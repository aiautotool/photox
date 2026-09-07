import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ResumableUploadClient } = require('../../mobile-sdk/dist/ResumableUploadClient.js');

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function memoryStore(initial = null) {
  let value = initial;
  return {
    async load() { return value; },
    async save(_assetId, session) { value = { ...session }; },
    async remove() { value = null; },
    current() { return value; },
  };
}

const asset = {
  assetId: 'asset-cancel',
  filename: 'video.mp4',
  mimeType: 'video/mp4',
  mediaType: 'video',
  createdAt: 1700000000000,
  expectedBytes: 6,
};

const source = {
  size: 6,
  async readChunk(offset, length) { return new Uint8Array([1, 2, 3, 4, 5, 6]).slice(offset, offset + length); },
  async sha256() { return 'a'.repeat(64); },
};

test('resumable client aborts an in-flight chunk request and preserves durable session ownership', async () => {
  const store = memoryStore({ sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' });
  const controller = new AbortController();
  const methods = [];
  let notifyPatchStarted;
  const patchStarted = new Promise((resolve) => { notifyPatchStarted = resolve; });

  const client = new ResumableUploadClient({
    baseUrl: 'https://desktop.example',
    chunkBytes: 6,
    sessionStore: store,
    getHeaders: () => ({ authorization: 'Bearer token' }),
    fetchImpl: async (_url, init = {}) => {
      methods.push(init.method);
      if (init.method === 'GET') {
        return json(200, { sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' });
      }
      if (init.method === 'PATCH') {
        assert.equal(init.signal, controller.signal);
        notifyPatchStarted();
        return await new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      throw new Error(`Unexpected request ${init.method}`);
    },
  });

  const upload = client.upload(asset, source, undefined, controller.signal);
  await patchStarted;
  controller.abort();

  await assert.rejects(upload, (error) => error?.name === 'AbortError');
  assert.deepEqual(methods, ['GET', 'PATCH']);
  assert.deepEqual(store.current(), { sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' });
});
