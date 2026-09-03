import type { MediaApiScope } from '@photox/media-api';
import type { WorkspaceDevice, WorkspaceRole } from '@photosync/core';
import type { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';

export type DeviceSessionActor = {
  subject: string;
  workspaceId: string;
  workspaceRole?: WorkspaceRole;
  deviceId?: string;
  sessionId?: string;
};

export type WorkspaceSessionSummary = {
  sessionId: string;
  subject: string;
  deviceId?: string;
  scopes: MediaApiScope[];
  expiresAt: number;
  createdAt: number;
  lastUsedAt?: number;
};

export type DeviceSessionSnapshot = {
  devices: WorkspaceDevice[];
  sessions: WorkspaceSessionSummary[];
};

const ADMIN_ROLES = new Set<WorkspaceRole>(['owner', 'admin']);

export class DeviceSessionManagementService {
  constructor(
    private readonly store: SqlitePhotoXStore,
    private readonly workspaces: SqliteWorkspaceRepository,
  ) {
    this.ensureSessionWorkspaceColumns();
  }

  private ensureSessionWorkspaceColumns() {
    const columns = new Set((this.store.db.prepare('PRAGMA table_info(photox_refresh_sessions)').all() as Array<{ name: string }>).map(row => row.name));
    if (!columns.has('workspace_id')) this.store.db.exec('ALTER TABLE photox_refresh_sessions ADD COLUMN workspace_id TEXT');
    if (!columns.has('workspace_role')) this.store.db.exec('ALTER TABLE photox_refresh_sessions ADD COLUMN workspace_role TEXT');
  }

  private requireActiveMembership(actor: DeviceSessionActor) {
    const membership = this.workspaces.getMembership(actor.workspaceId, actor.subject);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');
    if (actor.workspaceRole && actor.workspaceRole !== membership.role) throw new Error('WORKSPACE_ROLE_STALE');
    return membership;
  }

  private requireAdmin(actor: DeviceSessionActor) {
    const membership = this.requireActiveMembership(actor);
    if (!ADMIN_ROLES.has(membership.role)) throw new Error('ROLE_FORBIDDEN');
    return membership;
  }

  listDevices(actor: DeviceSessionActor): WorkspaceDevice[] {
    this.requireActiveMembership(actor);
    return this.workspaces.listDevices(actor.workspaceId).filter(device => !device.revokedAt);
  }

  listSessions(actor: DeviceSessionActor): WorkspaceSessionSummary[] {
    this.requireAdmin(actor);
    const now = Math.floor(Date.now() / 1000);
    const rows = this.store.db.prepare(`SELECT session_id,subject,device_id,scopes_json,expires_at,created_at,last_used_at
      FROM photox_refresh_sessions
      WHERE workspace_id=? AND revoked_at IS NULL AND expires_at>?
      ORDER BY created_at DESC`).all(actor.workspaceId, now) as Record<string, unknown>[];
    return rows.map(row => ({
      sessionId: String(row.session_id),
      subject: String(row.subject),
      deviceId: row.device_id ? String(row.device_id) : undefined,
      scopes: JSON.parse(String(row.scopes_json)) as MediaApiScope[],
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at == null ? undefined : Number(row.last_used_at),
    }));
  }

  snapshot(actor: DeviceSessionActor): DeviceSessionSnapshot {
    return { devices: this.listDevices(actor), sessions: this.listSessions(actor) };
  }

  revokeDevice(actor: DeviceSessionActor, deviceId: string, revokedAt = Date.now()) {
    const actorMembership = this.requireAdmin(actor);
    const target = this.workspaces.listDevices(actor.workspaceId).find(device => device.id === deviceId && !device.revokedAt);
    if (!target) throw new Error('DEVICE_NOT_FOUND');
    const targetMembership = this.workspaces.getMembership(actor.workspaceId, target.userId);
    if (actorMembership.role === 'admin' && targetMembership?.role === 'owner') throw new Error('ROLE_FORBIDDEN');

    const sessionRevokedAt = Math.floor(revokedAt / 1000);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.workspaces.revokeDevice(actor.workspaceId, deviceId, revokedAt);
      const result = this.store.db.prepare(`UPDATE photox_refresh_sessions SET revoked_at=?
        WHERE workspace_id=? AND device_id=? AND revoked_at IS NULL`).run(sessionRevokedAt, actor.workspaceId, deviceId);
      const activeDevices = this.workspaces.listDevices(actor.workspaceId).filter(device => !device.revokedAt).length;
      const usage = this.workspaces.getUsage(actor.workspaceId);
      this.workspaces.setUsage(actor.workspaceId, { ...usage, devices: activeDevices }, revokedAt);
      this.workspaces.appendAudit({
        workspaceId: actor.workspaceId,
        actorUserId: actor.subject,
        actorDeviceId: actor.deviceId,
        action: 'device.revoke',
        targetType: 'device',
        targetId: deviceId,
        metadata: { sessionsRevoked: Number(result.changes) },
        createdAt: revokedAt,
      });
      this.store.db.exec('COMMIT');
      return { deviceId, sessionsRevoked: Number(result.changes), activeDevices };
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }
}
