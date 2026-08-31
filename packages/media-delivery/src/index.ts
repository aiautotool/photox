import type { MediaContentRequest, MediaContentResolver, MediaContentResponse, MediaVariant } from '@photox/media-api';

export type DeliveryHealth = 'healthy' | 'unknown' | 'unhealthy';

export interface DeliveryCandidate {
  assetId: string;
  variant: MediaVariant;
  providerId: string;
  accountId?: string;
  replicaId?: string;
  remoteFileId?: string;
  uri?: string;
  mimeType?: string;
  sizeBytes?: number;
  local?: boolean;
  supportsRange?: boolean;
  latencyMs?: number;
  verified?: boolean;
  health?: DeliveryHealth;
  metadata?: Record<string, unknown>;
}

export interface DeliveryCatalog {
  candidates(assetId: string, variant: MediaVariant): Promise<DeliveryCandidate[]>;
}

export interface DeliveryAdapter {
  readonly providerId: string;
  open(candidate: DeliveryCandidate, options: { range?: string }): Promise<MediaContentResponse>;
}

export class DeliveryPolicy {
  rank(candidates: DeliveryCandidate[], request: MediaContentRequest): DeliveryCandidate[] {
    return candidates
      .filter((candidate) => candidate.health !== 'unhealthy')
      .filter((candidate) => candidate.verified !== false)
      .map((candidate) => ({ candidate, score: this.score(candidate, request) }))
      .sort((a, b) => b.score - a.score)
      .map((row) => row.candidate);
  }

  private score(candidate: DeliveryCandidate, request: MediaContentRequest): number {
    let score = 0;
    if (candidate.verified) score += 500;
    if (candidate.health === 'healthy') score += 300;
    if (candidate.local) score += 1000;
    if (candidate.supportsRange) score += request.range ? 500 : 150;
    if ((candidate.mimeType ?? '').startsWith('video/mp4')) score += 100;
    if (candidate.latencyMs !== undefined) score += Math.max(0, 200 - Math.min(200, candidate.latencyMs));
    return score;
  }
}

export class MediaDeliveryResolver implements MediaContentResolver {
  private readonly adapters = new Map<string, DeliveryAdapter>();

  constructor(private readonly catalog: DeliveryCatalog, private readonly policy = new DeliveryPolicy()) {}

  register(adapter: DeliveryAdapter): this {
    this.adapters.set(adapter.providerId, adapter);
    return this;
  }

  async resolve(request: MediaContentRequest): Promise<MediaContentResponse> {
    const ranked = this.policy.rank(await this.catalog.candidates(request.assetId, request.variant), request);
    if (!ranked.length) throw new Error(`No healthy delivery candidate for ${request.assetId}:${request.variant}`);
    const errors: string[] = [];
    for (const candidate of ranked) {
      const adapter = this.adapters.get(candidate.providerId);
      if (!adapter) {
        errors.push(`${candidate.providerId}: no delivery adapter`);
        continue;
      }
      try {
        const response = await adapter.open(candidate, { range: request.range });
        return {
          ...response,
          source: { providerId: candidate.providerId, accountId: candidate.accountId, replicaId: candidate.replicaId },
        };
      } catch (error) {
        errors.push(`${candidate.providerId}:${candidate.accountId ?? '-'} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`All media delivery candidates failed: ${errors.join(' | ')}`);
  }
}
