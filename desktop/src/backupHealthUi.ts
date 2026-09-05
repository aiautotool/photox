import type { BackupHealthSnapshot, CloudUpload, DesktopBridge, LocalMedia } from './bridge.js';

export type BackupReplicaView = {
  state: CloudUpload['state'];
  accountId?: string;
  accountEmail?: string;
  message?: string;
  webViewLink?: string;
};

export type BackupProblemView = BackupHealthSnapshot['problems'][number] & {
  localAvailable: boolean;
  verifiedReplicas: number;
  pendingReplicas: number;
  failedReplicas: number;
  targetReplicas: number;
  canRepair: boolean;
  replicas: BackupReplicaView[];
};

const VERIFIED = new Set<CloudUpload['state']>(['VERIFIED', 'UPLOADED']);
const PENDING = new Set<CloudUpload['state']>(['QUEUED', 'UPLOADING', 'VERIFYING', 'BLOCKED']);

export function buildBackupProblemViews(
  health: BackupHealthSnapshot,
  uploads: CloudUpload[],
  media: LocalMedia[],
  targetReplicas = 2,
): BackupProblemView[] {
  const uploadsByKey = new Map<string, CloudUpload[]>();
  for (const upload of uploads) {
    const list = uploadsByKey.get(upload.key) || [];
    list.push(upload);
    uploadsByKey.set(upload.key, list);
  }
  const localByKey = new Map(media.map(item => [item.key, item.localAvailable]));

  return health.problems.map(problem => {
    const itemUploads = uploadsByKey.get(problem.key) || [];
    const verifiedAccountIds = new Set(
      itemUploads
        .filter(upload => VERIFIED.has(upload.state))
        .map(upload => upload.accountId || `unknown:${upload.remoteFileId || upload.state}`),
    );
    const verifiedReplicas = verifiedAccountIds.size;
    const pendingReplicas = itemUploads.filter(upload => PENDING.has(upload.state)).length;
    const failedReplicas = itemUploads.filter(upload => upload.state === 'ERROR').length;
    const localAvailable = localByKey.get(problem.key) === true;

    return {
      ...problem,
      localAvailable,
      verifiedReplicas,
      pendingReplicas,
      failedReplicas,
      targetReplicas,
      canRepair: localAvailable && verifiedReplicas < targetReplicas,
      replicas: itemUploads.map(upload => ({
        state: upload.state,
        accountId: upload.accountId,
        accountEmail: upload.accountEmail,
        message: upload.message,
        webViewLink: upload.webViewLink,
      })),
    };
  });
}

export function backupReplicaStatusLabel(state: CloudUpload['state']) {
  if (VERIFIED.has(state)) return 'Đã xác minh';
  if (state === 'ERROR') return 'Lỗi';
  if (state === 'UPLOADING' || state === 'VERIFYING') return 'Đang xử lý';
  return 'Đang chờ';
}

export async function repairBackupProblem(
  bridge: Pick<DesktopBridge, 'repairMedia'>,
  key: string,
) {
  const normalizedKey = key.trim();
  if (!normalizedKey) throw new Error('MEDIA_KEY_REQUIRED');
  return bridge.repairMedia(normalizedKey);
}
