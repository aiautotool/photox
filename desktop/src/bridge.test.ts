import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpDesktopBridge } from './bridge.js';

test('ticket-only Web bridge bootstraps the session before calling protected APIs', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ url, method, authorization: headers.get('authorization') || undefined });
    if (url.endsWith('/api/web/v1/auth/ticket')) {
      assert.equal(method, 'POST');
      assert.equal(JSON.parse(String(init?.body)), 'ticket-1');
      return new Response(JSON.stringify({ accessToken: 'access-1', csrfToken: 'csrf-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/api/web/v1/status')) {
      assert.equal(headers.get('authorization'), 'Bearer access-1');
      return new Response(JSON.stringify({ state: 'idle', received: 0, duplicates: 0, cloudUploaded: 0, cloudBlocked: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/api/web/v1/auth/refresh')) {
      throw new Error('refresh must not run before redeeming a supplied login ticket');
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;

  try {
    const bridge = createHttpDesktopBridge({ baseUrl: 'https://photox.example', loginTicket: 'ticket-1' });
    const status = await bridge.getStatus();
    assert.equal(status.state, 'idle');
    assert.deepEqual(calls.map(call => [call.method, call.url]), [
      ['POST', 'https://photox.example/api/web/v1/auth/ticket'],
      ['GET', 'https://photox.example/api/web/v1/status'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
