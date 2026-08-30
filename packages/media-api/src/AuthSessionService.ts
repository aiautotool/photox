import type { AccessTokenIssuer, MediaApiScope, RefreshSessionStore } from './auth';

export interface PairingCredentialVerifier {
  verify(input: { deviceId: string; pairCode: string }): Promise<{ subject: string; scopes?: MediaApiScope[] }>;
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
    const refresh = await this.refreshSessions.create({ subject: verified.subject, deviceId: input.deviceId, scopes, expiresAt: refreshExpiresAt });
    const access = await this.issuer.issue({ subject: verified.subject, deviceId: input.deviceId, sessionId: refresh.sessionId, scopes }, this.accessTtlSeconds);
    return { accessToken: access.token, accessExpiresAt: access.expiresAt, refreshToken: refresh.refreshToken, refreshExpiresAt, sessionId: refresh.sessionId };
  }

  async refresh(refreshToken: string) {
    const session = await this.refreshSessions.consume(refreshToken);
    if (!session) throw new Error('REFRESH_TOKEN_INVALID');
    const access = await this.issuer.issue({ subject: session.subject, deviceId: session.deviceId, sessionId: session.sessionId, scopes: session.scopes }, this.accessTtlSeconds);
    return { accessToken: access.token, accessExpiresAt: access.expiresAt, sessionId: session.sessionId };
  }

  revoke(sessionId: string) { return this.refreshSessions.revoke(sessionId); }
}
