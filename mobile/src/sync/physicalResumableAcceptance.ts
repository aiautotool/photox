import * as SecureStore from 'expo-secure-store';

export type PhysicalResumableAcceptancePlatform = 'ios' | 'android';

export type PhysicalResumableAcceptanceRunConfig = {
  runId: string;
  release: {
    appVersion: string;
    buildNumber: string;
    commitSha: string;
  };
  device: {
    platform: PhysicalResumableAcceptancePlatform;
    model: string;
    osVersion: string;
  };
  assetId: string;
};

export type MobilePhysicalResumableAcceptanceReport = {
  version: 1;
  runId: string;
  startedAt: string;
  release: PhysicalResumableAcceptanceRunConfig['release'];
  device: PhysicalResumableAcceptanceRunConfig['device'];
  upload: {
    assetId: string;
    sessionId: string;
    assetSizeBytes: number;
  };
  scenario: {
    networkInterruptedAt: string;
    interruptedAfterBytes: number;
    processKilledAt: string;
    appRestartedAt: string;
    resumeStartedAt: string;
    resumedFromByte: number;
    completedAt: string;
  };
};

type PendingAcceptanceRun = {
  version: 1;
  runId: string;
  startedAt: string;
  release: PhysicalResumableAcceptanceRunConfig['release'];
  device: PhysicalResumableAcceptanceRunConfig['device'];
  assetId: string;
  sessionId?: string;
  assetSizeBytes?: number;
  latestUploadedBytes: number;
  networkInterruptedAt?: string;
  interruptedAfterBytes?: number;
  processKilledAt?: string;
  appRestartedAt?: string;
  resumeStartedAt?: string;
  resumedFromByte?: number;
  completedAt?: string;
};

type AcceptanceState = {
  version: 1;
  runs: Record<string, PendingAcceptanceRun>;
};

const STORE_KEY = 'photox.physical-resumable-acceptance.v1';

function nowIso() {
  return new Date().toISOString();
}

function nonEmpty(value: string, code: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function safeBytes(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function validateConfig(config: PhysicalResumableAcceptanceRunConfig) {
  nonEmpty(config.runId, 'PHYSICAL_RESUMABLE_ACCEPTANCE_RUN_ID_REQUIRED');
  nonEmpty(config.assetId, 'PHYSICAL_RESUMABLE_ACCEPTANCE_ASSET_ID_REQUIRED');
  nonEmpty(config.release.appVersion, 'PHYSICAL_RESUMABLE_ACCEPTANCE_APP_VERSION_REQUIRED');
  nonEmpty(config.release.buildNumber, 'PHYSICAL_RESUMABLE_ACCEPTANCE_BUILD_NUMBER_REQUIRED');
  if (!/^[0-9a-f]{40}$/i.test(config.release.commitSha)) throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_COMMIT_SHA_REQUIRED');
  if (config.device.platform !== 'ios' && config.device.platform !== 'android') throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_PLATFORM_REQUIRED');
  nonEmpty(config.device.model, 'PHYSICAL_RESUMABLE_ACCEPTANCE_DEVICE_MODEL_REQUIRED');
  nonEmpty(config.device.osVersion, 'PHYSICAL_RESUMABLE_ACCEPTANCE_OS_VERSION_REQUIRED');
}

async function loadState(): Promise<AcceptanceState> {
  const raw = await SecureStore.getItemAsync(STORE_KEY);
  if (!raw) return { version: 1, runs: {} };
  try {
    const parsed = JSON.parse(raw) as AcceptanceState;
    if (parsed?.version !== 1 || !parsed.runs || typeof parsed.runs !== 'object') throw new Error('INVALID_STATE');
    return parsed;
  } catch {
    await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined);
    return { version: 1, runs: {} };
  }
}

async function saveState(state: AcceptanceState) {
  if (!Object.keys(state.runs).length) {
    await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined);
    return;
  }
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(state));
}

async function mutateRun(assetId: string, mutate: (run: PendingAcceptanceRun) => void): Promise<PendingAcceptanceRun | null> {
  const state = await loadState();
  const run = state.runs[assetId];
  if (!run) return null;
  mutate(run);
  await saveState(state);
  return run;
}

/**
 * Explicit acceptance-test activation. Normal PhotoX sync never calls this;
 * test tooling must bind a concrete release, device and asset first. The
 * durable record contains no auth credential, filename or media content.
 */
export async function beginPhysicalResumableAcceptanceRun(config: PhysicalResumableAcceptanceRunConfig): Promise<void> {
  validateConfig(config);
  const state = await loadState();
  if (state.runs[config.assetId]) throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_RUN_ALREADY_ACTIVE');
  state.runs[config.assetId] = {
    version: 1,
    runId: config.runId,
    startedAt: nowIso(),
    release: { ...config.release, commitSha: config.release.commitSha.toLowerCase() },
    device: { ...config.device },
    assetId: config.assetId,
    latestUploadedBytes: 0,
  };
  await saveState(state);
}

/** Test harness should call this immediately after intentionally cutting the network. */
export async function markPhysicalResumableNetworkInterrupted(assetId: string): Promise<void> {
  const run = await mutateRun(assetId, current => {
    if (current.networkInterruptedAt) return;
    current.networkInterruptedAt = nowIso();
    current.interruptedAfterBytes = current.latestUploadedBytes;
  });
  if (!run) throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_RUN_NOT_ACTIVE');
}

/**
 * Test harness calls this immediately before asking the OS to terminate the
 * process. Persisting first makes the subsequent restart observable without
 * pretending the killed process can execute code after termination.
 */
export async function markPhysicalResumableProcessKillImminent(assetId: string): Promise<void> {
  const run = await mutateRun(assetId, current => {
    if (!current.networkInterruptedAt) throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_NETWORK_INTERRUPT_REQUIRED');
    if (!current.processKilledAt) current.processKilledAt = nowIso();
  });
  if (!run) throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_RUN_NOT_ACTIVE');
}

/**
 * Fed from ResumableUploadClient's real progress callback. The first progress
 * event after a persisted kill marker is the restarted app's server-refreshed
 * session offset, which becomes the untrusted mobile `resumedFromByte` claim.
 * Desktop independently replaces authority-sensitive observations.
 */
export async function observePhysicalResumableUploadProgress(input: {
  assetId: string;
  sessionId: string;
  uploadedBytes: number;
  totalBytes: number;
}): Promise<void> {
  safeBytes(input.uploadedBytes, 'PHYSICAL_RESUMABLE_ACCEPTANCE_UPLOADED_BYTES_INVALID');
  const totalBytes = safeBytes(input.totalBytes, 'PHYSICAL_RESUMABLE_ACCEPTANCE_TOTAL_BYTES_INVALID');
  if (input.uploadedBytes > totalBytes || totalBytes === 0) throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_PROGRESS_INVALID');
  await mutateRun(input.assetId, current => {
    current.sessionId = nonEmpty(input.sessionId, 'PHYSICAL_RESUMABLE_ACCEPTANCE_SESSION_ID_REQUIRED');
    current.assetSizeBytes = totalBytes;
    if (current.processKilledAt && !current.appRestartedAt) {
      const observedAt = nowIso();
      current.appRestartedAt = observedAt;
      current.resumeStartedAt = observedAt;
      current.resumedFromByte = input.uploadedBytes;
    }
    current.latestUploadedBytes = input.uploadedBytes;
  });
}

function completeReport(run: PendingAcceptanceRun): MobilePhysicalResumableAcceptanceReport | null {
  if (!run.sessionId || !run.assetSizeBytes || !run.networkInterruptedAt || run.interruptedAfterBytes === undefined
    || !run.processKilledAt || !run.appRestartedAt || !run.resumeStartedAt || run.resumedFromByte === undefined
    || !run.completedAt) return null;
  return {
    version: 1,
    runId: run.runId,
    startedAt: run.startedAt,
    release: { ...run.release },
    device: { ...run.device },
    upload: {
      assetId: run.assetId,
      sessionId: run.sessionId,
      assetSizeBytes: run.assetSizeBytes,
    },
    scenario: {
      networkInterruptedAt: run.networkInterruptedAt,
      interruptedAfterBytes: run.interruptedAfterBytes,
      processKilledAt: run.processKilledAt,
      appRestartedAt: run.appRestartedAt,
      resumeStartedAt: run.resumeStartedAt,
      resumedFromByte: run.resumedFromByte,
      completedAt: run.completedAt,
    },
  };
}

/**
 * Called only after the real resumable finalize returned successfully. If no
 * explicit acceptance run is active this is a no-op. Failed submission stays
 * durable so acceptance tooling can retry without replaying media bytes.
 */
export async function submitPhysicalResumableAcceptanceIfComplete(
  assetId: string,
  submit: (report: MobilePhysicalResumableAcceptanceReport) => Promise<void>,
): Promise<boolean> {
  const state = await loadState();
  const run = state.runs[assetId];
  if (!run) return false;
  if (!run.completedAt) run.completedAt = nowIso();
  const report = completeReport(run);
  if (!report) {
    await saveState(state);
    return false;
  }
  await submit(report);
  delete state.runs[assetId];
  await saveState(state);
  return true;
}
