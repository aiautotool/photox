import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { loadPairedDesktop } from './pairing';
import { loadDevicePhotos, pingLaptop, syncAssetsToLaptop } from './mobileSync';
import { isFailedAssetRetryDue, loadFailedAssets, loadFailedRetryState, loadSyncedAssetIds } from './syncLedger';

const TASK = 'photosync-background-sync-v1';

export async function runPairedSync() {
  const target = await loadPairedDesktop();
  if (!target) return false;
  await pingLaptop(target);
  const assets = await loadDevicePhotos(300);
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
