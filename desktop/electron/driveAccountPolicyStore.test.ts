import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES, DEFAULT_PROVIDER_USAGE_RATIO } from '@photosync/core';
import { driveAllocationPolicyOf, loadWorkspaceDriveAccounts, updateWorkspaceDriveAllocationPolicy } from './driveAccountPolicyStore.js';

async function tempDir(){return fs.mkdtemp(path.join(os.tmpdir(),'photox-drive-policy-'));}

test('defaults remain 2/3 ratio with safe reserve',()=>{
  const policy=driveAllocationPolicyOf({id:'a',tokens:{refresh_token:'secret'}});
  assert.equal(policy.maxUsageRatio,DEFAULT_PROVIDER_USAGE_RATIO);
  assert.equal(policy.safetyReserveBytes,DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES);
});

test('persists policy, preserves tokens, and survives reload',async()=>{
  const dir=await tempDir();
  await fs.writeFile(path.join(dir,'drive-a.json'),JSON.stringify({id:'drive-a',workspaceId:'ws-a',email:'a@example.com',tokens:{refresh_token:'secret-a'}}));
  const next=await updateWorkspaceDriveAllocationPolicy({directory:dir,workspaceId:'ws-a',legacyWorkspaceId:'legacy',accountId:'drive-a',patch:{maxUsageRatio:.5,safetyReserveBytes:256*1024*1024}});
  assert.equal(next.maxUsageRatio,.5);
  assert.equal(next.safetyReserveBytes,256*1024*1024);
  const saved=JSON.parse(await fs.readFile(path.join(dir,'drive-a.json'),'utf8'));
  assert.equal(saved.tokens.refresh_token,'secret-a');
  const reloaded=await loadWorkspaceDriveAccounts(dir,'ws-a','legacy');
  assert.equal(reloaded[0]?.maxUsageRatio,.5);
  assert.equal(reloaded[0]?.safetyReserveBytes,256*1024*1024);
});

test('workspace isolation prevents cross-tenant mutation',async()=>{
  const dir=await tempDir();
  await fs.writeFile(path.join(dir,'drive-b.json'),JSON.stringify({id:'drive-b',workspaceId:'ws-b',tokens:{refresh_token:'secret-b'}}));
  await assert.rejects(()=>updateWorkspaceDriveAllocationPolicy({directory:dir,workspaceId:'ws-a',legacyWorkspaceId:'legacy',accountId:'drive-b',patch:{maxUsageRatio:.4}}),/DRIVE_ACCOUNT_NOT_FOUND/);
});

test('legacy account is adopted only into configured legacy workspace and values clamp safely',async()=>{
  const dir=await tempDir();
  await fs.writeFile(path.join(dir,'legacy.json'),JSON.stringify({id:'legacy',tokens:{refresh_token:'legacy-secret'}}));
  const legacy=await loadWorkspaceDriveAccounts(dir,'legacy-ws','legacy-ws');
  assert.equal(legacy.length,1);
  const foreign=await loadWorkspaceDriveAccounts(dir,'other-ws','legacy-ws');
  assert.equal(foreign.length,0);
  const policy=await updateWorkspaceDriveAllocationPolicy({directory:dir,workspaceId:'legacy-ws',legacyWorkspaceId:'legacy-ws',accountId:'legacy',patch:{maxUsageRatio:9,safetyReserveBytes:-3}});
  assert.equal(policy.maxUsageRatio,1);
  assert.equal(policy.safetyReserveBytes,0);
});
