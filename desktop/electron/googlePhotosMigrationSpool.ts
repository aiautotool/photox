import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PickedMediaItem } from '@photosync/google-photos';

export type MigrationSpoolItem = {
  sourceMediaId: string;
  filename?: string;
  mimeType?: string;
  createTime?: string;
  type?: string;
  sizeBytes: number;
  sha256: string;
  mediaFileMetadata?: PickedMediaItem['mediaFile'] extends infer M ? M extends { mediaFileMetadata?: infer T } ? T : never : never;
};

type MigrationSpoolManifest = {
  version: 1;
  workspaceId: string;
  jobId: string;
  createdAt: string;
  items: MigrationSpoolItem[];
};

function scopeId(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function itemFilename(sourceMediaId: string) {
  return `${scopeId(sourceMediaId)}.bin`;
}

export class GooglePhotosMigrationSpool {
  constructor(private readonly rootDir: string, private readonly workspaceId: string) {}

  private jobDir(jobId: string) {
    return path.join(this.rootDir, scopeId(this.workspaceId), scopeId(jobId));
  }

  private manifestPath(jobId: string) {
    return path.join(this.jobDir(jobId), 'manifest.json');
  }

  async stage(jobId: string, items: PickedMediaItem[], download: (item: PickedMediaItem) => Promise<Response>): Promise<MigrationSpoolItem[]> {
    const jobDir = this.jobDir(jobId);
    await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
    const staged: MigrationSpoolItem[] = [];

    try {
      for (const item of items) {
        const response = await download(item);
        if (!response.ok) throw new Error(`MIGRATION_SPOOL_DOWNLOAD_${response.status}`);
        const targetPath = path.join(jobDir, itemFilename(item.id));
        const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
        const hash = crypto.createHash('sha256');
        let sizeBytes = 0;
        const counter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            sizeBytes += chunk.byteLength;
            hash.update(chunk);
            callback(null, chunk);
          },
        });

        try {
          if (response.body) {
            await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(tempPath, { mode: 0o600 }));
          } else {
            const bytes = Buffer.from(await response.arrayBuffer());
            sizeBytes = bytes.byteLength;
            hash.update(bytes);
            await fs.writeFile(tempPath, bytes, { mode: 0o600 });
          }
          await fs.rename(tempPath, targetPath);
        } catch (error) {
          await fs.rm(tempPath, { force: true }).catch(() => undefined);
          throw error;
        }

        staged.push({
          sourceMediaId: item.id,
          filename: item.mediaFile?.filename,
          mimeType: item.mediaFile?.mimeType,
          createTime: item.createTime,
          type: item.type,
          sizeBytes,
          sha256: hash.digest('hex'),
          mediaFileMetadata: item.mediaFile?.mediaFileMetadata,
        });
      }

      const manifest: MigrationSpoolManifest = { version: 1, workspaceId: this.workspaceId, jobId, createdAt: new Date().toISOString(), items: staged };
      const manifestTemp = `${this.manifestPath(jobId)}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(manifestTemp, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(manifestTemp, this.manifestPath(jobId));
      return staged;
    } catch (error) {
      await this.remove(jobId);
      throw error;
    }
  }

  async list(jobId: string): Promise<MigrationSpoolItem[]> {
    const manifest = await this.readManifest(jobId);
    return manifest.items;
  }

  async sourceMap(jobId: string): Promise<Map<string, PickedMediaItem>> {
    const items = await this.list(jobId);
    return new Map(items.map(item => [item.sourceMediaId, {
      id: item.sourceMediaId,
      createTime: item.createTime,
      type: item.type,
      mediaFile: {
        baseUrl: '',
        mimeType: item.mimeType,
        filename: item.filename,
        mediaFileMetadata: item.mediaFileMetadata,
      },
    }]));
  }

  async response(jobId: string, sourceMediaId: string): Promise<Response> {
    const manifest = await this.readManifest(jobId);
    const item = manifest.items.find(candidate => candidate.sourceMediaId === sourceMediaId);
    if (!item) throw new Error('MIGRATION_SPOOL_ITEM_NOT_FOUND');
    const filePath = path.join(this.jobDir(jobId), itemFilename(sourceMediaId));
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size !== item.sizeBytes) throw new Error('MIGRATION_SPOOL_INTEGRITY_FAILED');

    const actualHash = crypto.createHash('sha256');
    await pipeline(createReadStream(filePath), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        actualHash.update(chunk);
        callback(null, chunk);
      },
    }), new Transform({ transform(_chunk, _encoding, callback) { callback(); } }));
    if (actualHash.digest('hex') !== item.sha256) throw new Error('MIGRATION_SPOOL_INTEGRITY_FAILED');

    const body = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit;
    return new Response(body, { headers: { 'content-type': item.mimeType || 'application/octet-stream', 'content-length': String(item.sizeBytes) } });
  }

  async remove(jobId: string) {
    await fs.rm(this.jobDir(jobId), { recursive: true, force: true });
  }

  private async readManifest(jobId: string): Promise<MigrationSpoolManifest> {
    const raw = await fs.readFile(this.manifestPath(jobId), 'utf8').catch(() => null);
    if (!raw) throw new Error('MIGRATION_SPOOL_MISSING');
    let parsed: MigrationSpoolManifest;
    try { parsed = JSON.parse(raw) as MigrationSpoolManifest; } catch { throw new Error('MIGRATION_SPOOL_INVALID'); }
    if (parsed.version !== 1 || parsed.workspaceId !== this.workspaceId || parsed.jobId !== jobId || !Array.isArray(parsed.items)) throw new Error('MIGRATION_SPOOL_INVALID');
    return parsed;
  }
}
