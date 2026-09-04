import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import { loadWorkspaceDriveAccounts } from './driveAccountPolicyStore.js';
import { DriveAllocationPolicyService, type DriveAllocationActor } from './driveAllocationPolicyService.js';
import { rendererDriveAccountInfo } from './driveRuntimeAllocation.js';

export type DriveAllocationWebPrincipal = {
  subject: string;
  workspaceId: string;
  workspaceRole?: 'owner' | 'admin' | 'member' | 'viewer';
  deviceId?: string;
};

const LEGACY_WORKSPACE_ID = process.env.PHOTOX_WORKSPACE_ID || 'legacy-personal';
const LEGACY_OWNER_USER_ID = process.env.PHOTOX_OWNER_USER_ID || 'legacy-owner';
const LEGACY_DESKTOP_DEVICE_ID = `desktop_${crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 20)}`;
let ipcRegistered = false;

async function paths() {
  const { app } = await import('electron');
  const stateDir = path.join(app.getPath('userData'), 'photosync-state');
  return {
    driveAccountsDir: path.join(stateDir, 'google-accounts'),
    databasePath: path.join(stateDir, 'migration.sqlite'),
  };
}

async function withService<T>(run: (service: DriveAllocationPolicyService) => Promise<T>): Promise<T> {
  const resolved = await paths();
  const store = new SqlitePhotoXStore({ path: resolved.databasePath });
  const workspaces = new SqliteWorkspaceRepository(store);
  const service = new DriveAllocationPolicyService({
    directory: resolved.driveAccountsDir,
    legacyWorkspaceId: LEGACY_WORKSPACE_ID,
    listAccounts: async workspaceId => (await loadWorkspaceDriveAccounts(resolved.driveAccountsDir, workspaceId, LEGACY_WORKSPACE_ID))
      .map(account => rendererDriveAccountInfo({ account })),
    appendAudit: event => workspaces.appendAudit({
      workspaceId: event.workspaceId,
      actorUserId: event.actorUserId,
      actorDeviceId: event.actorDeviceId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
    }),
  });
  try { return await run(service); }
  finally { store.close(); }
}

function actorFromWeb(principal: DriveAllocationWebPrincipal): DriveAllocationActor {
  return {
    workspaceId: principal.workspaceId,
    userId: principal.subject,
    deviceId: principal.deviceId,
    role: principal.workspaceRole || 'viewer',
  };
}

async function trustedDesktopActor(): Promise<DriveAllocationActor> {
  const resolved = await paths();
  const store = new SqlitePhotoXStore({ path: resolved.databasePath });
  const workspaces = new SqliteWorkspaceRepository(store);
  try {
    const membership = workspaces.getMembership(LEGACY_WORKSPACE_ID, LEGACY_OWNER_USER_ID);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');
    return {
      workspaceId: LEGACY_WORKSPACE_ID,
      userId: LEGACY_OWNER_USER_ID,
      deviceId: LEGACY_DESKTOP_DEVICE_ID,
      role: membership.role,
    };
  } finally { store.close(); }
}

export async function updateDriveAllocationPolicyForWeb(principal: DriveAllocationWebPrincipal, accountId: string, body: unknown) {
  return withService(service => service.update(actorFromWeb(principal), accountId, body));
}

export async function registerDriveAllocationDesktopTransport() {
  if (ipcRegistered || !process.versions.electron) return;
  const { ipcMain } = await import('electron');
  ipcMain.handle('photosync:google-drive-allocation-update', async (_event, accountId: string, body: unknown) => {
    const actor = await trustedDesktopActor();
    return withService(service => service.update(actor, String(accountId || ''), body));
  });
  ipcRegistered = true;
}

if (process.versions.electron) void registerDriveAllocationDesktopTransport();
