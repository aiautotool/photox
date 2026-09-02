import { randomUUID } from 'node:crypto';
import type {
  Workspace,
  WorkspaceDevice,
  WorkspaceMembership,
  WorkspacePlanCode,
  WorkspaceRole,
  WorkspaceUsage,
} from '@photosync/core';
import { createLegacyPersonalWorkspace } from '@photosync/core';
import type { SqlitePhotoXStore } from './index.js';

export interface WorkspaceAuditEvent {
  id: string;
  workspaceId: string;
  actorUserId: string;
  actorDeviceId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

const ZERO_USAGE: WorkspaceUsage = {
  managedStorageBytes: 0,
  monthlyIngressBytes: 0,
  members: 0,
  devices: 0,
  storageProviders: 0,
  publicShares: 0,
};

export class SqliteWorkspaceRepository {
  constructor(private readonly store: SqlitePhotoXStore) {
    this.migrate();
  }

  private migrate() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS photox_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photox_workspace_memberships (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id,user_id),
        FOREIGN KEY(workspace_id) REFERENCES photox_workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_photox_memberships_user ON photox_workspace_memberships(user_id,status);
      CREATE TABLE IF NOT EXISTS photox_workspace_devices (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER,
        PRIMARY KEY(workspace_id,id),
        FOREIGN KEY(workspace_id) REFERENCES photox_workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_photox_devices_workspace_user ON photox_workspace_devices(workspace_id,user_id,revoked_at);
      CREATE TABLE IF NOT EXISTS photox_workspace_usage (
        workspace_id TEXT PRIMARY KEY,
        managed_storage_bytes INTEGER NOT NULL DEFAULT 0,
        monthly_ingress_bytes INTEGER NOT NULL DEFAULT 0,
        monthly_ingress_period TEXT,
        members INTEGER NOT NULL DEFAULT 0,
        devices INTEGER NOT NULL DEFAULT 0,
        storage_providers INTEGER NOT NULL DEFAULT 0,
        public_shares INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES photox_workspaces(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS photox_workspace_audit (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        actor_device_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES photox_workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_photox_audit_workspace_created ON photox_workspace_audit(workspace_id,created_at DESC);
    `);
    const cols=this.store.db.prepare('PRAGMA table_info(photox_workspace_usage)').all() as Array<{name:string}>;
    if(!cols.some(col=>col.name==='monthly_ingress_period')) this.store.db.exec('ALTER TABLE photox_workspace_usage ADD COLUMN monthly_ingress_period TEXT');
  }

  private usagePeriod(now=Date.now()){const d=new Date(now);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}

  ensureMonthlyIngressPeriod(workspaceId:string, now=Date.now()): WorkspaceUsage {
    const period=this.usagePeriod(now); const row=this.store.db.prepare('SELECT monthly_ingress_period FROM photox_workspace_usage WHERE workspace_id=?').get(workspaceId) as {monthly_ingress_period?:string}|undefined;
    if(row?.monthly_ingress_period===period) return this.getUsage(workspaceId);
    const usage=this.getUsage(workspaceId);
    if(!row?.monthly_ingress_period){ this.store.db.prepare('UPDATE photox_workspace_usage SET monthly_ingress_period=? WHERE workspace_id=?').run(period,workspaceId); return usage; }
    const next={...usage,monthlyIngressBytes:0}; this.setUsage(workspaceId,next,now);
    this.store.db.prepare('UPDATE photox_workspace_usage SET monthly_ingress_period=? WHERE workspace_id=?').run(period,workspaceId); return next;
  }

  ensureLegacyPersonalWorkspace(input: {
    workspaceId: string;
    ownerUserId: string;
    name?: string;
    plan?: WorkspacePlanCode;
    now?: number;
  }): { workspace: Workspace; membership: WorkspaceMembership; created: boolean } {
    const existing = this.getWorkspace(input.workspaceId);
    if (existing) {
      const membership = this.getMembership(input.workspaceId, input.ownerUserId);
      if (!membership) {
        const joinedAt = input.now ?? Date.now();
        this.putMembership({ workspaceId: input.workspaceId, userId: input.ownerUserId, role: 'owner', status: 'active', joinedAt });
      }
      return { workspace: existing, membership: this.getMembership(input.workspaceId, input.ownerUserId)!, created: false };
    }
    const legacy = createLegacyPersonalWorkspace(input);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.putWorkspace(legacy.workspace);
      this.putMembership(legacy.membership);
      this.setUsage(legacy.workspace.id, { ...ZERO_USAGE, members: 1 });
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
    return { ...legacy, created: true };
  }

  putWorkspace(workspace: Workspace) {
    this.store.db.prepare(`INSERT INTO photox_workspaces(id,name,owner_user_id,plan,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,owner_user_id=excluded.owner_user_id,plan=excluded.plan,status=excluded.status,updated_at=excluded.updated_at`).run(
      workspace.id, workspace.name, workspace.ownerUserId, workspace.plan, workspace.status, workspace.createdAt, workspace.updatedAt,
    );
  }

  getWorkspace(workspaceId: string): Workspace | null {
    const row = this.store.db.prepare('SELECT * FROM photox_workspaces WHERE id=?').get(workspaceId) as Record<string, unknown> | undefined;
    return row ? {
      id: String(row.id), name: String(row.name), ownerUserId: String(row.owner_user_id), plan: String(row.plan) as WorkspacePlanCode,
      status: String(row.status) as Workspace['status'], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    } : null;
  }

  putMembership(membership: WorkspaceMembership) {
    if (!this.getWorkspace(membership.workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
    this.store.db.prepare(`INSERT INTO photox_workspace_memberships(workspace_id,user_id,role,status,joined_at) VALUES(?,?,?,?,?)
      ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status=excluded.status`).run(
      membership.workspaceId, membership.userId, membership.role, membership.status, membership.joinedAt,
    );
  }

  getMembership(workspaceId: string, userId: string): WorkspaceMembership | null {
    const row = this.store.db.prepare('SELECT * FROM photox_workspace_memberships WHERE workspace_id=? AND user_id=?').get(workspaceId, userId) as Record<string, unknown> | undefined;
    return row ? {
      workspaceId: String(row.workspace_id), userId: String(row.user_id), role: String(row.role) as WorkspaceRole,
      status: String(row.status) as WorkspaceMembership['status'], joinedAt: Number(row.joined_at),
    } : null;
  }

  listMemberships(workspaceId: string): WorkspaceMembership[] {
    return (this.store.db.prepare('SELECT * FROM photox_workspace_memberships WHERE workspace_id=? ORDER BY joined_at').all(workspaceId) as Record<string, unknown>[]).map(row => ({
      workspaceId: String(row.workspace_id), userId: String(row.user_id), role: String(row.role) as WorkspaceRole,
      status: String(row.status) as WorkspaceMembership['status'], joinedAt: Number(row.joined_at),
    }));
  }

  putDevice(device: WorkspaceDevice) {
    if (!this.getMembership(device.workspaceId, device.userId)) throw new Error('WORKSPACE_MEMBERSHIP_REQUIRED');
    this.store.db.prepare(`INSERT INTO photox_workspace_devices(id,workspace_id,user_id,name,platform,kind,created_at,last_seen_at,revoked_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET user_id=excluded.user_id,name=excluded.name,platform=excluded.platform,kind=excluded.kind,last_seen_at=excluded.last_seen_at,revoked_at=excluded.revoked_at`).run(
      device.id, device.workspaceId, device.userId, device.name, device.platform, device.kind, device.createdAt, device.lastSeenAt ?? null, device.revokedAt ?? null,
    );
  }

  listDevices(workspaceId: string): WorkspaceDevice[] {
    return (this.store.db.prepare('SELECT * FROM photox_workspace_devices WHERE workspace_id=? ORDER BY created_at').all(workspaceId) as Record<string, unknown>[]).map(row => ({
      id: String(row.id), workspaceId: String(row.workspace_id), userId: String(row.user_id), name: String(row.name),
      platform: String(row.platform) as WorkspaceDevice['platform'], kind: String(row.kind) as WorkspaceDevice['kind'], createdAt: Number(row.created_at),
      lastSeenAt: row.last_seen_at == null ? undefined : Number(row.last_seen_at), revokedAt: row.revoked_at == null ? undefined : Number(row.revoked_at),
    }));
  }

  revokeDevice(workspaceId: string, deviceId: string, revokedAt = Date.now()) {
    this.store.db.prepare('UPDATE photox_workspace_devices SET revoked_at=? WHERE workspace_id=? AND id=?').run(revokedAt, workspaceId, deviceId);
  }

  setUsage(workspaceId: string, usage: WorkspaceUsage, updatedAt = Date.now()) {
    if (!this.getWorkspace(workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
    const values = Object.values(usage);
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('INVALID_WORKSPACE_USAGE');
    this.store.db.prepare(`INSERT INTO photox_workspace_usage(workspace_id,managed_storage_bytes,monthly_ingress_bytes,members,devices,storage_providers,public_shares,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET managed_storage_bytes=excluded.managed_storage_bytes,monthly_ingress_bytes=excluded.monthly_ingress_bytes,members=excluded.members,devices=excluded.devices,storage_providers=excluded.storage_providers,public_shares=excluded.public_shares,updated_at=excluded.updated_at`).run(
      workspaceId, usage.managedStorageBytes, usage.monthlyIngressBytes, usage.members, usage.devices, usage.storageProviders, usage.publicShares, updatedAt,
    );
  }

  getUsage(workspaceId: string): WorkspaceUsage {
    const row = this.store.db.prepare('SELECT * FROM photox_workspace_usage WHERE workspace_id=?').get(workspaceId) as Record<string, unknown> | undefined;
    if (!row) return { ...ZERO_USAGE };
    return {
      managedStorageBytes: Number(row.managed_storage_bytes), monthlyIngressBytes: Number(row.monthly_ingress_bytes), members: Number(row.members),
      devices: Number(row.devices), storageProviders: Number(row.storage_providers), publicShares: Number(row.public_shares),
    };
  }


  reserveMediaWrite(workspaceId: string, bytes: number, limits: { maxManagedStorageBytes: number | null; maxMonthlyIngressBytes: number | null }, now = Date.now()): WorkspaceUsage {
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('INVALID_MEDIA_RESERVATION_BYTES');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const usage = this.ensureMonthlyIngressPeriod(workspaceId, now);
      const nextManaged = usage.managedStorageBytes + bytes;
      const nextIngress = usage.monthlyIngressBytes + bytes;
      if (limits.maxManagedStorageBytes !== null && nextManaged > limits.maxManagedStorageBytes) throw new Error('WORKSPACE_MANAGED_STORAGE_QUOTA_EXCEEDED');
      if (limits.maxMonthlyIngressBytes !== null && nextIngress > limits.maxMonthlyIngressBytes) throw new Error('WORKSPACE_MONTHLY_INGRESS_QUOTA_EXCEEDED');
      const next = { ...usage, managedStorageBytes: nextManaged, monthlyIngressBytes: nextIngress };
      this.setUsage(workspaceId, next);
      this.store.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  releaseMediaReservation(workspaceId: string, bytes: number, options: { releaseManaged?: boolean; releaseIngress?: boolean } = { releaseManaged: true, releaseIngress: true }): WorkspaceUsage {
    if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('INVALID_MEDIA_RESERVATION_BYTES');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const usage = this.getUsage(workspaceId);
      const next = {
        ...usage,
        managedStorageBytes: options.releaseManaged === false ? usage.managedStorageBytes : Math.max(0, usage.managedStorageBytes - bytes),
        monthlyIngressBytes: options.releaseIngress === false ? usage.monthlyIngressBytes : Math.max(0, usage.monthlyIngressBytes - bytes),
      };
      this.setUsage(workspaceId, next);
      this.store.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  appendAudit(event: Omit<WorkspaceAuditEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): WorkspaceAuditEvent {
    if (!this.getWorkspace(event.workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
    const stored: WorkspaceAuditEvent = { ...event, id: event.id ?? randomUUID(), createdAt: event.createdAt ?? Date.now() };
    this.store.db.prepare(`INSERT INTO photox_workspace_audit(id,workspace_id,actor_user_id,actor_device_id,action,target_type,target_id,metadata_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(stored.id, stored.workspaceId, stored.actorUserId, stored.actorDeviceId ?? null, stored.action, stored.targetType ?? null, stored.targetId ?? null, stored.metadata ? JSON.stringify(stored.metadata) : null, stored.createdAt);
    return stored;
  }

  listAudit(workspaceId: string, limit = 100): WorkspaceAuditEvent[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return (this.store.db.prepare('SELECT * FROM photox_workspace_audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?').all(workspaceId, safeLimit) as Record<string, unknown>[]).map(row => ({
      id: String(row.id), workspaceId: String(row.workspace_id), actorUserId: String(row.actor_user_id),
      actorDeviceId: row.actor_device_id ? String(row.actor_device_id) : undefined, action: String(row.action),
      targetType: row.target_type ? String(row.target_type) : undefined, targetId: row.target_id ? String(row.target_id) : undefined,
      metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) as Record<string, unknown> : undefined, createdAt: Number(row.created_at),
    }));
  }
}
