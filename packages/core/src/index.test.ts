import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHOTO_POLICY,
  DEFAULT_VIDEO_POLICY,
  GIB,
  chooseAccount,
  evaluateBackupHealth,
  safeAvailable,
  type MediaReplica,
  type StorageAccount,
} from './index';

describe('storage policy', () => {
  it('never lets app exceed 10 GiB', () => {
    const a:StorageAccount={id:'1',email:'a@gmail.com',appUsedBytes:9*GIB,providerFreeBytes:20*GIB};
    expect(safeAvailable(a)).toBe(1*GIB);
  });

  it('preserves a small provider safety reserve', () => {
    const a:StorageAccount={id:'1',email:'a@gmail.com',appUsedBytes:0,providerFreeBytes:200*1024**2};
    expect(safeAvailable(a)).toBe(100*1024**2);
  });

  it('moves a file to another account when current account cannot fit it safely', () => {
    const accounts:StorageAccount[]=[
      {id:'1',email:'full@gmail.com',appUsedBytes:9.8*GIB,providerFreeBytes:.2*GIB},
      {id:'2',email:'ready@gmail.com',appUsedBytes:2*GIB,providerFreeBytes:13*GIB},
    ];
    expect(chooseAccount(accounts, 1*GIB)?.id).toBe('2');
  });
});

describe('backup policy', () => {
  const local: MediaReplica = {
    providerId: 'local',
    providerType: 'local',
    replicaType: 'original',
    status: 'available',
  };
  const drive: MediaReplica = {
    providerId: 'drive-a',
    providerType: 'google_drive',
    replicaType: 'original',
    status: 'available',
    verifiedAt: Date.now(),
  };
  const youtube: MediaReplica = {
    providerId: 'youtube-a',
    providerType: 'youtube',
    replicaType: 'viewable',
    status: 'available',
  };

  it('marks a photo safe with a local and verified remote original', () => {
    expect(evaluateBackupHealth([local, drive], DEFAULT_PHOTO_POLICY)).toMatchObject({
      health: 'safe',
      originalCopies: 2,
      remoteOriginalCopies: 1,
    });
  });

  it('does not count a YouTube viewable copy as an original', () => {
    expect(evaluateBackupHealth([local, youtube], DEFAULT_VIDEO_POLICY)).toMatchObject({
      health: 'critical',
      originalCopies: 1,
      viewableCopies: 1,
    });
  });

  it('keeps video at risk when originals are safe but viewable backup is missing', () => {
    expect(evaluateBackupHealth([local, drive], DEFAULT_VIDEO_POLICY)).toMatchObject({
      health: 'at_risk',
      originalCopies: 2,
      viewableCopies: 0,
    });
  });

  it('returns unknown when no copy can currently be verified', () => {
    expect(evaluateBackupHealth([{ ...drive, status: 'unknown' }], DEFAULT_PHOTO_POLICY).health).toBe('unknown');
  });
});
