import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES, DEFAULT_PROVIDER_USAGE_RATIO } from '@photosync/core';
import { driveAllocationHttpStatus, mergeDriveAllocationPolicy, parseDriveAllocationMutation } from './driveAllocationTransport.js';

test('accepts a bounded ratio and non-negative integer reserve',()=>{
  assert.deepEqual(parseDriveAllocationMutation({maxUsageRatio:2/3,safetyReserveBytes:250*1024**2}),{maxUsageRatio:2/3,safetyReserveBytes:250*1024**2});
});

test('rejects authoritative binding or unknown client fields',()=>{
  assert.throws(()=>parseDriveAllocationMutation({workspaceId:'other',maxUsageRatio:.5}),/DRIVE_ALLOCATION_FIELD_FORBIDDEN/);
  assert.throws(()=>parseDriveAllocationMutation({accountId:'drive-a',safetyReserveBytes:0}),/DRIVE_ALLOCATION_FIELD_FORBIDDEN/);
});

test('rejects empty, invalid, out-of-range and fractional reserve patches',()=>{
  assert.throws(()=>parseDriveAllocationMutation({}),/DRIVE_ALLOCATION_PATCH_EMPTY/);
  assert.throws(()=>parseDriveAllocationMutation({maxUsageRatio:1.01}),/DRIVE_ALLOCATION_RATIO_OUT_OF_RANGE/);
  assert.throws(()=>parseDriveAllocationMutation({maxUsageRatio:Number.NaN}),/DRIVE_ALLOCATION_RATIO_INVALID/);
  assert.throws(()=>parseDriveAllocationMutation({safetyReserveBytes:-1}),/DRIVE_ALLOCATION_RESERVE_OUT_OF_RANGE/);
  assert.throws(()=>parseDriveAllocationMutation({safetyReserveBytes:1.5}),/DRIVE_ALLOCATION_RESERVE_INVALID/);
});

test('merge preserves unspecified values and defaults to the production policy',()=>{
  assert.deepEqual(mergeDriveAllocationPolicy(undefined,{maxUsageRatio:.5}),{maxUsageRatio:.5,safetyReserveBytes:DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES});
  assert.deepEqual(mergeDriveAllocationPolicy({maxUsageRatio:.75,safetyReserveBytes:42},{safetyReserveBytes:0}),{maxUsageRatio:.75,safetyReserveBytes:0});
  assert.deepEqual(mergeDriveAllocationPolicy(undefined,{}),{maxUsageRatio:DEFAULT_PROVIDER_USAGE_RATIO,safetyReserveBytes:DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES});
});

test('HTTP mapping is stable and does not leak internal provider details',()=>{
  assert.equal(driveAllocationHttpStatus(new Error('DRIVE_ACCOUNT_NOT_FOUND')),404);
  assert.equal(driveAllocationHttpStatus(new Error('ROLE_FORBIDDEN')),403);
  assert.equal(driveAllocationHttpStatus(new Error('DRIVE_ALLOCATION_RATIO_INVALID')),400);
  assert.equal(driveAllocationHttpStatus(new Error('provider exploded with secret')),500);
});
