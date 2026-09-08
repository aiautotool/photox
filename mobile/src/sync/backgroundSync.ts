import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { loadBackupSettings } from './backupSettings';
import { loadPairedDesktop } from './pairing';
import { loadDevicePhotos, pingLaptop, syncAssetsToLaptop, type MediaAsset } from './mobileSync';
import { isFailedAssetRetryDue, loadFailedAssets, loadFailedRetryState, loadSyncedAssetIds } from './syncLedger';

const TASK = 'photosync-background-sync-v1';

export function assetEnabledForBackup(asset: Pick<MediaAsset, 'mediaType'>, settings: { backupPhotos: boolean; backupVideos: boolean }) {
  if (asset.mediaType === 'video') return settings.backupVideos;
  if (asset.mediaType === 'photo') return settings.backupPhotos;
  return false;
}

export async function runPairedSync() {
  const settings = await loadBackupSettings();
  if (!settings.enabled || (!settings.backupPhotos && !settings.backupVideos)) return true;

  const target = await loadPairedDesktop();
  if (!target) return false;
  await pingLaptop(target);
  const assets = (await loadDevicePhotos(300)).filter(asset => assetEnabledForBackup(asset, settings));
  if (!assets.length) return true;

  const [synced, failed, retryState] = await Promise.all([
    loadSyncedAssetIds(),
    loadFailedAssets(),
    loadFailedRetryState(),
  ]);
  const now = Date.now();
  const pending = assets.filter(asset => !synced.has(asset.id) && (!failed[asset.id] || isFailedAssetRetryDue(retryState[asset.id], now)));
  if (!pending.length) return true;
  const result = await syncAssetsToLaptop(target, pending);
  if (result.failed) throw new Error(`Background sync failed for ${result.failed} file(s): ${result.lastError || 'unknown error'}`);
  return true;
}

TaskManager.defineTask(TASK, async () => {
  try {
    await runPairedSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('PhotoSync background task failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
  return true;
}
