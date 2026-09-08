import type {
  GooglePhotosMigrationItem,
  GooglePhotosMigrationJob,
  GooglePhotosMigrationLedger,
} from '@photosync/google-photos';

export type GooglePhotosMigrationAcceptanceStatus = {
  status: 'verified' | 'not_verified';
  sourceMode: 'picker_selected_only';
  targetMode: 'append_only_google_photos' | 'google_drive';
  blockers: string[];
  totalItems: number;
  completedItems: number;
  failedItems: number;
  verifiedTargetItems: number;
  durableProgress: boolean;
};

function targetMode(job: GooglePhotosMigrationJob): GooglePhotosMigrationAcceptanceStatus['targetMode'] {
  return job.target === 'google_photos' ? 'append_only_google_photos' : 'google_drive';
}

function validateProgress(job: GooglePhotosMigrationJob, items: GooglePhotosMigrationItem[]): string[] {
  const blockers: string[] = [];
  if (!job.sourcePickerSessionId) blockers.push('PICKER_SESSION_NOT_RECORDED');
  if (job.totalItems !== items.length) blockers.push('DURABLE_TOTAL_ITEMS_MISMATCH');
  const completed = items.filter(item => item.state === 'completed').length;
  const failed = items.filter(item => item.state === 'failed').length;
  if (job.completedItems !== completed) blockers.push('DURABLE_COMPLETED_ITEMS_MISMATCH');
  if (job.failedItems !== failed) blockers.push('DURABLE_FAILED_ITEMS_MISMATCH');
  if (job.transferredBytes < 0 || items.some(item => item.transferredBytes < 0)) blockers.push('DURABLE_PROGRESS_INVALID');
  if (items.some(item => item.state === 'completed' && !item.targetId)) blockers.push('COMPLETED_ITEM_TARGET_NOT_VERIFIED');
  if (job.target === 'google_photos' && job.sourceAccountId === job.targetAccountId) blockers.push('GOOGLE_PHOTOS_SOURCE_TARGET_SAME_ACCOUNT');
  return blockers;
}

export async function googlePhotosMigrationAcceptance(
  ledger: GooglePhotosMigrationLedger,
  input: { workspaceId: string; jobId: string },
): Promise<GooglePhotosMigrationAcceptanceStatus> {
  const job = await ledger.getJob(input.jobId);
  if (!job || job.workspaceId !== input.workspaceId) {
    return {
      status: 'not_verified',
      sourceMode: 'picker_selected_only',
      targetMode: 'google_drive',
      blockers: ['MIGRATION_JOB_NOT_FOUND_OR_WORKSPACE_MISMATCH'],
      totalItems: 0,
      completedItems: 0,
      failedItems: 0,
      verifiedTargetItems: 0,
      durableProgress: false,
    };
  }

  const items = await ledger.listItems(job.id);
  const blockers = validateProgress(job, items);
  const completedItems = items.filter(item => item.state === 'completed').length;
  const failedItems = items.filter(item => item.state === 'failed').length;
  const verifiedTargetItems = items.filter(item => item.state === 'completed' && Boolean(item.targetId)).length;

  return {
    status: blockers.length ? 'not_verified' : 'verified',
    sourceMode: 'picker_selected_only',
    targetMode: targetMode(job),
    blockers,
    totalItems: items.length,
    completedItems,
    failedItems,
    verifiedTargetItems,
    durableProgress: blockers.every(blocker => !blocker.startsWith('DURABLE_')),
  };
}
