import * as FileSystem from 'expo-file-system/legacy';

export interface BackupSettings {
  enabled: boolean;
  backupPhotos: boolean;
  backupVideos: boolean;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  backupPhotos: true,
  backupVideos: true,
};

const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
const SETTINGS_PATH = root ? `${root}photox-backup-settings.json` : null;
const TEMP_PATH = root ? `${root}photox-backup-settings.tmp.json` : null;
let writeQueue: Promise<void> = Promise.resolve();

function normalize(value: unknown): BackupSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_BACKUP_SETTINGS };
  const raw = value as Partial<BackupSettings>;
  return {
    enabled: raw.enabled !== false,
    backupPhotos: raw.backupPhotos !== false,
    backupVideos: raw.backupVideos !== false,
  };
}

export async function loadBackupSettings(): Promise<BackupSettings> {
  if (!SETTINGS_PATH) return { ...DEFAULT_BACKUP_SETTINGS };
  try {
    const info = await FileSystem.getInfoAsync(SETTINGS_PATH);
    if (!info.exists) return { ...DEFAULT_BACKUP_SETTINGS };
    return normalize(JSON.parse(await FileSystem.readAsStringAsync(SETTINGS_PATH)));
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}

export function saveBackupSettings(settings: BackupSettings): Promise<void> {
  const normalized = normalize(settings);
  writeQueue = writeQueue.then(async () => {
    if (!SETTINGS_PATH || !TEMP_PATH) return;
    await FileSystem.writeAsStringAsync(TEMP_PATH, JSON.stringify(normalized), { encoding: FileSystem.EncodingType.UTF8 });
    await FileSystem.deleteAsync(SETTINGS_PATH, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: TEMP_PATH, to: SETTINGS_PATH });
  });
  return writeQueue;
}
