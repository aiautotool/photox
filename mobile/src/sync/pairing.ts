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
    v: 1,
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

export async function savePairedDesktop(rawQr: string): Promise<PairedDesktop> {
  const parsed = parsePairingQr(rawQr);
  const existing = await loadPairedDesktop();
  const target: PairedDesktop = {
    ...parsed,
    deviceId: existing?.deviceId || newDeviceId(),
  };
  await SecureStore.setItemAsync(KEY, JSON.stringify(target), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  void import('./pushSync').then(m => m.registerPairingForPush(target)).catch(() => undefined);
  return target;
}

export async function loadPairedDesktop(): Promise<PairedDesktop | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as PairedDesktop; } catch { return null; }
}

export async function forgetPairedDesktop() {
  await SecureStore.deleteItemAsync(KEY);
}
