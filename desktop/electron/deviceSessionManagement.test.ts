import assert from 'node:assert/strict';
import test from 'node:test';
import { SqlitePhotoXStore, SqliteRefreshSessionStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import { DeviceSessionManagementService } from './deviceSessionManagement.js';

function setupWorkspace(workspaces: SqliteWorkspaceRepository, workspaceId: string, ownerUserId: string, plan: 'free'|'personal'|'pro'|'family'|'team' = 'pro') {
  const now = Date.now();
  workspaces.putWorkspace({ id: workspaceId, name: workspaceId, ownerUserId, plan, status: 'active', createdAt: now, updatedAt: now });
  workspaces.putMembership({ workspaceId, userId: ownerUserId, role: 'owner', status: 'active', joinedAt: now });
  workspaces.setUsage(workspaceId, { managedStorageBytes: 0, monthlyIngressBytes: 0, members: 1, devices: 1, storageProviders: 0, publicShares: 0 }, now);
}

test('device revocation is workspace-scoped and invalidates all device refresh sessions', async () => {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const workspaces = new SqliteWorkspaceRepository(store);
  const refresh = new SqliteRefreshSessionStore(store);
  setupWorkspace(workspaces, 'workspace-a', 'owner-a');
  setupWorkspace(workspaces, 'workspace-b', 'owner-b');
  const now = Date.now();
  workspaces.putDevice({ id: 'shared-device', workspaceId: 'workspace-a', userId: 'owner-a', name: 'A phone', platform: 'ios', kind: 'mobile', createdAt: now });
  workspaces.putDevice({ id: 'shared-device', workspaceId: 'workspace-b', userId: 'owner-b', name: 'B phone', platform: 'android', kind: 'mobile', createdAt: now });

  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const a1 = await refresh.create({ subject: 'owner-a', deviceId: 'shared-device', workspaceId: 'workspace-a', workspaceRole: 'owner', scopes: ['media:read'], expiresAt });
  const a2 = await refresh.create({ subject: 'owner-a', deviceId: 'shared-device', workspaceId: 'workspace-a', workspaceRole: 'owner', scopes: ['media:read', 'media:download'], expiresAt });
  const b1 = await refresh.create({ subject: 'owner-b', deviceId: 'shared-device', workspaceId: 'workspace-b', workspaceRole: 'owner', scopes: ['media:read'], expiresAt });

  const service = new DeviceSessionManagementService(store, workspaces);
  const actorA = { subject: 'owner-a', workspaceId: 'workspace-a', workspaceRole: 'owner' as const, deviceId: 'desktop-a' };
  assert.equal(service.listDevices(actorA).length, 1);
  assert.equal(service.listSessions(actorA).length, 2);

  const result = service.revokeDevice(actorA, 'shared-device', now + 1000);
  assert.deepEqual(result, { deviceId: 'shared-device', sessionsRevoked: 2, activeDevices: 0 });
  assert.equal(service.listDevices(actorA).length, 0);
  assert.equal(service.listSessions(actorA).length, 0);
  assert.equal(await refresh.consume(a1.refreshToken), null);
  assert.equal(await refresh.consume(a2.refreshToken), null);
  assert.ok(await refresh.consume(b1.refreshToken));
  assert.equal(workspaces.listDevices('workspace-b').filter(device => !device.revokedAt).length, 1);
  assert.equal(workspaces.getUsage('workspace-a').devices, 0);
  assert.equal(workspaces.getUsage('workspace-b').devices, 1);
  const audit = workspaces.listAudit('workspace-a');
  assert.equal(audit[0]?.action, 'device.revoke');
  assert.equal(audit[0]?.targetId, 'shared-device');
  assert.equal(audit[0]?.metadata?.sessionsRevoked, 2);
  assert.equal(workspaces.listAudit('workspace-b').length, 0);
  store.close();
});

test('individual session revocation cannot cross workspace or admin-to-owner boundary', async () => {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const workspaces = new SqliteWorkspaceRepository(store);
  const refresh = new SqliteRefreshSessionStore(store);
  setupWorkspace(workspaces, 'workspace-a', 'owner-a');
  setupWorkspace(workspaces, 'workspace-b', 'owner-b');
  const now = Date.now();
  workspaces.putMembership({ workspaceId: 'workspace-a', userId: 'admin-a', role: 'admin', status: 'active', joinedAt: now });
  workspaces.putMembership({ workspaceId: 'workspace-a', userId: 'member-a', role: 'member', status: 'active', joinedAt: now });
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const ownerSession = await refresh.create({ subject: 'owner-a', deviceId: 'owner-device', workspaceId: 'workspace-a', workspaceRole: 'owner', scopes: ['media:read'], expiresAt });
  const memberSession = await refresh.create({ subject: 'member-a', deviceId: 'member-device', workspaceId: 'workspace-a', workspaceRole: 'member', scopes: ['media:read'], expiresAt });
  const foreignSession = await refresh.create({ subject: 'owner-b', deviceId: 'foreign-device', workspaceId: 'workspace-b', workspaceRole: 'owner', scopes: ['media:read'], expiresAt });
  const service = new DeviceSessionManagementService(store, workspaces);

  assert.throws(() => service.revokeSession({ subject: 'owner-a', workspaceId: 'workspace-a', workspaceRole: 'owner' }, foreignSession.sessionId), /SESSION_NOT_FOUND/);
  assert.throws(() => service.revokeSession({ subject: 'admin-a', workspaceId: 'workspace-a', workspaceRole: 'admin' }, ownerSession.sessionId), /ROLE_FORBIDDEN/);
  assert.throws(() => service.revokeSession({ subject: 'member-a', workspaceId: 'workspace-a', workspaceRole: 'member' }, ownerSession.sessionId), /ROLE_FORBIDDEN/);
  assert.deepEqual(service.revokeSession({ subject: 'admin-a', workspaceId: 'workspace-a', workspaceRole: 'admin', deviceId: 'desktop-a' }, memberSession.sessionId), { sessionId: memberSession.sessionId, revoked: true });
  assert.equal(await refresh.consume(memberSession.refreshToken), null);
  assert.ok(await refresh.consume(ownerSession.refreshToken));
  assert.ok(await refresh.consume(foreignSession.refreshToken));
  const audit = workspaces.listAudit('workspace-a');
  assert.equal(audit[0]?.action, 'session.revoke');
  assert.equal(audit[0]?.targetId, memberSession.sessionId);
  store.close();
});

test('device session management enforces membership and owner/admin authorization', async () => {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const workspaces = new SqliteWorkspaceRepository(store);
  setupWorkspace(workspaces, 'workspace-a', 'owner-a');
  const now = Date.now();
  workspaces.putMembership({ workspaceId: 'workspace-a', userId: 'admin-a', role: 'admin', status: 'active', joinedAt: now });
  workspaces.putMembership({ workspaceId: 'workspace-a', userId: 'viewer-a', role: 'viewer', status: 'active', joinedAt: now });
  workspaces.putDevice({ id: 'owner-device', workspaceId: 'workspace-a', userId: 'owner-a', name: 'Owner device', platform: 'ios', kind: 'mobile', createdAt: now });
  workspaces.putDevice({ id: 'viewer-device', workspaceId: 'workspace-a', userId: 'viewer-a', name: 'Viewer device', platform: 'android', kind: 'mobile', createdAt: now });
  const service = new DeviceSessionManagementService(store, workspaces);

  assert.throws(() => service.listSessions({ subject: 'viewer-a', workspaceId: 'workspace-a', workspaceRole: 'viewer' }), /ROLE_FORBIDDEN/);
  assert.throws(() => service.revokeDevice({ subject: 'viewer-a', workspaceId: 'workspace-a', workspaceRole: 'viewer' }, 'viewer-device'), /ROLE_FORBIDDEN/);
  assert.throws(() => service.revokeDevice({ subject: 'admin-a', workspaceId: 'workspace-a', workspaceRole: 'admin' }, 'owner-device'), /ROLE_FORBIDDEN/);
  assert.equal(service.revokeDevice({ subject: 'admin-a', workspaceId: 'workspace-a', workspaceRole: 'admin' }, 'viewer-device').activeDevices, 1);
  assert.throws(() => service.listDevices({ subject: 'missing', workspaceId: 'workspace-a', workspaceRole: 'admin' }), /MEMBERSHIP_INACTIVE/);
  assert.throws(() => service.listDevices({ subject: 'admin-a', workspaceId: 'workspace-a', workspaceRole: 'owner' }), /WORKSPACE_ROLE_STALE/);
  store.close();
});
