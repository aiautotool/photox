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
 * to another transport can bypass the security/availability assumptions of the
 * authenticated public edge. LAN prefers the direct authenticated receiver and
 * may fall back to the authenticated relay tunnel. All supported transports now
 * use the same resumable protocol and Desktop-authoritative acknowledged offset.
 */
export function planMobileUpload(connectionTransport: MobileUploadTransport): MobileUploadPlan {
  switch (connectionTransport) {
    case 'public':
      return { primary: { transport: 'public', resumable: true } };
    case 'local':
      return {
        primary: { transport: 'local', resumable: true },
        fallback: { transport: 'relay', resumable: true },
      };
    case 'relay':
      return { primary: { transport: 'relay', resumable: true } };
  }
}

/** Cancellation is terminal: an aborted resumable request must preserve its
 * durable session and must never start another transport attempt. */
export function shouldFallbackMobileUpload(
  plan: MobileUploadPlan,
  options: { aborted: boolean },
): boolean {
  return Boolean(plan.fallback) && !options.aborted;
}

/**
 * Execute the selected transport policy with one authoritative fallback point.
 * The caller owns the concrete resumable transports; this function owns the
 * rollout semantics so runtime code cannot drift from the tested policy.
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
