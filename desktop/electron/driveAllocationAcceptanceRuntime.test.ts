import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import { DriveAllocationAcceptanceRuntime } from './driveAllocationAcceptanceRuntime.js';
import type { SavedDriveAccountRecord } from './driveAccountPolicyStore.js';

const GiB=1024**3;

function account(overrides:Partial<SavedDriveAccountRecord>={}):SavedDriveAccountRecord {
  return {
    id:'drive-test',
    workspaceId:'workspace-test',
    email:'owner@example.test',
    tokens:{refresh_token:'secret-not-for-ledger'},
    ...overrides,
  };
}

test('production acceptance runtime persists and projects authoritative Drive quota verification',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'photox-drive-acceptance-runtime-'));
  try {
    const runtime=new DriveAllocationAcceptanceRuntime(dir);
    const observation=await runtime.observeBestEffort({
      account:account(),
      email:'owner@example.test',
      quota:{limit:120*GiB,usage:20*GiB},
      appUsedBytes:5*GiB,
    });
    assert.ok(observation);
    assert.equal(observation.computed.allocationLimitBytes,80*GiB);
    assert.ok(observation.computed.allocationLimitBytes>10*GiB);

    const status=await runtime.latestStatus('drive-test');
    assert.equal(status.status,'verified');
    assert.equal(status.authoritativeTotalBytes,120*GiB);
    assert.equal(status.allocationRatio,2/3);
    assert.equal(status.allocationLimitBytes,80*GiB);
    assert.deepEqual(status.blockers,[]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('production acceptance runtime fails telemetry closed without throwing into quota refresh caller',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'photox-drive-acceptance-runtime-'));
  try {
    const runtime=new DriveAllocationAcceptanceRuntime(dir);
    const observation=await runtime.observeBestEffort({
      account:account(),
      email:'owner@example.test',
      quota:{limit:0,usage:0},
      appUsedBytes:0,
    });
    assert.equal(observation,undefined);
    assert.deepEqual(await runtime.latestStatus('drive-test'),{
      status:'not_verified',
      source:'google-drive-about.storageQuota',
      blockers:['LIVE_DRIVE_ALLOCATION_ACCEPTANCE_NOT_OBSERVED'],
    });
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('custom ratio and provider remaining bytes remain authoritative in runtime acceptance',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'photox-drive-acceptance-runtime-'));
  try {
    const runtime=new DriveAllocationAcceptanceRuntime(dir);
    const observation=await runtime.observeBestEffort({
      account:account({maxUsageRatio:0.9,safetyReserveBytes:2*GiB}),
      email:'owner@example.test',
      quota:{limit:100*GiB,usage:96*GiB},
      appUsedBytes:10*GiB,
    });
    assert.ok(observation);
    assert.equal(observation.computed.allocationLimitBytes,90*GiB);
    assert.equal(observation.computed.providerRemainingAfterReserveBytes,2*GiB);
    assert.equal(observation.computed.availableBytes,2*GiB);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
