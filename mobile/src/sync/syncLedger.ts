import * as FileSystem from 'expo-file-system/legacy';

const LEDGER = `${FileSystem.documentDirectory}photosync-synced-assets.json`;
const FAILED_LEDGER = `${FileSystem.documentDirectory}photosync-failed-assets.json`;
const RETRY_LEDGER = `${FileSystem.documentDirectory}photosync-failed-retry.json`;
const RETRY_BASE_DELAY_MS = 60_000;
const RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1_000;

export type FailedRetryState = {
  attempts: number;
  failedAt: number;
  retryAfter: number;
};

let cache: Set<string> | null = null;
let failedCache: Record<string, string> | null = null;
let retryCache: Record<string, FailedRetryState> | null = null;

function retryDelayMs(attempts: number) {
  const exponent = Math.max(0, Math.min(16, attempts - 1));
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** exponent);
}

function validRetryState(value: unknown): value is FailedRetryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<FailedRetryState>;
  return typeof item.attempts === 'number' && Number.isInteger(item.attempts) && item.attempts > 0
    && typeof item.failedAt === 'number' && Number.isFinite(item.failedAt)
    && typeof item.retryAfter === 'number' && Number.isFinite(item.retryAfter);
}

export function isFailedAssetRetryDue(state: FailedRetryState | undefined, now = Date.now()) {
  // Legacy failure ledgers did not have retry metadata. Treat them as immediately
  // retryable so a transient pre-upgrade failure cannot strand an asset forever.
  return !state || state.retryAfter <= now;
}

export async function loadSyncedAssetIds() {
  if (cache) return new Set(cache);
  try {
    const values = JSON.parse(await FileSystem.readAsStringAsync(LEDGER));
    cache = new Set(Array.isArray(values) ? values.filter(x => typeof x === 'string') : []);
  } catch { cache = new Set(); }
  return new Set(cache);
}

export async function markAssetSynced(assetId:string) {
  const values = await loadSyncedAssetIds();
  values.add(assetId);
  cache = values;
  await FileSystem.writeAsStringAsync(LEDGER, JSON.stringify([...values]));
}

export async function loadFailedAssets() {
  if (failedCache) return { ...failedCache };
  try {
    const values = JSON.parse(await FileSystem.readAsStringAsync(FAILED_LEDGER));
    failedCache = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  } catch { failedCache = {}; }
  return { ...failedCache };
}

export async function loadFailedRetryState() {
  if (retryCache) return { ...retryCache };
  try {
    const values = JSON.parse(await FileSystem.readAsStringAsync(RETRY_LEDGER));
    const parsed: Record<string, FailedRetryState> = {};
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      for (const [assetId, state] of Object.entries(values)) if (validRetryState(state)) parsed[assetId] = state;
    }
    retryCache = parsed;
  } catch { retryCache = {}; }
  return { ...retryCache };
}

export async function markAssetFailed(assetId:string, message:string) {
  const [values, retryValues] = await Promise.all([loadFailedAssets(), loadFailedRetryState()]);
  const now = Date.now();
  const attempts = (retryValues[assetId]?.attempts || 0) + 1;
  values[assetId] = message;
  retryValues[assetId] = { attempts, failedAt: now, retryAfter: now + retryDelayMs(attempts) };
  failedCache = values;
  retryCache = retryValues;
  await Promise.all([
    FileSystem.writeAsStringAsync(FAILED_LEDGER, JSON.stringify(values)),
    FileSystem.writeAsStringAsync(RETRY_LEDGER, JSON.stringify(retryValues)),
  ]);
}

export async function clearAssetFailed(assetId:string) {
  const [values, retryValues] = await Promise.all([loadFailedAssets(), loadFailedRetryState()]);
  const hadFailure = assetId in values;
  const hadRetry = assetId in retryValues;
  if (!hadFailure && !hadRetry) return;
  delete values[assetId];
  delete retryValues[assetId];
  failedCache = values;
  retryCache = retryValues;
  const writes: Promise<void>[] = [];
  if (hadFailure) writes.push(FileSystem.writeAsStringAsync(FAILED_LEDGER, JSON.stringify(values)));
  if (hadRetry) writes.push(FileSystem.writeAsStringAsync(RETRY_LEDGER, JSON.stringify(retryValues)));
  await Promise.all(writes);
}
