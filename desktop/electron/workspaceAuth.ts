import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { WorkspaceRole } from '@photosync/core';
import { entitlementsForPlan } from '@photosync/core';
import { AuthSessionService, AuthorizationService, bearerToken, type MediaApiScope, type WorkspaceSessionRole } from '@photox/media-api';
import { JoseAccessTokenService } from '@photox/auth-jose';
import { SqliteRefreshSessionStore, type SqlitePhotoXStore, type SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import type { WorkspacePairingChallengeManager } from './pairingChallenge.js';

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
      kind: 'mobile',
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    });
    const usage = this.workspaces.getUsage(input.workspaceId);
    this.workspaces.setUsage(input.workspaceId, { ...usage, devices: this.workspaces.listDevices(input.workspaceId).filter(device => !device.revokedAt).length });
    this.workspaces.appendAudit({ workspaceId: input.workspaceId, actorUserId: this.ownerUserId, actorDeviceId: input.deviceId, action: existing ? 'device.session_pair' : 'device.register', targetType: 'device', targetId: input.deviceId, metadata: { platform: input.platform ?? 'unknown' } });
    this.pairing.revoke();
    return result;
  }

  refresh(refreshToken: string) { return this.sessions.refresh(refreshToken); }
  revoke(sessionId: string) { return this.sessions.revoke(sessionId); }

  async authorizeRequest(req: IncomingMessage, required: MediaApiScope[]) {
    const principal = await this.authorization.authorize(bearerToken(typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined), required, this.workspaceId);
    if (!principal.workspaceId) throw new Error('WORKSPACE_SCOPE_REQUIRED');
    const membership = this.workspaces.getMembership(principal.workspaceId, principal.subject);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');
    const device = principal.deviceId ? this.workspaces.listDevices(principal.workspaceId).find(item => item.id === principal.deviceId) : undefined;
    if (principal.deviceId && (!device || device.revokedAt)) throw new Error('DEVICE_REVOKED');
    if (device) this.workspaces.putDevice({ ...device, lastSeenAt: Date.now() });
    return principal;
  }
}

export function workspaceRoleCanDelete(role?: WorkspaceRole | WorkspaceSessionRole) {
  return role === 'owner' || role === 'admin' || role === 'member';
}
