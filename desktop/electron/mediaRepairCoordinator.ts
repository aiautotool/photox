export type RepairMediaRecord = {
  workspaceId: string;
  key: string;
  localAvailable: boolean;
  verifiedAccountIds: string[];
  targetReplicas: number;
};

export type RepairMediaResult = {
  workspaceId: string;
  key: string;
  status: 'queued' | 'already_safe';
  verifiedReplicas: number;
  targetReplicas: number;
};

export type MediaRepairCoordinatorDependencies = {
  loadMedia(workspaceId: string, key: string): Promise<RepairMediaRecord | undefined>;
  scheduleUpload(media: RepairMediaRecord): Promise<void>;
};

function distinctVerifiedAccounts(media: RepairMediaRecord) {
  return new Set(media.verifiedAccountIds.filter(Boolean)).size;
}

/**
 * Coordinates an explicit repair request for exactly one media key.
 *
 * The coordinator deliberately does not scan a workspace. It validates that the
 * requested asset belongs to the caller's workspace, still has a local original
 * that can seed a replacement, and is actually below the replica target before
 * invoking the injected production upload scheduler. Concurrent clicks for the
 * same workspace/key share one in-flight operation so a UI retry cannot enqueue
 * duplicate Drive work.
 */
export class MediaRepairCoordinator {
  private readonly inFlight = new Map<string, Promise<RepairMediaResult>>();

  constructor(private readonly dependencies: MediaRepairCoordinatorDependencies) {}

  repair(workspaceId: string, key: string): Promise<RepairMediaResult> {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedKey = key.trim();
    if (!normalizedWorkspaceId) return Promise.reject(new Error('MEDIA_REPAIR_WORKSPACE_REQUIRED'));
    if (!normalizedKey) return Promise.reject(new Error('MEDIA_REPAIR_KEY_REQUIRED'));

    const identity = `${normalizedWorkspaceId}\n${normalizedKey}`;
    const existing = this.inFlight.get(identity);
    if (existing) return existing;

    const operation = this.run(normalizedWorkspaceId, normalizedKey)
      .finally(() => this.inFlight.delete(identity));
    this.inFlight.set(identity, operation);
    return operation;
  }

  private async run(workspaceId: string, key: string): Promise<RepairMediaResult> {
    const media = await this.dependencies.loadMedia(workspaceId, key);
    if (!media || media.workspaceId !== workspaceId || media.key !== key) {
      throw new Error('MEDIA_REPAIR_NOT_FOUND');
    }

    const verifiedReplicas = distinctVerifiedAccounts(media);
    const targetReplicas = Math.max(1, Math.floor(media.targetReplicas));
    if (verifiedReplicas >= targetReplicas) {
      return { workspaceId, key, status: 'already_safe', verifiedReplicas, targetReplicas };
    }
    if (!media.localAvailable) throw new Error('MEDIA_REPAIR_LOCAL_ORIGINAL_UNAVAILABLE');

    await this.dependencies.scheduleUpload(media);
    return { workspaceId, key, status: 'queued', verifiedReplicas, targetReplicas };
  }
}
