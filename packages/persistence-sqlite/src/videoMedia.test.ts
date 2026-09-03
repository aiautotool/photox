import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { VideoMediaRecord } from '@photox/video-media';
import { SqlitePhotoXStore, SqliteVideoMediaRepository } from './index.js';

const dirs:string[] = [];
afterEach(async()=>{ while(dirs.length) await rm(dirs.pop()!, { recursive:true, force:true }); });

async function dbPath(){ const dir=await mkdtemp(join(tmpdir(),'photox-video-media-'));dirs.push(dir);return join(dir,'photox.db'); }

function record(workspaceId:string, label:string):VideoMediaRecord {
  return {
    workspaceId,
    assetId:'same-asset',
    metadata:{ durationMs:1000, width:1920, height:1080, hasAudio:true, videoCodec:'h264', audioCodec:'aac' },
    thumbnail:{ uri:`file:///${label}-thumb.jpg`, width:640, height:360, timeMs:100, mimeType:'image/jpeg' },
    preview:{ uri:`file:///${label}-preview.mp4`, width:1280, height:720, durationMs:1000, mimeType:'video/mp4' },
    updatedAt:'2026-09-03T00:00:00.000Z',
  };
}

describe('SqliteVideoMediaRepository tenant isolation',()=>{
  it('keeps identical asset IDs and derived-media metadata isolated after reopen', async()=>{
    const path=await dbPath();
    let store=new SqlitePhotoXStore({ path });
    const repoA=new SqliteVideoMediaRepository(store,'workspace-a','workspace-a');
    const repoB=new SqliteVideoMediaRepository(store,'workspace-b','workspace-a');
    await repoA.save(record('workspace-a','a'));
    await repoB.save(record('workspace-b','b'));
    expect((await repoA.get('workspace-a','same-asset'))?.thumbnail?.uri).toContain('a-thumb');
    expect((await repoB.get('workspace-b','same-asset'))?.thumbnail?.uri).toContain('b-thumb');
    expect(await repoA.get('workspace-b','same-asset')).toBeNull();
    await expect(repoA.save(record('workspace-b','escape'))).rejects.toThrow('VIDEO_MEDIA_WORKSPACE_MISMATCH');
    store.close();

    store=new SqlitePhotoXStore({ path });
    const reopenedA=new SqliteVideoMediaRepository(store,'workspace-a','workspace-a');
    const reopenedB=new SqliteVideoMediaRepository(store,'workspace-b','workspace-a');
    expect((await reopenedA.get('workspace-a','same-asset'))?.preview?.uri).toContain('a-preview');
    expect((await reopenedB.get('workspace-b','same-asset'))?.preview?.uri).toContain('b-preview');
    await reopenedA.remove('workspace-a','same-asset');
    expect(await reopenedA.get('workspace-a','same-asset')).toBeNull();
    expect((await reopenedB.get('workspace-b','same-asset'))?.workspaceId).toBe('workspace-b');
    store.close();
  });

  it('adopts pre-workspace rows only into the designated legacy workspace', async()=>{
    const path=await dbPath();
    const legacy=new DatabaseSync(path);
    legacy.exec(`CREATE TABLE photox_video_media(asset_id TEXT PRIMARY KEY,record_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    const oldRecord={ assetId:'legacy-asset', metadata:{ durationMs:10,width:10,height:10,hasAudio:false }, thumbnail:{ uri:'file:///legacy.jpg',width:10,height:10,timeMs:0 }, updatedAt:'2026-01-01T00:00:00.000Z' };
    legacy.prepare('INSERT INTO photox_video_media(asset_id,record_json,updated_at) VALUES(?,?,?)').run('legacy-asset',JSON.stringify(oldRecord),oldRecord.updatedAt);
    legacy.close();

    const store=new SqlitePhotoXStore({ path });
    const nonLegacy=new SqliteVideoMediaRepository(store,'workspace-b','workspace-a');
    expect(await nonLegacy.get('workspace-b','legacy-asset')).toBeNull();
    const legacyRepo=new SqliteVideoMediaRepository(store,'workspace-a','workspace-a');
    const adopted=await legacyRepo.get('workspace-a','legacy-asset');
    expect(adopted?.workspaceId).toBe('workspace-a');
    expect(adopted?.thumbnail?.uri).toBe('file:///legacy.jpg');
    store.close();
  });
});
