import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHOTO_POLICY,
  DEFAULT_PROVIDER_USAGE_RATIO,
  DEFAULT_VIDEO_POLICY,
  GIB,
  accountUsageLimit,
  chooseAccount,
  evaluateBackupHealth,
  safeAvailable,
  OneTimeTicketStore,
  type MediaReplica,
  type StorageAccount,
} from './index';

describe('storage policy', () => {
  it('limits PhotoX usage to two-thirds of provider total storage by default', () => {
    const a:StorageAccount={id:'1',email:'a@gmail.com',appUsedBytes:5*GIB,providerFreeBytes:20*GIB,providerTotalBytes:30*GIB};
    expect(DEFAULT_PROVIDER_USAGE_RATIO).toBeCloseTo(2/3);
    expect(accountUsageLimit(a)).toBe(20*GIB);
    expect(safeAvailable(a)).toBe(15*GIB);
  });

  it('uses the actual Google free bytes and keeps a safety reserve', () => {
    const a:StorageAccount={id:'1',email:'a@gmail.com',appUsedBytes:0,providerFreeBytes:200*1024**2,providerTotalBytes:30*GIB};
    expect(safeAvailable(a)).toBe(100*1024**2);
  });

  it('supports a per-account configurable ratio', () => {
    const a:StorageAccount={id:'1',email:'a@gmail.com',appUsedBytes:5*GIB,providerFreeBytes:20*GIB,providerTotalBytes:40*GIB,maxUsageRatio:.5};
    expect(accountUsageLimit(a)).toBe(20*GIB);
    expect(safeAvailable(a)).toBe(15*GIB);
  });

  it('moves a file to another account when the current account cannot fit it safely', () => {
    const accounts:StorageAccount[]=[
      {id:'1',email:'full@gmail.com',appUsedBytes:9.8*GIB,providerFreeBytes:.2*GIB,providerTotalBytes:15*GIB},
      {id:'2',email:'ready@gmail.com',appUsedBytes:2*GIB,providerFreeBytes:13*GIB,providerTotalBytes:30*GIB},
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


describe('one-time ticket store',()=>{
  it('consumes a valid ticket exactly once',()=>{
    const store=new OneTimeTicketStore<{id:string}>();
    store.put('ticket',{id:'session'},2000);
    expect(store.consume('ticket',1000)).toEqual({id:'session'});
    expect(store.consume('ticket',1000)).toBeUndefined();
  });
  it('rejects and removes expired tickets',()=>{
    const store=new OneTimeTicketStore<string>();
    store.put('expired','secret',1000);
    expect(store.consume('expired',1000)).toBeUndefined();
    expect(store.size).toBe(0);
  });
});
