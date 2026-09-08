import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES } from '@photosync/core';
import { DriveAllocationAcceptanceLedger, LiveSafeDriveAllocationAcceptance } from './driveAllocationAcceptance.js';

const GIB=1024**3;
const account=(overrides:Record<string,unknown>={})=>({id:'drive-safe',workspaceId:'ws-1',email:'owner@example.com',tokens:{access_token:'access-secret',refresh_token:'refresh-secret'},...overrides});

async function fixture(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'photox-drive-acceptance-'));
  const file=path.join(dir,'observations.json');
  return {dir,file,ledger:new DriveAllocationAcceptanceLedger(file)};
}

test('live-safe acceptance independently proves default 2/3 allocation above legacy 10 GiB caps',async()=>{
  const f=await fixture();
  try{
    let quotaReads=0;
    const harness=new LiveSafeDriveAllocationAcceptance({ledger:f.ledger,refreshQuota:async()=>{quotaReads+=1;return {limit:120*GIB,usage:20*GIB}},now:()=>new Date('2026-09-08T12:00:00.000Z')});
    const observation=await harness.observe({account:account(),email:'owner@example.com',appUsedBytes:5*GIB});
    assert.equal(quotaReads,1);
    assert.equal(observation.policy.allocationRatio,2/3);
    assert.equal(observation.computed.allocationLimitBytes,80*GIB);
    assert.ok(observation.computed.allocationLimitBytes>10*GIB);
    assert.equal(observation.computed.providerRemainingAfterReserveBytes,100*GIB-DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES);
    assert.equal(observation.computed.availableBytes,75*GIB);
    assert.deepEqual(await f.ledger.latest('drive-safe'),observation);
  }finally{await rm(f.dir,{recursive:true,force:true})}
});

test('live-safe acceptance respects custom ratio, provider remaining bytes and safety reserve',async()=>{
  const f=await fixture();
  try{
    const harness=new LiveSafeDriveAllocationAcceptance({ledger:f.ledger,refreshQuota:async()=>({limit:100*GIB,usage:96*GIB})});
    const observation=await harness.observe({account:account({maxUsageRatio:0.9,safetyReserveBytes:2*GIB}),email:'owner@example.com',appUsedBytes:GIB});
    assert.equal(observation.computed.allocationLimitBytes,90*GIB);
    assert.equal(observation.authoritativeQuota.remainingBytes,4*GIB);
    assert.equal(observation.computed.providerRemainingAfterReserveBytes,2*GIB);
    assert.equal(observation.computed.availableBytes,2*GIB);
  }finally{await rm(f.dir,{recursive:true,force:true})}
});

test('acceptance provider contract exposes quota read only and persists no credential material',async()=>{
  const f=await fixture();
  try{
    const calls:string[]=[];
    const provider={refreshQuota:async()=>{calls.push('about.storageQuota');return {limit:30*GIB,usage:3*GIB}}};
    const harness=new LiveSafeDriveAllocationAcceptance({ledger:f.ledger,refreshQuota:provider.refreshQuota});
    await harness.observe({account:account(),email:'owner@example.com',appUsedBytes:4*GIB});
    assert.deepEqual(calls,['about.storageQuota']);
    const persisted=await readFile(f.file,'utf8');
    assert.equal(persisted.includes('access-secret'),false);
    assert.equal(persisted.includes('refresh-secret'),false);
    assert.equal(persisted.includes('owner@example.com'),false);
    assert.equal(persisted.includes('ws-1'),false);
  }finally{await rm(f.dir,{recursive:true,force:true})}
});

test('malformed authoritative quota fails closed without accepted observation',async()=>{
  const f=await fixture();
  try{
    const harness=new LiveSafeDriveAllocationAcceptance({ledger:f.ledger,refreshQuota:async()=>({limit:0,usage:0})});
    await assert.rejects(()=>harness.observe({account:account(),email:'owner@example.com',appUsedBytes:0}),/AUTHORITATIVE_GOOGLE_DRIVE_QUOTA_UNAVAILABLE/);
    assert.deepEqual(await f.ledger.load(),[]);
  }finally{await rm(f.dir,{recursive:true,force:true})}
});

test('corrupt durable ledger fails closed and is replaced only by a fresh verified observation',async()=>{
  const f=await fixture();
  try{
    await writeFile(f.file,'{not-json','utf8');
    assert.deepEqual(await f.ledger.load(),[]);
    const harness=new LiveSafeDriveAllocationAcceptance({ledger:f.ledger,refreshQuota:async()=>({limit:30*GIB,usage:3*GIB})});
    const observation=await harness.observe({account:account(),email:'owner@example.com',appUsedBytes:4*GIB});
    assert.equal((await f.ledger.load()).length,1);
    assert.equal((await f.ledger.latest('drive-safe'))?.observedAt,observation.observedAt);
  }finally{await rm(f.dir,{recursive:true,force:true})}
});

test('best-effort production boundary isolates acceptance failures from quota refresh callers',async()=>{
  const f=await fixture();
  try{
    const errors:unknown[]=[];
    const harness=new LiveSafeDriveAllocationAcceptance({ledger:f.ledger,refreshQuota:async()=>({limit:0,usage:0})});
    const result=await harness.observeBestEffort({account:account(),email:'owner@example.com',appUsedBytes:0},error=>errors.push(error));
    assert.equal(result,undefined);
    assert.equal(errors.length,1);
    assert.match(String(errors[0]),/AUTHORITATIVE_GOOGLE_DRIVE_QUOTA_UNAVAILABLE/);
    assert.deepEqual(await f.ledger.load(),[]);
  }finally{await rm(f.dir,{recursive:true,force:true})}
});

test('best-effort production boundary still persists a verified observation when authority is healthy',async()=>{
  const f=await fixture();
  try{
    const harness=new LiveSafeDriveAllocationAcceptance({ledger:f.ledger,refreshQuota:async()=>({limit:60*GIB,usage:10*GIB}),now:()=>new Date('2026-09-08T13:00:00.000Z')});
    const result=await harness.observeBestEffort({account:account(),email:'owner@example.com',appUsedBytes:2*GIB});
    assert.ok(result);
    assert.equal(result?.computed.allocationLimitBytes,40*GIB);
    assert.equal(result?.computed.availableBytes,38*GIB);
    assert.deepEqual(await f.ledger.latest('drive-safe'),result);
  }finally{await rm(f.dir,{recursive:true,force:true})}
});
