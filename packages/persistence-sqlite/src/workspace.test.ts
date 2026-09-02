import { describe, expect, it } from 'vitest';
import { SqlitePhotoXStore } from './index.js';
import { SqliteWorkspaceRepository } from './workspace.js';

function setup() {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const repo = new SqliteWorkspaceRepository(store);
  return { store, repo };
}

describe('SqliteWorkspaceRepository', () => {
  it('creates a legacy personal workspace exactly once', () => {
    const { store, repo } = setup();
    const first = repo.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'user-a', now: 1000 });
    const second = repo.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'user-a', now: 2000 });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(repo.getMembership('ws-a', 'user-a')).toMatchObject({ role: 'owner', status: 'active' });
    expect(repo.getUsage('ws-a').members).toBe(1);
    store.close();
  });

  it('keeps membership and device queries tenant scoped', () => {
    const { store, repo } = setup();
    repo.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'user-a' });
    repo.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-b', ownerUserId: 'user-b' });
    repo.putDevice({ id: 'same-device-id', workspaceId: 'ws-a', userId: 'user-a', name: 'A Mac', platform: 'macos', kind: 'desktop', createdAt: 1 });
    repo.putDevice({ id: 'same-device-id', workspaceId: 'ws-b', userId: 'user-b', name: 'B PC', platform: 'windows', kind: 'desktop', createdAt: 2 });
    expect(repo.listDevices('ws-a')).toHaveLength(1);
    expect(repo.listDevices('ws-a')[0].name).toBe('A Mac');
    expect(repo.listDevices('ws-b')[0].name).toBe('B PC');
    expect(repo.getMembership('ws-a', 'user-b')).toBeNull();
    store.close();
  });

  it('persists usage and rejects invalid counters', () => {
    const { store, repo } = setup();
    repo.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'user-a' });
    repo.setUsage('ws-a', { managedStorageBytes: 123, monthlyIngressBytes: 50, members: 1, devices: 2, storageProviders: 3, publicShares: 4 }, 99);
    expect(repo.getUsage('ws-a')).toEqual({ managedStorageBytes: 123, monthlyIngressBytes: 50, members: 1, devices: 2, storageProviders: 3, publicShares: 4 });
    expect(() => repo.setUsage('ws-a', { managedStorageBytes: -1, monthlyIngressBytes: 0, members: 0, devices: 0, storageProviders: 0, publicShares: 0 })).toThrow('INVALID_WORKSPACE_USAGE');
    store.close();
  });

  it('stores audit events only inside their workspace', () => {
    const { store, repo } = setup();
    repo.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'user-a' });
    repo.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-b', ownerUserId: 'user-b' });
    repo.appendAudit({ workspaceId: 'ws-a', actorUserId: 'user-a', action: 'provider.connect', targetType: 'google_drive', targetId: 'drive-1', metadata: { result: 'ok' }, createdAt: 10 });
    repo.appendAudit({ workspaceId: 'ws-b', actorUserId: 'user-b', action: 'device.revoke', targetType: 'device', targetId: 'phone-1', createdAt: 20 });
    expect(repo.listAudit('ws-a')).toHaveLength(1);
    expect(repo.listAudit('ws-a')[0]).toMatchObject({ action: 'provider.connect', targetId: 'drive-1' });
    expect(repo.listAudit('ws-b')).toHaveLength(1);
    store.close();
  });
});
