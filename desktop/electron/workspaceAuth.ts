import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { WorkspaceRole } from '@photosync/core';
import { entitlementsForPlan } from '@photosync/core';
import { AuthSessionService, AuthorizationService, bearerToken, type MediaApiScope, type WorkspaceSessionRole } from '@photox/media-api';
import { JoseAccessTokenService } from '@photox/auth-jose';
import { SqliteRefreshSessionStore, type SqlitePhotoXStore, type SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import type { WorkspacePairingChallengeManager } from './pairingChallenge.js';
import { DeviceSessionManagementService, type DeviceSessionActor } from './deviceSessionManagement.js';

export type PairExchangeInput = {
  workspaceId: string;
  pairingChallenge: string;
  deviceId: string;
  deviceName?: string;
  platform?: 'ios'|'android'|'windows'|'macos'|'linux'|'web'|'unknown';
};

export class DesktopWorkspaceAuth {
  private readonly tokenService: JoseAccessTokenService;
  private readonly sessions: AuthSessionService;
  private readonly authorization: AuthorizationService;
  private readonly deviceSessions: DeviceSessionManagementService;

  private constructor(
    secret: Uint8Array,
    private readonly store: SqlitePhotoXStore,
    private readonly workspaces: SqliteWorkspaceRepository,
    private readonly pairing: WorkspacePairingChallengeManager,
    private readonly workspaceId: string,
    private readonly ownerUserId: string,
  ) {
    this.tokenService = new JoseAccessTokenService({ secret, issuer: 'photox-desktop-edge', audience: 'photox-client' });
    this.authorization = new AuthorizationService(this.tokenService);
    const refresh = new SqliteRefreshSessionStore(store);
    this.sessions = new AuthSessionService(this.tokenService, refresh, {
      verify: async ({ deviceId, pairCode }) => {
        const separator = pairCode.indexOf(':');
        const requestWorkspace = separator >= 0 ? pairCode.slice(0, separator) : '';
        const challenge = separator >= 0 ? pairCode.slice(separator + 1) : '';
        if (requestWorkspace !== this.workspaceId || !this.pairing.verify({ workspaceId: requestWorkspace, challenge })) throw new Error('PAIRING_CHALLENGE_INVALID');
        const membership = this.workspaces.getMembership(this.workspaceId, this.ownerUserId);
        if (!membership || membership.status !== 'active') throw new Error('PAIRING_MEMBERSHIP_INVALID');
        return {
          subject: this.ownerUserId,
          workspaceId: this.workspaceId,
          workspaceRole: membership.role as WorkspaceSessionRole,
          scopes: ['media:read','media:download','media:write','media:delete','cloud:read','cloud:manage'],
        };
      },
    });
    this.deviceSessions = new DeviceSessionManagementService(store, workspaces);
  }

  static async create(input: {
    secretFile: string;
    store: SqlitePhotoXStore;
    workspaces: SqliteWorkspaceRepository;
    pairing: WorkspacePairingChallengeManager;
    workspaceId: string;
    ownerUserId: string;
  }) {
    let secret: Buffer;
    try { secret = await fs.readFile(input.secretFile); }
    catch {
      secret = crypto.randomBytes(32);
      await fs.writeFile(input.secretFile, secret, { mode: 0o600 });
    }
    if (secret.byteLength < 32) throw new Error('PHOTOX_AUTH_SECRET_INVALID');
    return new DesktopWorkspaceAuth(new Uint8Array(secret), input.store, input.workspaces, input.pairing, input.workspaceId, input.ownerUserId);
  }

  async exchange(input: PairExchangeInput) {
    if (input.workspaceId !== this.workspaceId) throw new Error('WORKSPACE_SCOPE_MISMATCH');
    const workspace = this.workspaces.getWorkspace(input.workspaceId);
    if (!workspace || workspace.status !== 'active') throw new Error('WORKSPACE_INACTIVE');
    const membership = this.workspaces.getMembership(input.workspaceId, this.ownerUserId);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');

    const existing = this.workspaces.listDevices(input.workspaceId).find(device => device.id === input.deviceId && !device.revokedAt);
    if (!existing) {
      const plan = entitlementsForPlan(workspace.plan);
      const activeDevices = this.workspaces.listDevices(input.workspaceId).filter(device => !device.revokedAt).length;
      if (plan.maxDevices !== null && activeDevices + 1 > plan.maxDevices) throw new Error('WORKSPACE_DEVICE_QUOTA_EXCEEDED');
    }

    const result = await this.sessions.exchangePairing({ deviceId: input.deviceId, pairCode: `${input.workspaceId}:${input.pairingChallenge}` });
    const now = Date.now();
    this.workspaces.putDevice({
      id: input.deviceId,
      workspaceId: input.workspaceId,
      userId: this.ownerUserId,
      name: input.deviceName?.trim() || input.deviceId,
      platform: input.platform ?? 'unknown',
      kind: input.platform === 'web' ? 'web' : 'mobile',
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    });
    const usage = this.workspaces.getUsage(input.workspaceId);
    this.workspaces.setUsage(input.workspaceId, { ...usage, devices: this.workspaces.listDevices(input.workspaceId).filter(device => !device.revokedAt).length });
    this.workspaces.appendAudit({ workspaceId: input.workspaceId, actorUserId: this.ownerUserId, actorDeviceId: input.deviceId, action: existing ? 'device.session_pair' : 'device.register', targetType: 'device', targetId: input.deviceId, metadata: { platform: input.platform ?? 'unknown' } });
    this.pairing.revoke();
    return result;
  }

  async createTrustedWebSession(input:{deviceId:string;deviceName?:string}) {
    const pairing=this.pairing.issue();
    return this.exchange({workspaceId:this.workspaceId,pairingChallenge:pairing.challenge,deviceId:input.deviceId,deviceName:input.deviceName||'PhotoX Web',platform:'web'});
  }

  refresh(refreshToken: string) { return this.sessions.refresh(refreshToken); }
  async revoke(sessionId: string) {
    const row = this.store.db.prepare('SELECT workspace_id FROM photox_refresh_sessions WHERE session_id=?').get(sessionId) as { workspace_id?: string | null } | undefined;
    if (!row || row.workspace_id !== this.workspaceId) throw new Error('SESSION_NOT_FOUND');
    return this.sessions.revoke(sessionId);
  }
  listDevices(actor: DeviceSessionActor) { return this.deviceSessions.listDevices(actor); }
  listSessions(actor: DeviceSessionActor) { return this.deviceSessions.listSessions(actor); }
  revokeSession(actor: DeviceSessionActor, sessionId: string) { return this.deviceSessions.revokeSession(actor, sessionId); }
  revokeDevice(actor: DeviceSessionActor, deviceId: string) { return this.deviceSessions.revokeDevice(actor, deviceId); }

  private async validatePrincipal(token:string,required:MediaApiScope[]){
    const principal=await this.authorization.authorize(token,required,this.workspaceId);
    if (!principal.workspaceId) throw new Error('WORKSPACE_SCOPE_REQUIRED');
    const membership = this.workspaces.getMembership(principal.workspaceId, principal.subject);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');
    const device = principal.deviceId ? this.workspaces.listDevices(principal.workspaceId).find(item => item.id === principal.deviceId) : undefined;
    if (principal.deviceId && (!device || device.revokedAt)) throw new Error('DEVICE_REVOKED');
    if (device) this.workspaces.putDevice({ ...device, lastSeenAt: Date.now() });
    return principal;
  }

  authorizeToken(token:string,required:MediaApiScope[]){return this.validatePrincipal(token,required);}

  async authorizeRequest(req: IncomingMessage, required: MediaApiScope[]) {
    const token=bearerToken(typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined);
    if(!token)throw new Error('AUTH_REQUIRED');
    return this.validatePrincipal(token,required);
  }
}

export function workspaceRoleCanDelete(role?: WorkspaceRole | WorkspaceSessionRole) {
  return role === 'owner' || role === 'admin' || role === 'member';
}
