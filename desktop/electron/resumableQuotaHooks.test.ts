import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceResumableQuotaHooks } from './resumableQuotaHooks.js';

function repoFixture() {
  const reservations=new Map<string,any>();
  return {
    getWorkspace:vi.fn((workspaceId:string)=>workspaceId==='ws-a'?{id:'ws-a',plan:'personal'}:null),
    getMediaReservation:vi.fn((workspaceId:string,reservationId:string)=>{
      const item=reservations.get(reservationId);return item?.workspaceId===workspaceId?item:null;
    }),
    createMediaReservation:vi.fn((input:any)=>{
      const item={id:'reservation-a',workspaceId:input.workspaceId,deviceId:input.deviceId,assetId:input.assetId,bytes:input.bytes,state:'reserved'};
      reservations.set(item.id,item);return item;
    }),
    commitMediaReservation:vi.fn((workspaceId:string,reservationId:string,key:string)=>{
      const item=reservations.get(reservationId);item.state='committed';item.mediaKey=key;return item;
    }),
    releaseMediaReservationById:vi.fn((workspaceId:string,reservationId:string,reason:string)=>{
      const item=reservations.get(reservationId);item.state='released';item.releaseReason=reason;return item;
    }),
  };
}

describe('createWorkspaceResumableQuotaHooks',()=>{
  it('derives workspace plan limits and persists reservation binding',async()=>{
    const repo=repoFixture();const hooks=createWorkspaceResumableQuotaHooks(repo as any);
    await expect(hooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'})).resolves.toEqual({reservationId:'reservation-a'});
    expect(repo.createMediaReservation).toHaveBeenCalledWith(expect.objectContaining({workspaceId:'ws-a',deviceId:'phone-a',assetId:'asset-a',bytes:123,limits:expect.objectContaining({maxManagedStorageBytes:expect.anything(),maxMonthlyIngressBytes:expect.anything()})}));
  });

  it('fails closed when a different device tries to own the reservation',async()=>{
    const repo=repoFixture();const hooks=createWorkspaceResumableQuotaHooks(repo as any);
    const reserved=await hooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
    await expect(hooks.commit({principal:{workspaceId:'ws-a',deviceId:'phone-b'},reservationId:reserved.reservationId,expectedBytes:123,key:'phone-a:asset-a'})).rejects.toThrow('MEDIA_RESERVATION_DEVICE_MISMATCH');
    expect(repo.commitMediaReservation).not.toHaveBeenCalled();
  });

  it('fails closed on expected-size drift before commit or release',async()=>{
    const repo=repoFixture();const hooks=createWorkspaceResumableQuotaHooks(repo as any);
    const reserved=await hooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
    await expect(hooks.commit({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:reserved.reservationId,expectedBytes:122,key:'phone-a:asset-a'})).rejects.toThrow('MEDIA_RESERVATION_SIZE_MISMATCH');
    await expect(hooks.release({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:reserved.reservationId,expectedBytes:124,reason:'expired'})).rejects.toThrow('MEDIA_RESERVATION_SIZE_MISMATCH');
  });

  it('routes commit and release through the durable repository record',async()=>{
    const repo=repoFixture();const hooks=createWorkspaceResumableQuotaHooks(repo as any);
    const first=await hooks.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
    await hooks.commit({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:first.reservationId,expectedBytes:123,key:'phone-a:asset-a'});
    expect(repo.commitMediaReservation).toHaveBeenCalledWith('ws-a','reservation-a','phone-a:asset-a');

    const repo2=repoFixture();const hooks2=createWorkspaceResumableQuotaHooks(repo2 as any);
    const second=await hooks2.reserve({principal:{workspaceId:'ws-a',deviceId:'phone-a'},expectedBytes:123,assetId:'asset-a'});
    await hooks2.release({principal:{workspaceId:'ws-a',deviceId:'phone-a'},reservationId:second.reservationId,expectedBytes:123,reason:'expired'});
    expect(repo2.releaseMediaReservationById).toHaveBeenCalledWith('ws-a','reservation-a','expired');
  });
});
