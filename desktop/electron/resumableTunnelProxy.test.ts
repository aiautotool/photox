import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyResumableTunnelRequest, type RelayResumableRequest } from './resumableTunnelProxy.js';

const pairToken = 'pair-secret';

function request(overrides: Partial<RelayResumableRequest> = {}): RelayResumableRequest {
  return {
    requestId: 'req-1',
    method: 'POST',
    path: '/api/v1/media/uploads',
    headers: {
      'x-photosync-pair-token': pairToken,
      authorization: 'Bearer workspace-token',
      'x-photosync-workspace-id': 'workspace-1',
      'content-type': 'application/json',
    },
    bodyBase64: Buffer.from(JSON.stringify({ assetId: 'asset-1', expectedBytes: 4 })).toString('base64'),
    ...overrides,
  };
}

test('forwards a bounded authenticated create request to the local receiver', async () => {
  let observedUrl = '';
  let observedInit: RequestInit | undefined;
  const result = await proxyResumableTunnelRequest(request(), {
    expectedPairToken: pairToken,
    receiverBaseUrl: 'http://127.0.0.1:43117',
    fetchImpl: async (url, init) => {
      observedUrl = String(url);
      observedInit = init;
      return new Response(JSON.stringify({ sessionId: 'session-1', expectedBytes: 4, acknowledgedBytes: 0, expiresAt: '2099-01-01T00:00:00.000Z' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(observedUrl, 'http://127.0.0.1:43117/api/v1/media/uploads');
  assert.equal(observedInit?.method, 'POST');
  assert.equal((observedInit?.headers as Record<string, string>).authorization, 'Bearer workspace-token');
  assert.equal((observedInit?.headers as Record<string, string>)['x-photosync-pair-token'], undefined);
  assert.equal(Buffer.from(observedInit?.body as ArrayBuffer).toString('utf8'), JSON.stringify({ assetId: 'asset-1', expectedBytes: 4 }));
  assert.equal(result.status, 201);
  assert.equal(JSON.parse(Buffer.from(result.bodyBase64!, 'base64').toString('utf8')).sessionId, 'session-1');
});

test('forwards PATCH chunks and preserves authoritative 409 offset reconciliation body', async () => {
  const chunk = Buffer.from('abcd');
  let observedInit: RequestInit | undefined;
  const result = await proxyResumableTunnelRequest(request({
    method: 'PATCH',
    path: '/api/v1/media/uploads/session-1/chunks',
    headers: {
      'x-photosync-pair-token': pairToken,
      authorization: 'Bearer workspace-token',
      'x-photosync-workspace-id': 'workspace-1',
      'content-type': 'application/octet-stream',
      'x-photox-upload-offset': '8',
    },
    bodyBase64: chunk.toString('base64'),
  }), {
    expectedPairToken: pairToken,
    fetchImpl: async (_url, init) => {
      observedInit = init;
      return new Response(JSON.stringify({ error: 'UPLOAD_OFFSET_MISMATCH', acknowledgedBytes: 12 }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal((observedInit?.headers as Record<string, string>)['x-photox-upload-offset'], '8');
  assert.deepEqual(Buffer.from(observedInit?.body as ArrayBuffer), chunk);
  assert.equal(result.status, 409);
  assert.deepEqual(JSON.parse(Buffer.from(result.bodyBase64!, 'base64').toString('utf8')), {
    error: 'UPLOAD_OFFSET_MISMATCH', acknowledgedBytes: 12,
  });
});

test('forwards only the explicit workspace auth routes and strips relay pair credentials', async () => {
  const observed: Array<{ url:string; init:RequestInit | undefined }> = [];
  for (const path of ['/api/v1/auth/pair', '/api/v1/auth/refresh', '/api/v1/auth/revoke']) {
    const body = path.endsWith('/pair') ? { workspaceId:'workspace-1', pairingChallenge:'challenge-1', deviceId:'phone-1' }
      : path.endsWith('/refresh') ? { refreshToken:'refresh-secret' } : { sessionId:'session-1' };
    const result = await proxyResumableTunnelRequest(request({
      path,
      headers: {
        'x-photosync-pair-token': pairToken,
        'content-type':'application/json',
        authorization:'Bearer access-secret',
        'x-photosync-workspace-id':'workspace-1',
      },
      bodyBase64:Buffer.from(JSON.stringify(body)).toString('base64'),
    }), {
      expectedPairToken:pairToken,
      fetchImpl:async(url, init) => {
        observed.push({ url:String(url), init });
        return new Response(JSON.stringify({ ok:true }), { status:200, headers:{ 'content-type':'application/json' } });
      },
    });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(observed.map(item=>item.url), [
    'http://127.0.0.1:43117/api/v1/auth/pair',
    'http://127.0.0.1:43117/api/v1/auth/refresh',
    'http://127.0.0.1:43117/api/v1/auth/revoke',
  ]);
  for (const item of observed) {
    const headers=item.init?.headers as Record<string,string>;
    assert.equal(headers['x-photosync-pair-token'], undefined);
    assert.equal(headers.authorization, 'Bearer access-secret');
  }
});

test('rejects invalid pair tokens, routes and oversized chunk bodies before local forwarding', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return new Response('{}'); };

  await assert.rejects(() => proxyResumableTunnelRequest(request({ headers: { 'x-photosync-pair-token': 'wrong' } }), {
    expectedPairToken: pairToken, fetchImpl,
  }), /INVALID_RELAY_PAIR_TOKEN/);
  await assert.rejects(() => proxyResumableTunnelRequest(request({ method: 'POST', path: '/api/v1/media' }), {
    expectedPairToken: pairToken, fetchImpl,
  }), /INVALID_RELAY_RESUMABLE_ROUTE/);
  await assert.rejects(() => proxyResumableTunnelRequest(request({ method:'POST', path:'/api/v1/auth/session' }), {
    expectedPairToken:pairToken, fetchImpl,
  }), /INVALID_RELAY_RESUMABLE_ROUTE/);
  await assert.rejects(() => proxyResumableTunnelRequest(request({ bodyBase64: Buffer.alloc(5).toString('base64') }), {
    expectedPairToken: pairToken, fetchImpl, maxRequestBytes: 4,
  }), /RELAY_RESUMABLE_REQUEST_TOO_LARGE/);
  assert.equal(calls, 0);
});