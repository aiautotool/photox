import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { WorkspacePlanCode, WorkspaceRole } from '@photosync/core';
import { entitlementsForPlan } from '@photosync/core';
import { AuthSessionService, AuthorizationService, bearerToken, type MediaApiScope, type WorkspaceSessionRole } from '@photox/media-api';
import { JoseAccessTokenService } from '@photox/auth-jose';
import { SqliteRefreshSessionStore, type SqlitePhotoXStore, type SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import type { WorkspacePairingChallengeManager } from './pairingChallenge.js';
import { DeviceSessionManagementService, type DeviceSessionActor } from './deviceSessionManagement.js';
import { WorkspaceOverviewService } from './workspaceOverview.js';
import { WorkspaceSubscriptionService } from './workspaceSubscription.js';
import { parseStripeSubscriptionWebhook } from './billingWebhook.js';
import { BillingReconciliationService } from './billingReconciliation.js';
import { StripeBillingProviderAdapter, stripeBillingConfigFromEnv } from './stripeBillingProvider.js';

export type PairExchangeInput = {
  workspaceId: string;
  pairingChallenge: string;
  deviceId: string;
  deviceName?: string;
  platform?: 'ios'|'android'|'windows'|'macos'|'linux'|'web'|'unknown';
};

const PHOTOX_PLANS = new Set<WorkspacePlanCode>(['free', 'personal', 'pro', 'family', 'team']);
const SUBSCRIPTION_MAINTENANCE_INTERVAL_MS = 60_000;
const DEFAULT_BILLING_RECONCILIATION_INTERVAL_MS = 15 * 60_000;

function subscriptionPeriodEndTargetPlan(): WorkspacePlanCode {
  const configured = String(process.env.PHOTOX_BILLING_PERIOD_END_TARGET_PLAN || 'free').trim() as WorkspacePlanCode;
  if (!PHOTOX_PLANS.has(configured)) throw new Error('PHOTOX_BILLING_PERIOD_END_TARGET_PLAN_INVALID');
  return configured;
}

function billingReconciliationIntervalMs() {
  const raw = Number(process.env.PHOTOX_BILLING_RECONCILIATION_INTERVAL_MS || DEFAULT_BILLING_RECONCILIATION_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BILLING_RECONCILIATION_INTERVAL_MS;
  return Math.max(60_000, Math.min(24 * 60 * 60_000, Math.floor(raw)));
}

let activeDesktopWorkspaceAuth:DesktopWorkspaceAuth|null=null;
let workspaceAuthIpcRegistered=false;
export function requireActiveDesktopWorkspaceAuth(){if(!activeDesktopWorkspaceAuth)throw new Error('WORKSPACE_AUTH_NOT_READY');return activeDesktopWorkspaceAuth;}

export class DesktopWorkspaceAuth {
  private readonly tokenService: JoseAccessTokenService;
  private readonly sessions: AuthSessionService;
  private readonly authorization: AuthorizationService;
  private readonly deviceSessions: DeviceSessionManagementService;
  private readonly overview: WorkspaceOverviewService;
  private readonly subscriptions: WorkspaceSubscriptionService;
  private readonly billingReconciliation?: BillingReconciliationService;
  private readonly stripeBilling?: StripeBillingProviderAdapter;
  private subscriptionMaintenanceTimer?: ReturnType<typeof setInterval>;
  private billingReconciliationTimer?: ReturnType<typeof setInterval>;
  private billingReconciliationRunning = false;

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
    this.overview = new WorkspaceOverviewService(workspaces);
    this.subscriptions = new WorkspaceSubscriptionService(store, workspaces);
    const stripeConfig = stripeBillingConfigFromEnv();
    if (stripeConfig.secretKey) {
      this.stripeBilling = new StripeBillingProviderAdapter(stripeConfig);
      this.billingReconciliation = new BillingReconciliationService(store, workspaces, this.subscriptions);
    }
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
    const auth=new DesktopWorkspaceAuth(new Uint8Array(secret), input.store, input.workspaces, input.pairing, input.workspaceId, input.ownerUserId);
    activeDesktopWorkspaceAuth=auth;
    auth.runSubscriptionMaintenance();
    auth.startSubscriptionMaintenance();
    void auth.runBillingReconciliation();
    auth.startBillingReconciliation();
    if(process.versions.electron)await auth.registerElectronIpc();
    return auth;
  }

  private runSubscriptionMaintenance() {
    try {
      const result = this.subscriptions.runDueEndOfPeriodTransitions({ targetPlan: subscriptionPeriodEndTargetPlan() });
      if (result.applied > 0 || result.failed > 0) {
        console.info('PhotoX subscription maintenance', result);
      }
    } catch (error) {
      console.error('PhotoX subscription maintenance failed', error instanceof Error ? error.message : 'UNKNOWN_ERROR');
    }
  }

  private startSubscriptionMaintenance() {
    if (this.subscriptionMaintenanceTimer) return;
    this.subscriptionMaintenanceTimer = setInterval(() => this.runSubscriptionMaintenance(), SUBSCRIPTION_MAINTENANCE_INTERVAL_MS);
    this.subscriptionMaintenanceTimer.unref?.();
  }

  private async runBillingReconciliation() {
    if (!this.billingReconciliation || !this.stripeBilling || this.billingReconciliationRunning) return;
    const binding = this.store.db.prepare(`SELECT provider,provider_subscription_id
      FROM photox_workspace_subscriptions WHERE workspace_id=?`).get(this.workspaceId) as
      { provider?: string; provider_subscription_id?: string } | undefined;
    if (!binding || binding.provider !== this.stripeBilling.provider || !binding.provider_subscription_id) return;
    this.billingReconciliationRunning = true;
    try {
      const result = await this.billingReconciliation.reconcileSystem({
        workspaceId: this.workspaceId,
        provider: binding.provider,
        providerSubscriptionId: binding.provider_subscription_id,
      }, this.stripeBilling);
      if (result.applied) console.info('PhotoX billing reconciliation applied authoritative provider state');
    } catch (error) {
      console.error('PhotoX billing reconciliation failed', error instanceof Error ? error.message : 'UNKNOWN_ERROR');
    } finally {
      this.billingReconciliationRunning = false;
    }
  }

  private startBillingReconciliation() {
    if (!this.billingReconciliation || !this.stripeBilling || this.billingReconciliationTimer) return;
    this.billingReconciliationTimer = setInterval(() => void this.runBillingReconciliation(), billingReconciliationIntervalMs());
    this.billingReconciliationTimer.unref?.();
  }

  dispose() {
    if (this.subscriptionMaintenanceTimer) clearInterval(this.subscriptionMaintenanceTimer);
    if (this.billingReconciliationTimer) clearInterval(this.billingReconciliationTimer);
    this.subscriptionMaintenanceTimer = undefined;
    this.billingReconciliationTimer = undefined;
    if (activeDesktopWorkspaceAuth === this) activeDesktopWorkspaceAuth = null;
  }

  private trustedDesktopActor():DeviceSessionActor{
    const membership=this.workspaces.getMembership(this.workspaceId,this.ownerUserId);
    if(!membership||membership.status!=='active')throw new Error('MEMBERSHIP_INACTIVE');
    return {subject:this.ownerUserId,workspaceId:this.workspaceId,workspaceRole:membership.role};
  }

  private async registerElectronIpc(){
    if(workspaceAuthIpcRegistered)return;
    const {ipcMain}=await import('electron');
    ipcMain.handle('photosync:workspace-overview',()=>{const auth=requireActiveDesktopWorkspaceAuth();return auth.getWorkspaceOverview(auth.trustedDesktopActor());});
    ipcMain.handle('photosync:workspace-subscription',()=>{const auth=requireActiveDesktopWorkspaceAuth();return auth.getWorkspaceSubscription(auth.trustedDesktopActor());});
    ipcMain.handle('photosync:workspace-devices',()=>{const auth=requireActiveDesktopWorkspaceAuth();return auth.listDevices(auth.trustedDesktopActor());});
    ipcMain.handle('photosync:workspace-sessions',()=>{const auth=requireActiveDesktopWorkspaceAuth();return auth.listSessions(auth.trustedDesktopActor());});
    ipcMain.handle('photosync:workspace-session-revoke',(_event,sessionId:string)=>{const auth=requireActiveDesktopWorkspaceAuth();return auth.revokeSession(auth.trustedDesktopActor(),String(sessionId||''));});
    ipcMain.handle('photosync:workspace-device-revoke',(_event,deviceId:string)=>{const auth=requireActiveDesktopWorkspaceAuth();return auth.revokeDevice(auth.trustedDesktopActor(),String(deviceId||''));});
    workspaceAuthIpcRegistered=true;
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
  getWorkspaceOverview(actor: DeviceSessionActor) { return this.overview.snapshot(actor); }
  getWorkspaceSubscription(actor: DeviceSessionActor) { return this.subscriptions.snapshot(actor); }
  handleStripeWebhook(rawBody: Buffer, signatureHeader: string, now = Date.now()) {
    const state = parseStripeSubscriptionWebhook(rawBody, signatureHeader, process.env.PHOTOX_STRIPE_WEBHOOK_SECRET || '', now);
    return this.subscriptions.applyProviderState(state, now);
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
