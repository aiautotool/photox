export type MediaApiScope =
  | 'media:read'
  | 'media:download'
  | 'media:write'
  | 'media:delete'
  | 'cloud:read'
  | 'cloud:manage';

export interface AccessPrincipal {
  subject: string;
  deviceId?: string;
  sessionId?: string;
  scopes: MediaApiScope[];
  issuedAt?: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessPrincipal>;
}

export interface AccessTokenIssuer {
  issue(principal: Omit<AccessPrincipal, 'issuedAt' | 'expiresAt'>, ttlSeconds: number): Promise<{ token: string; expiresAt: number }>;
}

export interface RefreshSessionStore {
  create(input: { subject: string; deviceId?: string; scopes: MediaApiScope[]; expiresAt: number }): Promise<{ refreshToken: string; sessionId: string }>;
  consume(refreshToken: string): Promise<{ subject: string; deviceId?: string; scopes: MediaApiScope[]; sessionId: string } | null>;
  revoke(sessionId: string): Promise<void>;
}

export class AuthorizationService {
  constructor(private readonly verifier: AccessTokenVerifier) {}

  async authorize(token: string | undefined, required: MediaApiScope[]): Promise<AccessPrincipal> {
    if (!token) throw new Error('AUTH_REQUIRED');
    const principal = await this.verifier.verify(token);
    const now = Math.floor(Date.now() / 1000);
    if (principal.expiresAt !== undefined && principal.expiresAt <= now) throw new Error('TOKEN_EXPIRED');
    for (const scope of required) if (!principal.scopes.includes(scope)) throw new Error(`SCOPE_REQUIRED:${scope}`);
    return principal;
  }
}

export function bearerToken(header?: string): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
