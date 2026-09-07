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
  assetId: 'asset-1',
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  mediaType: 'photo',
  createdAt: 1700000000000,
  expectedBytes: 6,
};

function source(bytes = new Uint8Array([1, 2, 3, 4, 5, 6])) {
  return {
    size: bytes.byteLength,
    async readChunk(offset, length) { return bytes.slice(offset, offset + length); },
    async sha256() { return 'a'.repeat(64); },
  };
}

test('resumable client resumes from server acknowledged offset and clears ledger only after finalize', async () => {
  const store = memoryStore({ sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 2, expiresAt: '2099-01-01T00:00:00.000Z' });
  const calls = [];
  const responses = [
    json(200, { sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 2, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 4, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 6, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { status: 'COMMITTED' }),
  ];
  const client = new ResumableUploadClient({
    baseUrl: 'https://desktop.example',
    chunkBytes: 2,
    sessionStore: store,
    getHeaders: () => ({ authorization: 'Bearer token' }),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, offset: init.headers?.['x-photox-upload-offset'] });
      return responses.shift();
    },
  });

  const progress = [];
  const result = await client.upload(asset, source(), (item) => progress.push(item.uploadedBytes));
  assert.deepEqual(result, { status: 'COMMITTED' });
  assert.equal(store.current(), null);
  assert.deepEqual(progress, [2, 4, 6]);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PATCH', 'PATCH', 'POST']);
  assert.deepEqual(calls.filter((call) => call.method === 'PATCH').map((call) => call.offset), ['2', '4']);
});

test('resumable client reconciles stale offset from 409 without re-uploading acknowledged bytes', async () => {
  const store = memoryStore({ sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' });
  const patchOffsets = [];
  const responses = [
    json(200, { sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(409, { error: 'UPLOAD_OFFSET_MISMATCH', acknowledgedBytes: 4 }),
    json(200, { sessionId: 's1', expectedBytes: 6, acknowledgedBytes: 6, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { status: 'COMMITTED' }),
  ];
  const client = new ResumableUploadClient({
    baseUrl: 'https://desktop.example',
    chunkBytes: 2,
    sessionStore: store,
    getHeaders: () => ({}),
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'PATCH') patchOffsets.push(init.headers?.['x-photox-upload-offset']);
      return responses.shift();
    },
  });

  await client.upload(asset, source());
  assert.deepEqual(patchOffsets, ['0', '4']);
  assert.equal(store.current(), null);
});

test('resumable client recreates an expired durable session and uploads through the new owner', async () => {
  const store = memoryStore({ sessionId: 'expired', expectedBytes: 6, acknowledgedBytes: 4, expiresAt: '2020-01-01T00:00:00.000Z' });
  const calls = [];
  const responses = [
    json(410, { error: 'UPLOAD_SESSION_EXPIRED' }),
    json(201, { sessionId: 'fresh', expectedBytes: 6, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { sessionId: 'fresh', expectedBytes: 6, acknowledgedBytes: 3, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { sessionId: 'fresh', expectedBytes: 6, acknowledgedBytes: 6, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { status: 'ALREADY_RECEIVED' }),
  ];
  const client = new ResumableUploadClient({
    baseUrl: 'https://desktop.example',
    chunkBytes: 3,
    sessionStore: store,
    getHeaders: () => ({}),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method });
      return responses.shift();
    },
  });

  const result = await client.upload(asset, source());
  assert.deepEqual(result, { status: 'ALREADY_RECEIVED' });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[2].url, /\/fresh\/chunks$/);
  assert.equal(store.current(), null);
});

test('resumable client refreshes authentication once and retries the exact failed request', async () => {
  const store = memoryStore(null);
  let token = 'expired';
  let refreshes = 0;
  const calls = [];
  const responses = [
    json(401, { error: 'UNAUTHORIZED' }),
    json(201, { sessionId: 'fresh', expectedBytes: 6, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { sessionId: 'fresh', expectedBytes: 6, acknowledgedBytes: 6, expiresAt: '2099-01-01T00:00:00.000Z' }),
    json(200, { status: 'COMMITTED' }),
  ];
  const client = new ResumableUploadClient({
    baseUrl: 'https://desktop.example',
    chunkBytes: 6,
    sessionStore: store,
    getHeaders: () => ({ authorization: `Bearer ${token}` }),
    onUnauthorized: async () => { refreshes += 1; token = 'fresh'; },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, authorization: init.headers?.authorization });
      return responses.shift();
    },
  });

  const result = await client.upload(asset, source());
  assert.deepEqual(result, { status: 'COMMITTED' });
  assert.equal(refreshes, 1);
  assert.equal(calls[0].authorization, 'Bearer expired');
  assert.equal(calls[1].authorization, 'Bearer fresh');
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].method, calls[1].method);
  assert.equal(store.current(), null);
});
