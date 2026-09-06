import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaIngestCommitCoordinator} from './mediaIngestCommitCoordinator.js';

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}

test('same media identity serializes and second request becomes duplicate before commit side effects',async()=>{
  const coordinator=createMediaIngestCommitCoordinator();
  let exists=false;
  let commits=0;
  const entered=deferred();const continueFirst=deferred();
  const first=coordinator.run({workspaceId:'ws-a',key:'asset-1'},
    {exists:async()=>exists,commit:async()=>{commits+=1;entered.release();await continueFirst.promise;exists=true;return 'first'}});
  await entered.promise;
  const second=coordinator.run({workspaceId:'ws-a',key:'asset-1'},
    {exists:async()=>exists,commit:async()=>{commits+=1;return 'second'}});
  continueFirst.release();
  assert.deepEqual(await first,{status:'committed',value:'first'});
  assert.deepEqual(await second,{status:'duplicate'});
  assert.equal(commits,1);
  assert.equal(coordinator.pending(),0);
});

test('same key in different workspaces remains independent',async()=>{
  const coordinator=createMediaIngestCommitCoordinator();
  const enteredA=deferred();const enteredB=deferred();const continueBoth=deferred();
  const run=(workspaceId:string,entered:{release:()=>void})=>coordinator.run({workspaceId,key:'shared-key'},{exists:async()=>false,commit:async()=>{entered.release();await continueBoth.promise;return workspaceId}});
  const a=run('ws-a',enteredA);const b=run('ws-b',enteredB);
  await Promise.all([enteredA.promise,enteredB.promise]);
  assert.equal(coordinator.pending(),2);
  continueBoth.release();
  assert.deepEqual(await a,{status:'committed',value:'ws-a'});
  assert.deepEqual(await b,{status:'committed',value:'ws-b'});
});

test('failed commit releases identity for retry',async()=>{
  const coordinator=createMediaIngestCommitCoordinator();
  await assert.rejects(()=>coordinator.run({workspaceId:'ws-a',key:'asset-1'},{exists:async()=>false,commit:async()=>{throw new Error('disk full')}}),/disk full/);
  assert.equal(coordinator.pending(),0);
  const retry=await coordinator.run({workspaceId:'ws-a',key:'asset-1'},{exists:async()=>false,commit:async()=>42});
  assert.deepEqual(retry,{status:'committed',value:42});
});

test('invalid identity fails closed before dependencies execute',async()=>{
  const coordinator=createMediaIngestCommitCoordinator();let called=false;
  await assert.rejects(()=>coordinator.run({workspaceId:' ',key:'asset'},{exists:async()=>{called=true;return false},commit:async()=>1}),/MEDIA_INGEST_WORKSPACE_REQUIRED/);
  await assert.rejects(()=>coordinator.run({workspaceId:'ws',key:' '},{exists:async()=>{called=true;return false},commit:async()=>1}),/MEDIA_INGEST_KEY_REQUIRED/);
  assert.equal(called,false);
});
