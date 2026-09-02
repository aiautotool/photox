import * as SecureStore from 'expo-secure-store';

export type PairedDesktop = {
  v: 1|2;
  relayUrl: string;
  publicUrl?: string;
  desktopId: string;
  pairToken: string;
  deviceId: string;
  receiverUrl?: string;
  pairCode?: string;
  workspaceId?: string;
  workspaceRole?: 'owner'|'admin'|'member'|'viewer';
  desktopDeviceId?: string;
  pairingChallenge?: string;
  challengeExpiresAt?: number;
  capabilities?: string[];
  accessToken?: string;
  accessExpiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
  sessionId?: string;
};

const KEY = 'photosync.paired-desktop.v1';

function normalizeRelayUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Relay URL không hợp lệ');
  return url.toString().replace(/\/$/, '');
}

function newDeviceId() {
  return `phone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function authBaseCandidates(target: PairedDesktop) {
  const values = [target.receiverUrl, target.publicUrl].filter((value): value is string => Boolean(value));
  return [...new Set(values.map(value => value.replace(/\/$/, '')))];
}

async function persist(target: PairedDesktop) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(target), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${response.status}:${await response.text().catch(() => '')}`);
  return response.json() as Promise<T>;
}

export function parsePairingQr(raw: string): Omit<PairedDesktop, 'deviceId'> {
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error('QR không phải PhotoSync pairing QR'); }
  if (![1,2].includes(parsed?.v) || !parsed?.relayUrl || !parsed?.desktopId || !parsed?.pairToken) throw new Error('QR PhotoSync không hợp lệ');
  if (parsed.v===2 && (!parsed.workspaceId || !parsed.pairingChallenge || !Number.isFinite(Number(parsed.challengeExpiresAt)))) throw new Error('QR PhotoSync v2 thiếu workspace challenge');
  const receiverUrl = parsed.receiverUrl ? normalizeRelayUrl(String(parsed.receiverUrl)) : undefined;
  const publicUrl = parsed.publicUrl ? normalizeRelayUrl(String(parsed.publicUrl)) : undefined;
  const pairCode = parsed.pairCode ? String(parsed.pairCode) : undefined;
  if ((receiverUrl && !pairCode) || (!receiverUrl && pairCode)) throw new Error('QR PhotoSync thiếu thông tin kết nối LAN');
  return {
    v: parsed.v === 2 ? 2 : 1,
    relayUrl: normalizeRelayUrl(String(parsed.relayUrl)),
    publicUrl,
    desktopId: String(parsed.desktopId),
    pairToken: String(parsed.pairToken),
    receiverUrl,
    pairCode,
    workspaceId: parsed.workspaceId ? String(parsed.workspaceId) : undefined,
    workspaceRole: parsed.workspaceRole,
    desktopDeviceId: parsed.desktopDeviceId ? String(parsed.desktopDeviceId) : undefined,
    pairingChallenge: parsed.pairingChallenge ? String(parsed.pairingChallenge) : undefined,
    challengeExpiresAt: parsed.challengeExpiresAt ? Number(parsed.challengeExpiresAt) : undefined,
    capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.map(String) : undefined,
  };
}

export async function exchangeWorkspaceSession(target: PairedDesktop): Promise<PairedDesktop> {
  if (target.v !== 2 || !target.workspaceId || !target.pairingChallenge) return target;
  let lastError: unknown;
  for (const base of authBaseCandidates(target)) {
    try {
      const session = await postJson<{
        accessToken:string; accessExpiresAt:number; refreshToken:string; refreshExpiresAt:number; sessionId:string;
        workspaceId?:string; workspaceRole?:PairedDesktop['workspaceRole'];
      }>(`${base}/api/v1/auth/pair`, {
        workspaceId: target.workspaceId,
        pairingChallenge: target.pairingChallenge,
        deviceId: target.deviceId,
        deviceName: target.deviceId,
        platform: 'unknown',
      });
      const next: PairedDesktop = {
        ...target,
        workspaceId: session.workspaceId || target.workspaceId,
        workspaceRole: session.workspaceRole || target.workspaceRole,
        accessToken: session.accessToken,
        accessExpiresAt: session.accessExpiresAt,
        refreshToken: session.refreshToken,
        refreshExpiresAt: session.refreshExpiresAt,
        sessionId: session.sessionId,
        pairingChallenge: undefined,
        challengeExpiresAt: undefined,
      };
      await persist(next);
      Object.assign(target, next);
      return target;
    } catch (error) { lastError = error; }
  }
  throw new Error(`Không tạo được phiên PhotoX workspace: ${lastError instanceof Error ? lastError.message : String(lastError || '')}`);
}

export async function ensureWorkspaceAccess(target: PairedDesktop): Promise<PairedDesktop> {
  if (target.v !== 2) return target;
  if (target.accessToken && target.accessExpiresAt && target.accessExpiresAt * 1000 > Date.now() + 60_000) return target;
  if (!target.refreshToken || !target.refreshExpiresAt || target.refreshExpiresAt * 1000 <= Date.now()) {
    if (target.pairingChallenge) return exchangeWorkspaceSession(target);
    throw new Error('Phiên PhotoX đã hết hạn. Hãy quét lại QR trên máy tính.');
  }
  let lastError: unknown;
  for (const base of authBaseCandidates(target)) {
    try {
      const session = await postJson<{ accessToken:string; accessExpiresAt:number; sessionId:string; workspaceId?:string; workspaceRole?:PairedDesktop['workspaceRole'] }>(`${base}/api/v1/auth/refresh`, { refreshToken: target.refreshToken });
      const next = { ...target, accessToken: session.accessToken, accessExpiresAt: session.accessExpiresAt, sessionId: session.sessionId, workspaceId: session.workspaceId || target.workspaceId, workspaceRole: session.workspaceRole || target.workspaceRole };
      await persist(next);
      Object.assign(target, next);
      return target;
    } catch (error) { lastError = error; }
  }
  throw new Error(`Không làm mới được phiên PhotoX: ${lastError instanceof Error ? lastError.message : String(lastError || '')}`);
}

export function accessHeaders(target: PairedDesktop): Record<string,string> {
  if (target.accessToken) return { authorization: `Bearer ${target.accessToken}`, ...(target.workspaceId ? { 'x-photosync-workspace-id': target.workspaceId } : {}) };
  if (target.pairingChallenge && target.workspaceId && (!target.challengeExpiresAt || target.challengeExpiresAt > Date.now())) return { 'x-photosync-pairing-challenge': target.pairingChallenge, 'x-photosync-workspace-id': target.workspaceId };
  return target.pairCode ? { 'x-photosync-pair-code': target.pairCode } : {};
}

export async function savePairedDesktop(rawQr: string): Promise<PairedDesktop> {
  const parsed = parsePairingQr(rawQr);
  const existing = await loadPairedDesktop();
  const target: PairedDesktop = {
    ...parsed,
    deviceId: existing?.deviceId || newDeviceId(),
  };
  await persist(target);
  if (target.v === 2) await exchangeWorkspaceSession(target);
  void import('./pushSync').then(m => m.registerPairingForPush(target)).catch(() => undefined);
  return target;
}

export async function loadPairedDesktop(): Promise<PairedDesktop | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as PairedDesktop; } catch { return null; }
}

export async function forgetPairedDesktop() {
  const target = await loadPairedDesktop();
  if (target?.sessionId && target.accessToken) {
    for (const base of authBaseCandidates(target)) {
      try {
        await fetch(`${base}/api/v1/auth/revoke`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${target.accessToken}` }, body: JSON.stringify({ sessionId: target.sessionId }) });
        break;
      } catch {}
    }
  }
  await SecureStore.deleteItemAsync(KEY);
}
