import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpDesktopBridge } from './bridge.js';

test('Web bridge reads the authenticated workspace overview endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer workspace-access');
    if (!url.endsWith('/api/web/v1/workspace')) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify({
      workspace: { id: 'workspace-a', name: 'Workspace A', ownerUserId: 'owner-a', plan: 'personal', status: 'active' },
      membership: { userId: 'user-a', role: 'admin', status: 'active', joinedAt: 1 },
      usage: { managedStorageBytes: 25, monthlyIngressBytes: 10, members: 2, devices: 3, storageProviders: 1, publicShares: 0 },
      entitlements: { maxManagedStorageBytes: 100, maxMonthlyIngressBytes: 100, maxMembers: 5, maxDevices: 10, maxStorageProviders: 6, maxPublicShares: 20, targetOriginalReplicas: 2, publicSharing: true, remoteAccess: true, semanticSearch: false, priorityVideoProcessing: false },
      quota: {
        managedStorage: { current: 25, limit: 100, remaining: 75, percent: 25 },
        monthlyIngress: { current: 10, limit: 100, remaining: 90, percent: 10 },
        members: { current: 2, limit: 5, remaining: 3, percent: 40 },
        devices: { current: 3, limit: 10, remaining: 7, percent: 30 },
        storageProviders: { current: 1, limit: 6, remaining: 5, percent: 17 },
        publicShares: { current: 0, limit: 20, remaining: 20, percent: 0 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const bridge = createHttpDesktopBridge({ baseUrl: 'https://photox.example', accessToken: 'workspace-access' });
    const snapshot = await bridge.getWorkspaceOverview();
    assert.equal(snapshot.workspace.id, 'workspace-a');
    assert.equal(snapshot.workspace.plan, 'personal');
    assert.equal(snapshot.membership.role, 'admin');
    assert.equal(snapshot.quota.managedStorage.percent, 25);
    assert.deepEqual(calls, ['https://photox.example/api/web/v1/workspace']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Web bridge sends billing idempotency key as transport metadata, not request body', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.equal(url, 'https://photox.example/api/web/v1/workspace/subscription/mutations');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer workspace-access');
    assert.equal(headers.get('idempotency-key'), 'billing-mutation-key-0001');
    assert.deepEqual(JSON.parse(String(init?.body)), { operation: 'change_plan', targetPlan: 'pro' });
    assert.equal(String(init?.body).includes('billing-mutation-key-0001'), false);
    return new Response(JSON.stringify({ status: 'succeeded', replayed: false, attempts: 1, providerStateResult: 'APPLIED' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const bridge = createHttpDesktopBridge({ baseUrl: 'https://photox.example', accessToken: 'workspace-access' });
    const result = await bridge.mutateWorkspaceSubscription({ operation: 'change_plan', targetPlan: 'pro' }, 'billing-mutation-key-0001');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.replayed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
