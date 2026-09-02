import type { AccessTokenIssuer, MediaApiScope, RefreshSessionStore, WorkspaceSessionRole } from './auth';

export interface PairingCredentialVerifier {
  verify(input: { deviceId: string; pairCode: string }): Promise<{
    subject: string;
    workspaceId?: string;
    workspaceRole?: WorkspaceSessionRole;
    scopes?: MediaApiScope[];
  }>;
}

export class AuthSessionService {
  constructor(
    private readonly issuer: AccessTokenIssuer,
    private readonly refreshSessions: RefreshSessionStore,
    private readonly pairing: PairingCredentialVerifier,
    private readonly accessTtlSeconds = 15 * 60,
    private readonly refreshTtlSeconds = 30 * 24 * 60 * 60,
  ) {}

  async exchangePairing(input: { deviceId: string; pairCode: string }) {
    const verified = await this.pairing.verify(input);
    const scopes = verified.scopes ?? ['media:read', 'media:download', 'media:write', 'cloud:read'];
    const refreshExpiresAt = Math.floor(Date.now() / 1000) + this.refreshTtlSeconds;
    const refresh = await this.refreshSessions.create({
      subject: verified.subject,
      deviceId: input.deviceId,
      workspaceId: verified.workspaceId,
      workspaceRole: verified.workspaceRole,
      scopes,
      expiresAt: refreshExpiresAt,
    });
    const access = await this.issuer.issue({
      subject: verified.subject,
      deviceId: input.deviceId,
      sessionId: refresh.sessionId,
      workspaceId: verified.workspaceId,
      workspaceRole: verified.workspaceRole,
      scopes,
    }, this.accessTtlSeconds);
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: refresh.refreshToken,
      refreshExpiresAt,
      sessionId: refresh.sessionId,
      workspaceId: verified.workspaceId,
      workspaceRole: verified.workspaceRole,
    };
  }

  async refresh(refreshToken: string) {
    const session = await this.refreshSessions.consume(refreshToken);
    if (!session) throw new Error('REFRESH_TOKEN_INVALID');
    const access = await this.issuer.issue({
      subject: session.subject,
      deviceId: session.deviceId,
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      workspaceRole: session.workspaceRole,
      scopes: session.scopes,
    }, this.accessTtlSeconds);
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      workspaceRole: session.workspaceRole,
    };
  }

  revoke(sessionId: string) { return this.refreshSessions.revoke(sessionId); }
}
