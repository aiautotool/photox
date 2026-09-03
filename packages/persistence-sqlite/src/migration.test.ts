import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteGooglePhotosMigrationLedger, SqlitePhotoXStore } from './index';

const cleanup: string[] = [];
afterEach(async () => { while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true }); });

describe('migration resumable checkpoint persistence', () => {
  it('survives store close/reopen without exposing the session URI in migration item snapshots', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'photox-migration-')); cleanup.push(dir); const dbPath = path.join(dir, 'migration.sqlite');
    let store = new SqlitePhotoXStore({ path: dbPath }); let ledger = new SqliteGooglePhotosMigrationLedger(store);
    const now='2026-09-03T00:00:00.000Z';
    await ledger.createJob({ id:'job',workspaceId:'ws',sourceAccountId:'src',target:'google_drive',targetAccountId:'drive',state:'queued',totalItems:1,completedItems:0,failedItems:0,transferredBytes:0,createdAt:now,updatedAt:now });
    await ledger.putItems([{id:'item',jobId:'job',sourceMediaId:'source',filename:'video.mp4',mimeType:'video/mp4',sizeBytes:16,state:'failed',attempts:1,transferredBytes:8,createdAt:now,updatedAt:now}]);
    const checkpoint={kind:'google_drive_resumable_v1' as const,accountId:'drive',sessionUri:'https://upload.example/secret-session',nextByte:8,totalBytes:16,updatedAt:now};
    await ledger.setTransferCheckpoint('item',checkpoint); store.close();
    store=new SqlitePhotoXStore({path:dbPath});ledger=new SqliteGooglePhotosMigrationLedger(store);
    expect(await ledger.getTransferCheckpoint('item')).toEqual(checkpoint);
    expect(JSON.stringify(await ledger.listItems('job'))).not.toContain('secret-session');
    await ledger.setTransferCheckpoint('item',null);expect(await ledger.getTransferCheckpoint('item')).toBeNull();store.close();
  });

  it('persists transfer rate and ETA across store reopen', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'photox-migration-telemetry-')); cleanup.push(dir); const dbPath = path.join(dir, 'migration.sqlite');
    const now='2026-09-03T00:00:00.000Z';
    let store = new SqlitePhotoXStore({ path: dbPath }); let ledger = new SqliteGooglePhotosMigrationLedger(store);
    await ledger.createJob({ id:'job-telemetry',workspaceId:'ws',sourceAccountId:'src',target:'google_drive',targetAccountId:'drive',state:'running',totalItems:2,completedItems:0,failedItems:0,totalBytes:1000,transferredBytes:250,transferRateBps:125,etaSeconds:6,createdAt:now,updatedAt:now });
    store.close();
    store=new SqlitePhotoXStore({ path: dbPath });ledger=new SqliteGooglePhotosMigrationLedger(store);
    const job=await ledger.getJob('job-telemetry');
    expect(job?.transferRateBps).toBe(125);
    expect(job?.etaSeconds).toBe(6);
    await ledger.updateJob('job-telemetry',{transferRateBps:200,etaSeconds:3,updatedAt:'2026-09-03T00:00:01.000Z'});
    expect((await ledger.getJob('job-telemetry'))?.transferRateBps).toBe(200);
    store.close();
  });
});
