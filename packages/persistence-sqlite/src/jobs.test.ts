import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DurableJob } from '@photox/jobs';
import { DurableJobQueue } from '@photox/jobs';
import { SqliteJobRepository, SqlitePhotoXStore } from './index.js';

const tempDirs:string[]=[];
afterEach(async()=>{await Promise.all(tempDirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function makeStore(){const dir=await mkdtemp(join(tmpdir(),'photox-jobs-'));tempDirs.push(dir);return new SqlitePhotoXStore({path:join(dir,'photox.db')});}
const baseJob=(workspaceId:string,payload:string):DurableJob<string>=>({id:'same-job',workspaceId,type:'demo',payload,state:'QUEUED',priority:0,attempts:0,maxAttempts:3,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'});

describe('SqliteJobRepository workspace isolation',()=>{
  it('stores identical job IDs independently and remains isolated after reopen',async()=>{
    const store=await makeStore();
    const dbPath=(store.db.prepare('PRAGMA database_list').get() as {file:string}).file;
    const repoA=new SqliteJobRepository(store,'workspace-a','legacy-workspace');
    const repoB=new SqliteJobRepository(store,'workspace-b','legacy-workspace');
    await repoA.put(baseJob('workspace-a','a'));
    await repoB.put(baseJob('workspace-b','b'));
    expect((await repoA.get('workspace-a','same-job'))?.payload).toBe('a');
    expect((await repoB.get('workspace-b','same-job'))?.payload).toBe('b');
    expect(await repoA.get('workspace-b','same-job')).toBeNull();
    await expect(repoA.put(baseJob('workspace-b','bad'))).rejects.toThrow('JOB_WORKSPACE_MISMATCH');
    store.close();

    const reopened=new SqlitePhotoXStore({path:dbPath});
    const reopenedA=new SqliteJobRepository(reopened,'workspace-a','legacy-workspace');
    const reopenedB=new SqliteJobRepository(reopened,'workspace-b','legacy-workspace');
    expect((await reopenedA.list('workspace-a')).map(job=>job.payload)).toEqual(['a']);
    expect((await reopenedB.list('workspace-b')).map(job=>job.payload)).toEqual(['b']);
    reopened.close();
  });

  it('migrates legacy jobs only into the designated legacy workspace',async()=>{
    const store=await makeStore();
    store.db.prepare(`INSERT INTO photox_jobs(id,type,payload_json,state,priority,attempts,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      'legacy-job','demo',JSON.stringify({legacy:true}),'QUEUED',0,0,3,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',
    );
    const legacyRepo=new SqliteJobRepository(store,'legacy-workspace','legacy-workspace');
    const otherRepo=new SqliteJobRepository(store,'other-workspace','legacy-workspace');
    expect((await legacyRepo.get('legacy-workspace','legacy-job'))?.workspaceId).toBe('legacy-workspace');
    expect(await otherRepo.get('other-workspace','legacy-job')).toBeNull();
    const columns=store.db.prepare('PRAGMA table_info(photox_jobs)').all() as Array<{name:string;pk:number}>;
    expect(columns.find(column=>column.name==='workspace_id')?.pk).toBeGreaterThan(0);
    expect(columns.find(column=>column.name==='id')?.pk).toBeGreaterThan(0);
    store.close();
  });

  it('queue cannot claim or mutate another workspace job',async()=>{
    const store=await makeStore();
    const repoA=new SqliteJobRepository(store,'workspace-a','legacy-workspace');
    const repoB=new SqliteJobRepository(store,'workspace-b','legacy-workspace');
    const queueA=new DurableJobQueue(repoA,'workspace-a',()=>new Date('2026-01-01T00:00:00.000Z'));
    const queueB=new DurableJobQueue(repoB,'workspace-b',()=>new Date('2026-01-01T00:00:00.000Z'));
    queueA.register('demo',async()=>undefined);
    queueB.register('demo',async()=>undefined);
    const jobA=await queueA.enqueue('demo',{owner:'a'});
    await repoB.put({...jobA,workspaceId:'workspace-b',payload:{owner:'b'}});
    await queueA.cancel(jobA.id);
    expect((await repoA.get('workspace-a',jobA.id))?.state).toBe('CANCELLED');
    expect((await repoB.get('workspace-b',jobA.id))?.state).toBe('QUEUED');
    store.close();
  });
});
