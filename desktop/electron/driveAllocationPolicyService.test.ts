import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES, DEFAULT_PROVIDER_USAGE_RATIO } from '@photosync/core';
import { DriveAllocationPolicyService, type DriveAllocationPolicyServiceAuditEvent } from './driveAllocationPolicyService.js';
import { driveAllocationPolicyOf, loadWorkspaceDriveAccounts } from './driveAccountPolicyStore.js';
import type { RendererDriveAccountInfo } from './driveRuntimeAllocation.js';

function accountInfo(input:{id:string;ratio:number;reserve:number}):RendererDriveAccountInfo{
  return {
    id:input.id,email:`${input.id}@example.com`,usedBytes:10,freeBytes:90,totalBytes:100,status:'ready',
    allocation:{providerTotalBytes:100,providerFreeBytes:90,providerUsedBytes:10,allocationRatio:input.ratio,allocationLimitBytes:Math.floor(100*input.ratio),safetyReserveBytes:input.reserve,appUsedBytes:0,ratioRemainingBytes:Math.floor(100*input.ratio),providerRemainingAfterReserveBytes:Math.max(0,90-input.reserve),availableBytes:Math.max(0,Math.min(Math.floor(100*input.ratio),90-input.reserve))}
  };
}

async function fixture(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'photox-drive-policy-service-'));
  await fs.writeFile(path.join(directory,'drive-a.json'),JSON.stringify({id:'drive-a',workspaceId:'ws-a',email:'a@example.com',tokens:{refresh_token:'secret'}}));
  await fs.writeFile(path.join(directory,'drive-b.json'),JSON.stringify({id:'drive-b',workspaceId:'ws-b',email:'b@example.com',tokens:{refresh_token:'other-secret'}}));
  const audits:DriveAllocationPolicyServiceAuditEvent[]=[];
  const service=new DriveAllocationPolicyService({
    directory,legacyWorkspaceId:'legacy',appendAudit:event=>{audits.push(event)},
    listAccounts:async workspaceId=>{
      const accounts=await loadWorkspaceDriveAccounts(directory,workspaceId,'legacy');
      return accounts.map(account=>{const policy=driveAllocationPolicyOf(account);return accountInfo({id:account.id,ratio:policy.maxUsageRatio,reserve:policy.safetyReserveBytes})});
    },
  });
  return {directory,audits,service};
}

const owner={workspaceId:'ws-a',userId:'owner-a',deviceId:'desktop-a',role:'owner' as const};

test('lists only accounts inside actor workspace',async()=>{
  const {service}=await fixture();
  const accounts=await service.list({...owner,role:'viewer'});
  assert.deepEqual(accounts.map(item=>item.id),['drive-a']);
});

test('owner can persist ratio and reserve then receive refreshed safe projection',async()=>{
  const {service,directory,audits}=await fixture();
  const updated=await service.update(owner,'drive-a',{maxUsageRatio:.5,safetyReserveBytes:7});
  assert.equal(updated.allocation.allocationRatio,.5);
  assert.equal(updated.allocation.safetyReserveBytes,7);
  const [persisted]=await loadWorkspaceDriveAccounts(directory,'ws-a','legacy');
  assert.equal(persisted.maxUsageRatio,.5);
  assert.equal(persisted.safetyReserveBytes,7);
  assert.equal((persisted.tokens as {refresh_token:string}).refresh_token,'secret');
  assert.deepEqual(audits,[{workspaceId:'ws-a',actorUserId:'owner-a',actorDeviceId:'desktop-a',action:'provider.google_drive.allocation_policy.update',targetType:'google_drive',targetId:'drive-a',metadata:{maxUsageRatio:.5,safetyReserveBytes:7}}]);
});

test('partial update preserves production defaults for untouched fields',async()=>{
  const {service}=await fixture();
  const updated=await service.update(owner,'drive-a',{maxUsageRatio:.75});
  assert.equal(updated.allocation.allocationRatio,.75);
  assert.equal(updated.allocation.safetyReserveBytes,DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES);
  assert.notEqual(DEFAULT_PROVIDER_USAGE_RATIO,1);
});

test('member and viewer cannot mutate policy',async()=>{
  const {service}=await fixture();
  await assert.rejects(()=>service.update({...owner,role:'member'},'drive-a',{maxUsageRatio:.4}),/DRIVE_ALLOCATION_ROLE_FORBIDDEN/);
  await assert.rejects(()=>service.update({...owner,role:'viewer'},'drive-a',{safetyReserveBytes:1}),/DRIVE_ALLOCATION_ROLE_FORBIDDEN/);
});

test('workspace isolation fails closed for foreign account ids',async()=>{
  const {service}=await fixture();
  await assert.rejects(()=>service.update(owner,'drive-b',{maxUsageRatio:.4}),/DRIVE_ACCOUNT_NOT_FOUND/);
});

test('transport parser rejects client supplied binding fields before persistence',async()=>{
  const {service}=await fixture();
  await assert.rejects(()=>service.update(owner,'drive-a',{workspaceId:'ws-b',maxUsageRatio:.4}),/DRIVE_ALLOCATION_FIELD_FORBIDDEN/);
});
