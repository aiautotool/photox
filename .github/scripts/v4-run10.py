from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'marker missing in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, count))


replace(
    'packages/google-photos/src/migration.ts',
    "export interface MigrationRunControl {\n  shouldPause(): boolean;\n  shouldCancel(): boolean;\n}",
    "export interface MigrationRunControl {\n  shouldPause(): boolean;\n  shouldCancel(): boolean;\n  /** Optional defense-in-depth tenant boundary supplied by the caller. */\n  workspaceId?: string;\n}",
)
replace(
    'packages/google-photos/src/migration.ts',
    "    if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');\n    if (job.state === 'completed' || job.state === 'cancelled') return job;",
    "    if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');\n    if (control.workspaceId && job.workspaceId !== control.workspaceId) throw new Error('MIGRATION_WORKSPACE_MISMATCH');\n    if (job.state === 'completed' || job.state === 'cancelled') return job;",
)

p = Path('packages/google-photos/src/index.test.ts')
s = p.read_text()
marker = "\n});\n\nfunction source"
if marker not in s:
    raise SystemExit('test insertion marker missing')
test = r'''

  it('refuses to run a migration job owned by another workspace', async () => {
    const ledger = new MemoryLedger();
    const job = makeJob('job-cross-tenant');
    await ledger.createJob(job);
    await ledger.putItems(migrationItemsFromPicker(job.id, [source('a')]));
    const transferred: string[] = [];
    const runner = new GooglePhotosMigrationRunner(ledger, {
      async transfer({ item }) { transferred.push(item.sourceMediaId); return { targetId: 'should-not-run' }; },
    });
    await expect(runner.run(job.id, new Map([['a', source('a')]]), {
      workspaceId: 'workspace-2', shouldPause: () => false, shouldCancel: () => false,
    })).rejects.toThrow('MIGRATION_WORKSPACE_MISMATCH');
    expect(transferred).toEqual([]);
    expect((await ledger.getJob(job.id))?.state).toBe('queued');
    expect((await ledger.listItems(job.id))[0]?.state).toBe('queued');
  });
'''
p.write_text(s.replace(marker, test + marker, 1))

replace(
    'desktop/electron/googlePhotosMigration.ts',
    "  async createSelection(input: { sourceAccountId: string; target: MigrationTarget; targetAccountId: string; maxItemCount?: number }) {\n    const account = await this.requireAccount(input.sourceAccountId, 'picker'); const token = await this.accessToken(account);",
    "  async createSelection(input: { sourceAccountId: string; target: MigrationTarget; targetAccountId: string; maxItemCount?: number }) {\n    if (input.target === 'google_photos') {\n      if (input.sourceAccountId === input.targetAccountId) throw new Error('GOOGLE_PHOTOS_SOURCE_TARGET_SAME_ACCOUNT');\n      await this.requireAccount(input.targetAccountId, 'append');\n    }\n    const account = await this.requireAccount(input.sourceAccountId, 'picker'); const token = await this.accessToken(account);",
)
replace(
    'desktop/electron/googlePhotosMigration.ts',
    "    const result = await runner.run(jobId, sources, { shouldPause: () => this.paused.has(jobId), shouldCancel: () => this.cancelled.has(jobId) }); await this.emit(jobId);",
    "    const result = await runner.run(jobId, sources, { workspaceId: this.options.workspaceId, shouldPause: () => this.paused.has(jobId), shouldCancel: () => this.cancelled.has(jobId) }); await this.emit(jobId);",
)

replace(
    'desktop/electron/webEdgeServer.ts',
    "export type WebPrincipal={subject:string;workspaceId:string;workspaceRole?:WebRole;deviceId?:string;sessionId?:string;scopes:MediaApiScope[]};",
    "export type WebPrincipal={subject:string;workspaceId:string;workspaceRole?:WebRole;deviceId?:string;sessionId?:string;scopes:MediaApiScope[]};\nexport type WebAuditInput={action:string;targetType?:string;targetId?:string;metadata?:Record<string,unknown>};",
)
replace(
    'desktop/electron/webEdgeServer.ts',
    "  revokeSession(sessionId:string):Promise<void>;\n  getStatus():Promise<unknown>;",
    "  revokeSession(sessionId:string):Promise<void>;\n  appendAudit(principal:WebPrincipal,event:WebAuditInput):Promise<void>;\n  getStatus():Promise<unknown>;",
)
replace(
    'desktop/electron/webEdgeServer.ts',
    "    const mutate=async(role:WebRole,fn:()=>Promise<unknown>)=>{if(!this.requireRole(principal,role)){this.json(res,403,{error:'ROLE_FORBIDDEN'});return;}this.json(res,200,await fn());};",
    "    const mutate=async(role:WebRole,audit:WebAuditInput,fn:()=>Promise<unknown>)=>{if(!this.requireRole(principal,role)){this.json(res,403,{error:'ROLE_FORBIDDEN'});return;}const value=await fn();await this.handlers.appendAudit(principal,audit);this.json(res,200,value);};",
)
replace(
    'desktop/electron/webEdgeServer.ts',
    "      await this.handlers.revokeSession(String(b.sessionId||principal.sessionId||''));res.setHeader('set-cookie',this.clearSessionCookies(req));res.writeHead(204);res.end();return;",
    "      const targetSession=String(b.sessionId||principal.sessionId||'');await this.handlers.revokeSession(targetSession);await this.handlers.appendAudit(principal,{action:'web.session.revoke',targetType:'session',targetId:targetSession});res.setHeader('set-cookie',this.clearSessionCookies(req));res.writeHead(204);res.end();return;",
)

endpoint_replacements = {
    "return mutate('admin',this.handlers.openLibrary);": "return mutate('admin',{action:'web.library.open',targetType:'library'},this.handlers.openLibrary);",
    "return mutate('admin',this.handlers.addGoogleAccount);": "return mutate('admin',{action:'web.google_drive.connect',targetType:'provider'},this.handlers.addGoogleAccount);",
    "return mutate('admin',()=>this.handlers.removeGoogleAccount(decodeURIComponent(match![1])));": "return mutate('admin',{action:'web.google_drive.remove',targetType:'provider',targetId:decodeURIComponent(match![1])},()=>this.handlers.removeGoogleAccount(decodeURIComponent(match![1])));",
    "return mutate('member',this.handlers.retryCloud);": "return mutate('member',{action:'web.cloud.retry',targetType:'cloud_queue'},this.handlers.retryCloud);",
    "return mutate('admin',()=>this.handlers.connectGooglePhotosAccount(b.capability));": "return mutate('admin',{action:'web.google_photos.connect',targetType:'provider',metadata:{capability:String(b.capability)}},()=>this.handlers.connectGooglePhotosAccount(b.capability));",
    "return mutate('admin',()=>this.handlers.removeGooglePhotosAccount(decodeURIComponent(match![1])));": "return mutate('admin',{action:'web.google_photos.remove',targetType:'provider',targetId:decodeURIComponent(match![1])},()=>this.handlers.removeGooglePhotosAccount(decodeURIComponent(match![1])));",
    "return mutate('member',()=>this.handlers.createMigration(b));": "return mutate('member',{action:'web.migration.create',targetType:'migration',metadata:{sourceAccountId:b.sourceAccountId,target:b.target,targetAccountId:b.targetAccountId}},()=>this.handlers.createMigration(b));",
    "return mutate('member',()=>op==='selection'?this.handlers.materializeMigration(id):op==='run'?this.handlers.runMigration(id):op==='pause'?this.handlers.pauseMigration(id):op==='resume'?this.handlers.resumeMigration(id):op==='cancel'?this.handlers.cancelMigration(id):this.handlers.retryMigration(id));": "return mutate('member',{action:`web.migration.${op}`,targetType:'migration',targetId:id},()=>op==='selection'?this.handlers.materializeMigration(id):op==='run'?this.handlers.runMigration(id):op==='pause'?this.handlers.pauseMigration(id):op==='resume'?this.handlers.resumeMigration(id):op==='cancel'?this.handlers.cancelMigration(id):this.handlers.retryMigration(id));",
}
p = Path('desktop/electron/webEdgeServer.ts')
s = p.read_text()
for old, new in endpoint_replacements.items():
    if old not in s:
        raise SystemExit(f'web edge endpoint marker missing: {old}')
    s = s.replace(old, new, 1)
p.write_text(s)

replace(
    'desktop/electron/main.ts',
    "    revokeSession:sessionId=>requireWorkspaceAuth().revoke(sessionId),\n    getStatus:desktopStatus,",
    "    revokeSession:sessionId=>requireWorkspaceAuth().revoke(sessionId),\n    appendAudit:async(principal,event)=>{requireWorkspaceRepository().appendAudit({workspaceId:principal.workspaceId,actorUserId:principal.subject,actorDeviceId:principal.deviceId,action:event.action,targetType:event.targetType,targetId:event.targetId,metadata:{...(event.metadata||{}),sessionId:principal.sessionId,role:principal.workspaceRole,source:'web'}});},\n    getStatus:desktopStatus,",
)

plan = Path('docs/V4_STORAGE_MIGRATION_WEB.md')
plan.write_text(plan.read_text() + r'''

## Run 10 — Web mutation audit + migration tenant defense

Completed:

- Web administrative/member mutations now append durable workspace audit events after successful execution.
- Audit actor identity is taken from the verified JOSE principal (`subject`, `deviceId`, `sessionId`, workspace role), never from request JSON.
- Google Drive/Google Photos provider mutations, cloud retry, migration lifecycle actions, local-library open and session revoke are audited with target metadata where available.
- `GooglePhotosMigrationRunner` now accepts an expected workspace boundary and refuses a ledger job from another workspace before changing job/item state or invoking a transfer adapter.
- Desktop migration always supplies its workspace ID to the runner.
- Google Photos -> Google Photos selection validates the append-capable destination account before opening Picker and rejects source=destination to avoid accidental duplicate import into the same account.
- Automated migration test proves cross-workspace runner execution is rejected without touching the transfer adapter or ledger state.

Still pending:

- browser-level E2E coverage for ticket login, refresh cookie, CSRF, WebSocket reconnect and Range streaming;
- reverse-proxy deployment recipes (Cloudflare/Caddy/nginx);
- streaming Google Photos downloads and resumable mid-file Drive migration checkpoints;
- live Google OAuth migration verification with user credentials.
''')
