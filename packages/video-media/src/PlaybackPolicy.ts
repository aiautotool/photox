import type { VideoPlaybackSource } from './types';

export interface PlaybackCandidate extends VideoPlaybackSource {
  providerId?: string;
  accountId?: string;
  local?: boolean;
  latencyMs?: number;
  healthy?: boolean;
}

export class PlaybackPolicy {
  rank(candidates:PlaybackCandidate[]):PlaybackCandidate[] {
    return [...candidates]
      .filter((c) => c.healthy !== false)
      .sort((a,b) => this.score(b) - this.score(a));
  }

  choose(candidates:PlaybackCandidate[]):PlaybackCandidate | null {
    return this.rank(candidates)[0] ?? null;
  }

  private score(c:PlaybackCandidate):number {
    let score = 0;
    if (c.local) score += 1000;
    if (c.supportsRange) score += 300;
    if (c.mimeType?.startsWith('video/mp4')) score += 120;
    if (c.latencyMs !== undefined) score += Math.max(0, 200 - Math.min(200, c.latencyMs));
    if (c.healthy !== false) score += 100;
    return score;
  }
}
