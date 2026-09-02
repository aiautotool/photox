import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';

export type TunnelIdentity = {
  desktopId: string;
  pairToken: string;
  hostSecret: string;
};

export type TunnelState = {
  connected: boolean;
  relayUrl: string;
  desktopId: string;
  pairingPayload: string;
  lastError?: string;
};

export type TunnelPairingContext = { workspaceId:string; workspaceRole:'owner'|'admin'|'member'|'viewer'; desktopDeviceId:string; challenge:string; challengeExpiresAt:number; capabilities:string[] };

type Options = {
  stateDir: string;
  relayUrl: string;
  getPairingContext?: () => Promise<TunnelPairingContext>;
  onUploadReady: (uploadId: string, identity: TunnelIdentity, relayUrl: string) => Promise<void>;
  onState?: (state: TunnelState) => void;
};

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function websocketUrl(relayUrl: string, identity: TunnelIdentity) {
  const url = new URL('/api/v1/tunnel', relayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('desktopId', identity.desktopId);
  url.searchParams.set('hostSecret', identity.hostSecret);
  return url.toString();
}

export class PhotoSyncTunnelClient {
  private ws: WebSocket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private stopped = false;
  private identity: TunnelIdentity | null = null;
  private state: TunnelState | null = null;

  constructor(private readonly options: Options) {}

  private identityPath() {
    return path.join(this.options.stateDir, 'tunnel-identity.json');
  }

  async getIdentity(): Promise<TunnelIdentity> {
    if (this.identity) return this.identity;
    await fs.mkdir(this.options.stateDir, { recursive: true });
    try {
      this.identity = JSON.parse(await fs.readFile(this.identityPath(), 'utf8')) as TunnelIdentity;
    } catch {
      this.identity = {
        desktopId: `desk_${crypto.randomUUID()}`,
        pairToken: randomToken(32),
        hostSecret: randomToken(48),
      };
      await fs.writeFile(this.identityPath(), JSON.stringify(this.identity, null, 2), { mode: 0o600 });
    }
    return this.identity;
  }

  private async pairingPayload(identity: TunnelIdentity) {
    const context = await this.options.getPairingContext?.();
    return JSON.stringify(context ? {
      v: 2, relayUrl: this.options.relayUrl, desktopId: identity.desktopId, pairToken: identity.pairToken,
      workspaceId: context.workspaceId, workspaceRole: context.workspaceRole, desktopDeviceId: context.desktopDeviceId,
      pairingChallenge: context.challenge, challengeExpiresAt: context.challengeExpiresAt, capabilities: context.capabilities,
    } : { v: 1, relayUrl: this.options.relayUrl, desktopId: identity.desktopId, pairToken: identity.pairToken });
  }

  async getState(): Promise<TunnelState> {
    const identity = await this.getIdentity();
    const payload = await this.pairingPayload(identity);
    return this.state ?? {
      connected: false,
      relayUrl: this.options.relayUrl,
      desktopId: identity.desktopId,
      pairingPayload: payload,
    };
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.ws?.close();
    this.ws = null;
  }

  private async publish(connected: boolean, lastError?: string) {
    const identity = await this.getIdentity();
    this.state = {
      connected,
      relayUrl: this.options.relayUrl,
      desktopId: identity.desktopId,
      pairingPayload: await this.pairingPayload(identity),
      lastError,
    };
    this.options.onState?.(this.state);
  }

  private async connect() {
    if (this.stopped) return;
    const identity = await this.getIdentity();
    const ws = new WebSocket(websocketUrl(this.options.relayUrl, identity));
    this.ws = ws;

    ws.on('open', () => void this.publish(true));
    ws.on('message', raw => {
      try {
        const message = JSON.parse(String(raw));
        if (message?.type === 'upload.ready' && message.upload?.id) {
          void this.options.onUploadReady(String(message.upload.id), identity, this.options.relayUrl);
        }
      } catch (error) {
        console.error('PhotoSync tunnel message error', error);
      }
    });
    ws.on('error', error => void this.publish(false, error.message));
    ws.on('close', () => {
      void this.publish(false);
      if (!this.stopped) this.retry = setTimeout(() => void this.connect(), 2500);
    });
  }
}
