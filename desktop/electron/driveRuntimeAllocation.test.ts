import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES, DEFAULT_PROVIDER_USAGE_RATIO } from '@photosync/core';
import { driveRuntimeAllocation, rendererDriveAllocationSnapshot } from './driveRuntimeAllocation.js';

const GIB=1024**3;

function account(overrides:Record<string,unknown>={}){
  return {id:'drive-1',workspaceId:'ws-1',email:'owner@example.com',tokens:{refresh_token:'secret'},...overrides};
}

test('runtime allocation applies persisted default 2/3 ratio and reserve',()=>{
  const result=driveRuntimeAllocation({account:account(),email:'owner@example.com',quota:{limit:30*GIB,usage:3*GIB},appUsedBytes:4*GIB});
  assert.equal(result.storage.maxUsageRatio,DEFAULT_PROVIDER_USAGE_RATIO);
  assert.equal(result.storage.safetyReserveBytes,DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES);
  assert.equal(result.snapshot.allocationLimitBytes,20*GIB);
  assert.equal(result.snapshot.ratioRemainingBytes,16*GIB);
  assert.equal(result.snapshot.providerFreeBytes,27*GIB);
  assert.equal(result.snapshot.availableBytes,16*GIB);
});

test('runtime allocation honors custom ratio and safety reserve',()=>{
  const result=driveRuntimeAllocation({account:account({maxUsageRatio:0.5,safetyReserveBytes:2*GIB}),email:'owner@example.com',quota:{limit:20*GIB,usage:15*GIB},appUsedBytes:3*GIB});
  assert.equal(result.snapshot.allocationRatio,0.5);
  assert.equal(result.snapshot.allocationLimitBytes,10*GIB);
  assert.equal(result.snapshot.safetyReserveBytes,2*GIB);
  assert.equal(result.snapshot.ratioRemainingBytes,7*GIB);
  assert.equal(result.snapshot.providerRemainingAfterReserveBytes,3*GIB);
  assert.equal(result.snapshot.availableBytes,3*GIB);
});

test('renderer snapshot excludes account credentials and provider secrets',()=>{
  const result=driveRuntimeAllocation({account:account({maxUsageRatio:0.75}),email:'owner@example.com',quota:{limit:8*GIB,usage:1*GIB},appUsedBytes:GIB});
  const exposed=rendererDriveAllocationSnapshot(result.snapshot) as Record<string,unknown>;
  assert.equal(exposed.allocationRatio,0.75);
  assert.equal('tokens' in exposed,false);
  assert.equal('workspaceId' in exposed,false);
  assert.equal('email' in exposed,false);
});

test('runtime allocation normalizes malformed quota counters fail closed',()=>{
  const result=driveRuntimeAllocation({account:account(),email:'owner@example.com',quota:{limit:Number.NaN,usage:Number.POSITIVE_INFINITY},appUsedBytes:-42});
  assert.equal(result.storage.providerTotalBytes,0);
  assert.equal(result.storage.providerFreeBytes,0);
  assert.equal(result.storage.appUsedBytes,0);
  assert.equal(result.snapshot.availableBytes,0);
});
