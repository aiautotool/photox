import type { MediaDTO, MediaListQuery, MediaPage } from '@photox/media-api';
import type { Transport, TransportRequest } from '@photox/transport';

export interface MobileAuthSession {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken?: string;
  sessionId?: string;
}

export interface MobileAuthSessionStore {
  get(): Promise<MobileAuthSession | null>;
  save(session: MobileAuthSession): Promise<void>;
  clear(): Promise<void>;
}

export interface MediaApiAuthAdapter {
  refresh(refreshToken: string): Promise<{ accessToken: string; accessExpiresAt: number; sessionId?: string }>;
}

export class MediaApiClient {
  constructor(
    private readonly transport: Transport,
    private readonly sessions: MobileAuthSessionStore,
    private readonly auth?: MediaApiAuthAdapter,
    private readonly refreshSkewSeconds = 30,
  ) {}

  async list(query: MediaListQuery = {}): Promise<MediaPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<MediaPage>({ path: `/api/v1/media${suffix}` });
  }

  detail(assetId: string): Promise<MediaDTO> {
    return this.request<MediaDTO>({ path: `/api/v1/media/${encodeURIComponent(assetId)}` });
  }

  replicas<T = unknown>(assetId: string): Promise<T> {
    return this.request<T>({ path: `/api/v1/media/${encodeURIComponent(assetId)}/replicas` });
  }

  contentPath(assetId: string, variant: 'content' | 'thumbnail' | 'preview' = 'content'): string {
    return `/api/v1/media/${encodeURIComponent(assetId)}/${variant}`;
  }

  async authorizationHeader(): Promise<Record<string, string>> {
    const session = await this.ensureAccessToken();
    return session ? { authorization: `Bearer ${session.accessToken}` } : {};
  }

  private async request<T>(request: TransportRequest, retried = false): Promise<T> {
    const session = await this.ensureAccessToken();
    const response = await this.transport.request<T>({
      ...request,
      headers: {
        ...(request.headers ?? {}),
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      },
    });
    if (response.status === 401 && !retried && session?.refreshToken && this.auth) {
      await this.refresh(session);
      return this.request<T>(request, true);
    }
    if (response.status >= 400) throw new Error(`MEDIA_API_HTTP_${response.status}`);
    return response.data;
  }

  private async ensureAccessToken(): Promise<MobileAuthSession | null> {
    const session = await this.sessions.get();
    if (!session) return null;
    const now = Math.floor(Date.now() / 1000);
    if (session.accessExpiresAt > now + this.refreshSkewSeconds) return session;
    if (!session.refreshToken || !this.auth) return session;
    return this.refresh(session);
  }

  private async refresh(session: MobileAuthSession): Promise<MobileAuthSession> {
    if (!session.refreshToken || !this.auth) throw new Error('REFRESH_NOT_AVAILABLE');
    const refreshed = await this.auth.refresh(session.refreshToken);
    const next: MobileAuthSession = {
      ...session,
      accessToken: refreshed.accessToken,
      accessExpiresAt: refreshed.accessExpiresAt,
      sessionId: refreshed.sessionId ?? session.sessionId,
    };
    await this.sessions.save(next);
    return next;
  }
}

export class MemoryMobileAuthSessionStore implements MobileAuthSessionStore {
  private session: MobileAuthSession | null = null;
  async get() { return this.session ? { ...this.session } : null; }
  async save(session: MobileAuthSession) { this.session = { ...session }; }
  async clear() { this.session = null; }
}
