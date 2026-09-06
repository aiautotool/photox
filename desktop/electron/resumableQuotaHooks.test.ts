import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceResumableQuotaHooks } from './resumableQuotaHooks.js';

type Reservation={id:string;workspaceId:string;deviceId:string;assetId:string;bytes:number;state:'reserved'|'committed'|'released';mediaKey?:string;releaseReason?:string};

function repoFixture() {
  const reservations=new Map<string,Reservation>();
  const calls={create:[] as any[],commit:[] as any[],release:[] as any[]};
  return {
    reservations,
    calls,
    repo:{
      getWorkspace:(workspaceId:string)=>workspaceId==='ws-a'?{plan:'personal' as const}:null,
      getMediaReservation:(workspaceId:string,reservationId:string)=>{
        const item=reservations.get(reservationId);return item?.workspaceId===workspaceId?item:null;
      },
      createMediaReservation:(input:any)=>{
        calls.create.push(input);
        const item:Reservation={id:'reservation-a',workspaceId:input.workspaceId,deviceId:input.deviceId,assetId:input.assetId,bytes:input.bytes,state:'reserved'};
        reservations.set(item.id,item);return item;
      },
      commitMediaReservation:(workspaceId:string,reservationId:string,key:string)=>{
        calls.commit.push([workspaceId,reservationId,key]);
        const item=reservations.get(reservationId)!;item.state='committed';item.mediaKey=key;return item;
      },
      releaseMediaReservationById:(workspaceId:string,reservationId:string,reason:string)=>{
        calls.release.push([workspaceId,reservationId,reason]);
        const item=reservations.get(reservationId)!;item.state='released';item.releaseReason=reason;return item;
      },
    },
  };
}

test('resumable quota hooks derive workspace plan limits and persist reservation binding',async()=>{
  const fx=repoFixture();const hooks=createWorkspaceResumableQuotaHooks(fx.repo);
  const result=await hooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
  assert.deepEqual(result,{reservationId:'reservation-a'});
  assert.equal(fx.calls.create.length,1);
  assert.equal(fx.calls.create[0].workspaceId,'ws-a');
  assert.equal(fx.calls.create[0].deviceId,'phone-a');
  assert.equal(fx.calls.create[0].assetId,'asset-a');
  assert.equal(fx.calls.create[0].bytes,123);
  assert.equal(typeof fx.calls.create[0].limits,'object');
  assert.ok('maxManagedStorageBytes' in fx.calls.create[0].limits);
  assert.ok('maxMonthlyIngressBytes' in fx.calls.create[0].limits);
});

test('resumable quota hooks fail closed when a different device tries to own the reservation',async()=>{
  const fx=repoFixture();const hooks=createWorkspaceResumableQuotaHooks(fx.repo);
  const reserved=await hooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
  await assert.rejects(()=>hooks.commit({principal:{workspaceId:'ws-a',deviceId:'phone-b'},reservationId:reserved.reservationId,expectedBytes:123,key:'phone-a:asset-a'}),/MEDIA_RESERVATION_DEVICE_MISMATCH/);
  assert.equal(fx.calls.commit.length,0);
});

test('resumable quota hooks fail closed on expected-size drift before commit or release',async()=>{
  const fx=repoFixture();const hooks=createWorkspaceResumableQuotaHooks(fx.repo);
  const reserved=await hooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
  await assert.rejects(()=>hooks.commit({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:reserved.reservationId,expectedBytes:122,key:'phone-a:asset-a'}),/MEDIA_RESERVATION_SIZE_MISMATCH/);
  await assert.rejects(()=>hooks.release({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:reserved.reservationId,expectedBytes:124,reason:'expired'}),/MEDIA_RESERVATION_SIZE_MISMATCH/);
});

test('resumable quota hooks route commit and release through the durable repository record',async()=>{
  const firstFx=repoFixture();const firstHooks=createWorkspaceResumableQuotaHooks(firstFx.repo);
  const first=await firstHooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
  await firstHooks.commit({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:first.reservationId,expectedBytes:123,key:'phone-a:asset-a'});
  assert.deepEqual(firstFx.calls.commit,[['ws-a','reservation-a','phone-a:asset-a']]);

  const secondFx=repoFixture();const secondHooks=createWorkspaceResumableQuotaHooks(secondFx.repo);
  const second=await secondHooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
  await secondHooks.release({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:second.reservationId,expectedBytes:123,reason:'expired'});
  assert.deepEqual(secondFx.calls.release,[['ws-a','reservation-a','expired']]);
});
