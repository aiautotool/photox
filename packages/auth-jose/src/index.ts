import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AccessPrincipal, AccessTokenIssuer, AccessTokenVerifier, MediaApiScope } from '@photox/media-api';

export interface JoseAccessTokenOptions {
  secret: Uint8Array;
  issuer?: string;
  audience?: string;
  algorithm?: 'HS256' | 'HS384' | 'HS512';
}

export class JoseAccessTokenService implements AccessTokenIssuer, AccessTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly algorithm: 'HS256' | 'HS384' | 'HS512';

  constructor(private readonly options: JoseAccessTokenOptions) {
    if (options.secret.byteLength < 32) throw new Error('JWT secret must be at least 32 bytes');
    this.issuer = options.issuer ?? 'photox-desktop';
    this.audience = options.audience ?? 'photox-mobile';
    this.algorithm = options.algorithm ?? 'HS256';
  }

  async issue(principal: Omit<AccessPrincipal, 'issuedAt' | 'expiresAt'>, ttlSeconds: number): Promise<{ token: string; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + Math.max(1, Math.floor(ttlSeconds));
    const token = await new SignJWT({
      scopes: principal.scopes,
      did: principal.deviceId,
      sid: principal.sessionId,
      metadata: principal.metadata,
    })
      .setProtectedHeader({ alg: this.algorithm, typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setSubject(principal.subject)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .setJti(crypto.randomUUID())
      .sign(this.options.secret);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessPrincipal> {
    const { payload } = await jwtVerify(token, this.options.secret, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: [this.algorithm],
    });
    return this.toPrincipal(payload);
  }

  private toPrincipal(payload: JWTPayload): AccessPrincipal {
    if (!payload.sub) throw new Error('JWT_SUBJECT_REQUIRED');
    const scopes = Array.isArray(payload.scopes) ? payload.scopes.filter((value): value is MediaApiScope => typeof value === 'string') : [];
    return {
      subject: payload.sub,
      deviceId: typeof payload.did === 'string' ? payload.did : undefined,
      sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
      scopes,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? payload.metadata as Record<string, unknown> : undefined,
    };
  }
}
