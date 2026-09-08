import path from 'node:path';
import type { SavedDriveAccountRecord } from './driveAccountPolicyStore.js';
import {
  DriveAllocationAcceptanceLedger,
  LiveSafeDriveAllocationAcceptance,
  type DriveAllocationAcceptanceObservation,
} from './driveAllocationAcceptance.js';
import type { DriveQuotaInput } from './driveRuntimeAllocation.js';

export type DriveAllocationAcceptanceRuntimeStatus = {
  status: 'verified' | 'not_verified';
  observedAt?: string;
  source: 'google-drive-about.storageQuota';
  blockers: string[];
  authoritativeTotalBytes?: number;
  authoritativeRemainingBytes?: number;
  allocationRatio?: number;
  safetyReserveBytes?: number;
  allocationLimitBytes?: number;
  availableBytes?: number;
};

export class DriveAllocationAcceptanceRuntime {
  private readonly ledger: DriveAllocationAcceptanceLedger;

  constructor(stateDir:string) {
    this.ledger=new DriveAllocationAcceptanceLedger(path.join(stateDir,'drive-allocation-acceptance.json'));
  }

  async observeBestEffort(input:{
    account:SavedDriveAccountRecord;
    email:string;
    quota:DriveQuotaInput;
    appUsedBytes:number;
  }):Promise<DriveAllocationAcceptanceObservation|undefined> {
    const acceptance=new LiveSafeDriveAllocationAcceptance({
      ledger:this.ledger,
      refreshQuota:async()=>input.quota,
    });
    return acceptance.observeBestEffort(
      {account:input.account,email:input.email,appUsedBytes:input.appUsedBytes},
      error=>console.warn('Drive allocation acceptance not verified',input.account.id,error),
    );
  }

  async latestStatus(accountId:string):Promise<DriveAllocationAcceptanceRuntimeStatus> {
    const latest=await this.ledger.latest(accountId);
    return latest?projection(latest):{
      status:'not_verified',
      source:'google-drive-about.storageQuota',
      blockers:['LIVE_DRIVE_ALLOCATION_ACCEPTANCE_NOT_OBSERVED'],
    };
  }
}

export function projection(observation:DriveAllocationAcceptanceObservation):DriveAllocationAcceptanceRuntimeStatus {
  return {
    status:'verified',
    observedAt:observation.observedAt,
    source:observation.source,
    blockers:[],
    authoritativeTotalBytes:observation.authoritativeQuota.totalBytes,
    authoritativeRemainingBytes:observation.authoritativeQuota.remainingBytes,
    allocationRatio:observation.policy.allocationRatio,
    safetyReserveBytes:observation.policy.safetyReserveBytes,
    allocationLimitBytes:observation.computed.allocationLimitBytes,
    availableBytes:observation.computed.availableBytes,
  };
}
