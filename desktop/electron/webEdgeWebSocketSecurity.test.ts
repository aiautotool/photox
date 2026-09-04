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

async function handshakeStatus(input: {
  url: string;
  origin: string;
  token?: string;
  forwardedFor?: string;
}): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const protocols = input.token ? ['photox-v2', input.token] : ['photox-v2'];
    const socket = new WebSocket(input.url, protocols, {
      origin: input.origin,
      headers: input.forwardedFor ? { 'x-forwarded-for': input.forwardedFor } : undefined,
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('websocket handshake timeout'));
    }, 2_000);
    const finish = (status: number) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      if (status === 101) socket.close();
      else socket.terminate();
      resolve(status);
    };
    socket.once('open', () => finish(101));
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      finish(response.statusCode || 0);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function handlers(): WebEdgeHandlers {
  return {
    authorizeAccessToken: async (token, required) => {
      if (token !== 'access-token') throw new Error('AUTH_INVALID');
      assert.deepEqual(required, ['media:read']);
      return {
        subject: 'user-a',
        workspaceId: 'workspace-a',
        workspaceRole: 'member',
        scopes: ['media:read'],
      };
    },
  } as WebEdgeHandlers;
}

test('WebSocket upgrade enforces origin and authentication before accepting a connection', async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-ws-security-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const edge = new PhotoXWebEdgeServer({
    enabled: true,
    host: '127.0.0.1',
    port,
    allowedOrigins: [origin],
    staticDir,
    publicBaseUrl: origin,
    rateLimitPerMinute: 10,
  }, handlers());

  try {
    await edge.start();
    assert.equal(await handshakeStatus({ url: `ws://127.0.0.1:${port}/api/web/v1/events`, origin: 'https://evil.example', token: 'access-token' }), 403);
    assert.equal(await handshakeStatus({ url: `ws://127.0.0.1:${port}/api/web/v1/events`, origin }), 401);
    assert.equal(await handshakeStatus({ url: `ws://127.0.0.1:${port}/api/web/v1/events`, origin, token: 'access-token' }), 101);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});

test('WebSocket upgrade rate limiting uses trusted forwarded client addresses', async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-ws-proxy-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const edge = new PhotoXWebEdgeServer({
    enabled: true,
    host: '127.0.0.1',
    port,
    allowedOrigins: [origin],
    staticDir,
    publicBaseUrl: origin,
    rateLimitPerMinute: 1,
    trustedProxyAddresses: ['127.0.0.1'],
  }, handlers());

  try {
    await edge.start();
    const url = `ws://127.0.0.1:${port}/api/web/v1/events`;
    assert.equal(await handshakeStatus({ url, origin, token: 'access-token', forwardedFor: '203.0.113.10' }), 101);
    assert.equal(await handshakeStatus({ url, origin, token: 'access-token', forwardedFor: '203.0.113.10' }), 429);
    assert.equal(await handshakeStatus({ url, origin, token: 'access-token', forwardedFor: '203.0.113.11' }), 101);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});

test('untrusted clients cannot spoof X-Forwarded-For to evade WebSocket rate limits', async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-ws-spoof-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const edge = new PhotoXWebEdgeServer({
    enabled: true,
    host: '127.0.0.1',
    port,
    allowedOrigins: [origin],
    staticDir,
    publicBaseUrl: origin,
    rateLimitPerMinute: 1,
    trustedProxyAddresses: [],
  }, handlers());

  try {
    await edge.start();
    const url = `ws://127.0.0.1:${port}/api/web/v1/events`;
    assert.equal(await handshakeStatus({ url, origin, token: 'access-token', forwardedFor: '203.0.113.20' }), 101);
    assert.equal(await handshakeStatus({ url, origin, token: 'access-token', forwardedFor: '203.0.113.21' }), 429);
  } finally {
    await edge.stop();
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});
