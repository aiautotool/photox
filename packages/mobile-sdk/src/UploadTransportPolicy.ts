export type MobileUploadTransport = 'public' | 'local' | 'relay';

export type MobileUploadAttempt = {
  transport: MobileUploadTransport;
  resumable: boolean;
};

export type MobileUploadPlan = {
  primary: MobileUploadAttempt;
  fallback?: MobileUploadAttempt;
};

/**
 * Central rollout policy for Mobile -> Desktop media upload.
 *
 * Public exposure must fail closed because silently downgrading a public request
 * to the legacy relay path can bypass the security/availability assumptions of
 * the authenticated public edge. LAN may temporarily fall back to the legacy
 * relay whole-file path while resumable support rolls out. Relay itself remains
 * legacy whole-file until the relay protocol gains byte-offset forwarding.
 */
export function planMobileUpload(connectionTransport: MobileUploadTransport): MobileUploadPlan {
  switch (connectionTransport) {
    case 'public':
      return { primary: { transport: 'public', resumable: true } };
    case 'local':
      return {
        primary: { transport: 'local', resumable: true },
        fallback: { transport: 'relay', resumable: false },
      };
    case 'relay':
      return { primary: { transport: 'relay', resumable: false } };
  }
}

/** Cancellation is terminal: an aborted resumable request must preserve its
 * durable session and must never start a whole-file fallback upload. */
export function shouldFallbackMobileUpload(
  plan: MobileUploadPlan,
  options: { aborted: boolean },
): boolean {
  return Boolean(plan.fallback) && !options.aborted;
}

/**
 * Execute the selected transport policy with one authoritative fallback point.
 * The caller owns the concrete resumable/relay transports; this function owns
 * the rollout semantics so runtime code cannot drift from the tested policy.
 */
export async function executeMobileUploadPlan<T>(
  plan: MobileUploadPlan,
  executeAttempt: (attempt: MobileUploadAttempt) => Promise<T>,
  options: { isAborted?: () => boolean } = {},
): Promise<T> {
  try {
    return await executeAttempt(plan.primary);
  } catch (error) {
    if (!shouldFallbackMobileUpload(plan, { aborted: options.isAborted?.() ?? false })) throw error;
    return await executeAttempt(plan.fallback!);
  }
}
