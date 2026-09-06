import { entitlementsForPlan } from '@photosync/core';
import type { ResumableIngestPrincipal, ResumableQuotaReservationHooks } from './resumableMediaIngestLifecycle.js';

type WorkspaceQuotaReservation = {
  id:string;
  workspaceId:string;
  deviceId:string;
  assetId:string;
  bytes:number;
  state:'reserved'|'committed'|'released';
};

type WorkspaceQuotaRepository = {
  getWorkspace(workspaceId:string):{plan:Parameters<typeof entitlementsForPlan>[0]}|null;
  getMediaReservation(workspaceId:string,reservationId:string):WorkspaceQuotaReservation|null;
  createMediaReservation(input:{workspaceId:string;deviceId:string;assetId:string;bytes:number;limits:{maxManagedStorageBytes:number|null;maxMonthlyIngressBytes:number|null}}):WorkspaceQuotaReservation;
  commitMediaReservation(workspaceId:string,reservationId:string,key:string):unknown;
  releaseMediaReservationById(workspaceId:string,reservationId:string,reason:string):unknown;
};

function binding(repo: WorkspaceQuotaRepository, principal: ResumableIngestPrincipal, reservationId: string, expectedBytes: number) {
  const reservation=repo.getMediaReservation(principal.workspaceId,reservationId);
  if(!reservation)throw new Error('MEDIA_RESERVATION_NOT_FOUND');
  if(reservation.deviceId!==principal.deviceId)throw new Error('MEDIA_RESERVATION_DEVICE_MISMATCH');
  if(reservation.bytes!==expectedBytes)throw new Error('MEDIA_RESERVATION_SIZE_MISMATCH');
  return reservation;
}

export function createWorkspaceResumableQuotaHooks(repo: WorkspaceQuotaRepository): ResumableQuotaReservationHooks {
  return {
    async reserve({principal,expectedBytes,assetId}){
      const workspace=repo.getWorkspace(principal.workspaceId);
      if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
      const entitlements=entitlementsForPlan(workspace.plan);
      const reservation=repo.createMediaReservation({
        workspaceId:principal.workspaceId,
        deviceId:principal.deviceId,
        assetId,
        bytes:expectedBytes,
        limits:{
          maxManagedStorageBytes:entitlements.maxManagedStorageBytes,
          maxMonthlyIngressBytes:entitlements.maxMonthlyIngressBytes,
        },
      });
      return {reservationId:reservation.id};
    },
    async commit({principal,reservationId,expectedBytes,key}){
      const reservation=binding(repo,principal,reservationId,expectedBytes);
      if(reservation.state==='released')throw new Error('MEDIA_RESERVATION_ALREADY_RELEASED');
      repo.commitMediaReservation(principal.workspaceId,reservationId,key);
    },
    async release({principal,reservationId,expectedBytes,reason}){
      const reservation=binding(repo,principal,reservationId,expectedBytes);
      if(reservation.state==='committed')throw new Error('MEDIA_RESERVATION_ALREADY_COMMITTED');
      repo.releaseMediaReservationById(principal.workspaceId,reservationId,reason);
    },
  };
}
