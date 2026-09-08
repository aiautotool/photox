import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedDriveAccountRecord } from './driveAccountPolicyStore.js';
import { driveRuntimeAllocation, type DriveQuotaInput } from './driveRuntimeAllocation.js';

export type DriveAllocationAcceptanceObservation = {
  version: 1;
  accountId: string;
  observedAt: string;
  source: 'google-drive-about.storageQuota';
  authoritativeQuota: {
    totalBytes: number;
    usedBytes: number;
    remainingBytes: number;
  };
  policy: {
    allocationRatio: number;
    safetyReserveBytes: number;
  };
  appUsedBytes: number;
  computed: {
    allocationLimitBytes: number;
    ratioRemainingBytes: number;
    providerRemainingAfterReserveBytes: number;
    availableBytes: number;
  };
  status: 'verified';
  blockers: [];
};

type Ledger = { version: 1; observations: DriveAllocationAcceptanceObservation[] };

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validObservation(value: unknown): value is DriveAllocationAcceptanceObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input=value as Record<string,unknown>;
  const quota=input.authoritativeQuota as Record<string,unknown>|undefined;
  const policy=input.policy as Record<string,unknown>|undefined;
  const computed=input.computed as Record<string,unknown>|undefined;
  if (input.version!==1 || typeof input.accountId!=='string' || !input.accountId || input.source!=='google-drive-about.storageQuota' || input.status!=='verified') return false;
  if (typeof input.observedAt!=='string' || !Number.isFinite(Date.parse(input.observedAt))) return false;
  if (!Array.isArray(input.blockers) || input.blockers.length!==0 || !quota || !policy || !computed) return false;
  if (![quota.totalBytes,quota.usedBytes,quota.remainingBytes,input.appUsedBytes,policy.safetyReserveBytes,computed.allocationLimitBytes,computed.ratioRemainingBytes,computed.providerRemainingAfterReserveBytes,computed.availableBytes].every(finiteNonNegativeInteger)) return false;
  return typeof policy.allocationRatio==='number' && Number.isFinite(policy.allocationRatio) && policy.allocationRatio>0 && policy.allocationRatio<=1;
}

export class DriveAllocationAcceptanceLedger {
  constructor(private readonly filePath:string) {}

  async load():Promise<DriveAllocationAcceptanceObservation[]> {
    try {
      const parsed=JSON.parse(await readFile(this.filePath,'utf8')) as unknown;
      if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return [];
      const ledger=parsed as Record<string,unknown>;
      if (ledger.version!==1 || !Array.isArray(ledger.observations)) return [];
      return ledger.observations.filter(validObservation);
    } catch(error) {
      const code=(error as NodeJS.ErrnoException)?.code;
      if (code==='ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async append(observation:DriveAllocationAcceptanceObservation):Promise<void> {
    if (!validObservation(observation)) throw new Error('INVALID_DRIVE_ALLOCATION_ACCEPTANCE_OBSERVATION');
    const existing=await this.load();
    const ledger:Ledger={version:1,observations:[...existing,observation]};
    await mkdir(path.dirname(this.filePath),{recursive:true});
    const temporary=`${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary,`${JSON.stringify(ledger,null,2)}\n`,{encoding:'utf8',mode:0o600});
    await rename(temporary,this.filePath);
  }

  async latest(accountId:string):Promise<DriveAllocationAcceptanceObservation|undefined> {
    const matching=(await this.load()).filter(item=>item.accountId===accountId);
    return matching.at(-1);
  }
}

export type LiveSafeDriveAllocationAcceptanceOptions = {
  ledger: DriveAllocationAcceptanceLedger;
  refreshQuota: () => Promise<DriveQuotaInput>;
  now?: () => Date;
};

/**
 * Read-only acceptance harness. The only provider capability accepted here is
 * refreshQuota; upload, delete, folder creation and media mutation are
 * deliberately impossible through this contract.
 */
export class LiveSafeDriveAllocationAcceptance {
  constructor(private readonly options:LiveSafeDriveAllocationAcceptanceOptions) {}

  async observe(input:{account:SavedDriveAccountRecord;email:string;appUsedBytes:number}):Promise<DriveAllocationAcceptanceObservation> {
    const quota=await this.options.refreshQuota();
    if (!finiteNonNegativeInteger(quota.limit) || !finiteNonNegativeInteger(quota.usage) || quota.limit<=0 || quota.usage>quota.limit) {
      throw new Error('AUTHORITATIVE_GOOGLE_DRIVE_QUOTA_UNAVAILABLE');
    }
    const runtime=driveRuntimeAllocation({...input,quota});
    const snapshot=runtime.snapshot;
    if (snapshot.providerTotalBytes===null || snapshot.allocationLimitBytes===null || snapshot.ratioRemainingBytes===null) {
      throw new Error('AUTHORITATIVE_GOOGLE_DRIVE_QUOTA_UNAVAILABLE');
    }
    const expectedLimit=Math.floor(snapshot.providerTotalBytes*snapshot.allocationRatio);
    const expectedRatioRemaining=Math.max(0,expectedLimit-snapshot.appUsedBytes);
    const expectedProviderRemaining=Math.max(0,snapshot.providerFreeBytes-snapshot.safetyReserveBytes);
    const expectedAvailable=Math.min(expectedRatioRemaining,expectedProviderRemaining);
    if (snapshot.allocationLimitBytes!==expectedLimit || snapshot.ratioRemainingBytes!==expectedRatioRemaining || snapshot.providerRemainingAfterReserveBytes!==expectedProviderRemaining || snapshot.availableBytes!==expectedAvailable) {
      throw new Error('DRIVE_ALLOCATION_ACCEPTANCE_FORMULA_MISMATCH');
    }
    const observation:DriveAllocationAcceptanceObservation={
      version:1,
      accountId:input.account.id,
      observedAt:(this.options.now?.()??new Date()).toISOString(),
      source:'google-drive-about.storageQuota',
      authoritativeQuota:{totalBytes:snapshot.providerTotalBytes,usedBytes:snapshot.providerUsedBytes??0,remainingBytes:snapshot.providerFreeBytes},
      policy:{allocationRatio:snapshot.allocationRatio,safetyReserveBytes:snapshot.safetyReserveBytes},
      appUsedBytes:snapshot.appUsedBytes,
      computed:{allocationLimitBytes:snapshot.allocationLimitBytes,ratioRemainingBytes:snapshot.ratioRemainingBytes,providerRemainingAfterReserveBytes:snapshot.providerRemainingAfterReserveBytes,availableBytes:snapshot.availableBytes},
      status:'verified',
      blockers:[],
    };
    await this.options.ledger.append(observation);
    return observation;
  }
}
