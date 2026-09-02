import crypto from 'node:crypto';

export type WorkspacePairingContext = {
  version: 2;
  workspaceId: string;
  workspaceRole: 'owner'|'admin'|'member'|'viewer';
  desktopDeviceId: string;
  challenge: string;
  challengeExpiresAt: number;
  capabilities: string[];
};

const DEFAULT_TTL_MS = 10 * 60_000;

export class WorkspacePairingChallengeManager {
  private current: WorkspacePairingContext | null = null;

  constructor(
    private readonly workspaceId: string,
    private readonly desktopDeviceId: string,
    private readonly workspaceRole: WorkspacePairingContext['workspaceRole'] = 'owner',
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  issue(now = Date.now()): WorkspacePairingContext {
    if (!this.current || this.current.challengeExpiresAt <= now + 30_000) {
      this.current = {
        version: 2,
        workspaceId: this.workspaceId,
        workspaceRole: this.workspaceRole,
        desktopDeviceId: this.desktopDeviceId,
        challenge: crypto.randomBytes(32).toString('base64url'),
        challengeExpiresAt: now + this.ttlMs,
        capabilities: ['workspace-pairing-v2','media-upload','media-read','range-streaming'],
      };
    }
    return { ...this.current, capabilities: [...this.current.capabilities] };
  }

  verify(input: { challenge?: string; workspaceId?: string }, now = Date.now()): boolean {
    const current = this.current;
    if (!current || current.challengeExpiresAt <= now || !input.challenge || !input.workspaceId) return false;
    if (input.workspaceId !== current.workspaceId) return false;
    const expected = Buffer.from(current.challenge);
    const received = Buffer.from(input.challenge);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  revoke() { this.current = null; }
}

const sharedManagers = new Map<string, WorkspacePairingChallengeManager>();

export function getWorkspacePairingChallengeManager(
  workspaceId: string,
  desktopDeviceId: string,
  workspaceRole: WorkspacePairingContext['workspaceRole'] = 'owner',
): WorkspacePairingChallengeManager {
  const key = `${workspaceId}:${desktopDeviceId}:${workspaceRole}`;
  let manager = sharedManagers.get(key);
  if (!manager) {
    manager = new WorkspacePairingChallengeManager(workspaceId, desktopDeviceId, workspaceRole);
    sharedManagers.set(key, manager);
  }
  return manager;
}
