import assert from 'node:assert/strict';
import test from 'node:test';
import { allocationPercentFromRatio, buildDriveAllocationMutation, defaultDriveAllocationMutation, reserveMiBFromBytes } from './driveAllocationUi.js';

test('formats the production 2/3 default without inventing a fixed capacity',()=>{
  assert.equal(allocationPercentFromRatio(2/3),66.67);
  assert.equal(reserveMiBFromBytes(100*1024*1024),100);
  assert.deepEqual(defaultDriveAllocationMutation(),{maxUsageRatio:2/3,safetyReserveBytes:100*1024*1024});
});

test('builds a precise per-account mutation from UI values',()=>{
  assert.deepEqual(buildDriveAllocationMutation({allocationPercent:75,safetyReserveMiB:512}),{maxUsageRatio:.75,safetyReserveBytes:512*1024*1024});
});

test('accepts zero allocation and zero reserve',()=>{
  assert.deepEqual(buildDriveAllocationMutation({allocationPercent:0,safetyReserveMiB:0}),{maxUsageRatio:0,safetyReserveBytes:0});
});

test('rejects invalid ratios and reserves before transport',()=>{
  assert.throws(()=>buildDriveAllocationMutation({allocationPercent:101,safetyReserveMiB:100}),/0–100/);
  assert.throws(()=>buildDriveAllocationMutation({allocationPercent:-1,safetyReserveMiB:100}),/0–100/);
  assert.throws(()=>buildDriveAllocationMutation({allocationPercent:66.67,safetyReserveMiB:-1}),/không được âm/);
  assert.throws(()=>buildDriveAllocationMutation({allocationPercent:Number.NaN,safetyReserveMiB:100}),/0–100/);
});
