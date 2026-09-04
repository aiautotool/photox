export const DEFAULT_DRIVE_ALLOCATION_PERCENT = 100 * (2 / 3);
export const DEFAULT_DRIVE_SAFETY_RESERVE_MIB = 100;

export type DriveAllocationDraft = {
  allocationPercent: number;
  safetyReserveMiB: number;
};

export type DriveAllocationMutation = {
  maxUsageRatio: number;
  safetyReserveBytes: number;
};

export function allocationPercentFromRatio(ratio:number){
  return Math.round(ratio * 10_000) / 100;
}

export function reserveMiBFromBytes(bytes:number){
  return Math.round((Math.max(0,bytes) / (1024 * 1024)) * 100) / 100;
}

export function buildDriveAllocationMutation(draft:DriveAllocationDraft):DriveAllocationMutation{
  if(!Number.isFinite(draft.allocationPercent) || draft.allocationPercent < 0 || draft.allocationPercent > 100)throw new Error('Tỷ lệ phân bổ phải nằm trong khoảng 0–100%.');
  if(!Number.isFinite(draft.safetyReserveMiB) || draft.safetyReserveMiB < 0)throw new Error('Dung lượng dự phòng không được âm.');
  const safetyReserveBytes=Math.round(draft.safetyReserveMiB * 1024 * 1024);
  if(!Number.isSafeInteger(safetyReserveBytes))throw new Error('Dung lượng dự phòng quá lớn.');
  return {maxUsageRatio:draft.allocationPercent / 100,safetyReserveBytes};
}

export function defaultDriveAllocationMutation():DriveAllocationMutation{
  return {maxUsageRatio:2/3,safetyReserveBytes:DEFAULT_DRIVE_SAFETY_RESERVE_MIB*1024*1024};
}
