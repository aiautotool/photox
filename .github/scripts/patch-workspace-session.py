from pathlib import Path

p=Path('packages/persistence-sqlite/src/index.ts')
s=p.read_text()
s=s.replace("import type { MediaApiScope, RefreshSessionStore } from '@photox/media-api';", "import type { MediaApiScope, RefreshSessionStore, WorkspaceSessionRole } from '@photox/media-api';")
old="""export class SqliteRefreshSessionStore implements RefreshSessionStore {
  constructor(private readonly store: SqlitePhotoXStore) {}
  async create(input: { subject: string; deviceId?: string; scopes: MediaApiScope[]; expiresAt: number }): Promise<{ refreshToken: string; sessionId: string }> {
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.store.db.prepare('INSERT INTO photox_refresh_sessions(session_id,token_hash,subject,device_id,scopes_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(
      sessionId, this.hash(refreshToken), input.subject, input.deviceId ?? null, JSON.stringify(input.scopes), input.expiresAt, now,
    );
    return { refreshToken, sessionId };
  }
  async consume(refreshToken: string): Promise<{ subject: string; deviceId?: string; scopes: MediaApiScope[]; sessionId: string } | null> {
    const now = Math.floor(Date.now() / 1000);
    const row = this.store.db.prepare('SELECT * FROM photox_refresh_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(this.hash(refreshToken), now) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.store.db.prepare('UPDATE photox_refresh_sessions SET last_used_at=? WHERE session_id=?').run(now, String(row.session_id));
    return { subject: String(row.subject), deviceId: row.device_id ? String(row.device_id) : undefined, scopes: JSON.parse(String(row.scopes_json)) as MediaApiScope[], sessionId: String(row.session_id) };
  }
  async revoke(sessionId: string): Promise<void> { this.store.db.prepare('UPDATE photox_refresh_sessions SET revoked_at=? WHERE session_id=?').run(Math.floor(Date.now() / 1000), sessionId); }
  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
}
"""
new="""export class SqliteRefreshSessionStore implements RefreshSessionStore {
  constructor(private readonly store: SqlitePhotoXStore) { this.ensureWorkspaceColumns(); }
  private ensureWorkspaceColumns() {
    const columns = new Set((this.store.db.prepare('PRAGMA table_info(photox_refresh_sessions)').all() as Array<{ name: string }>).map(row => row.name));
    if (!columns.has('workspace_id')) this.store.db.exec('ALTER TABLE photox_refresh_sessions ADD COLUMN workspace_id TEXT');
    if (!columns.has('workspace_role')) this.store.db.exec('ALTER TABLE photox_refresh_sessions ADD COLUMN workspace_role TEXT');
  }
  async create(input: { subject: string; deviceId?: string; workspaceId?: string; workspaceRole?: WorkspaceSessionRole; scopes: MediaApiScope[]; expiresAt: number }): Promise<{ refreshToken: string; sessionId: string }> {
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.store.db.prepare('INSERT INTO photox_refresh_sessions(session_id,token_hash,subject,device_id,workspace_id,workspace_role,scopes_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      sessionId, this.hash(refreshToken), input.subject, input.deviceId ?? null, input.workspaceId ?? null, input.workspaceRole ?? null, JSON.stringify(input.scopes), input.expiresAt, now,
    );
    return { refreshToken, sessionId };
  }
  async consume(refreshToken: string): Promise<{ subject: string; deviceId?: string; workspaceId?: string; workspaceRole?: WorkspaceSessionRole; scopes: MediaApiScope[]; sessionId: string } | null> {
    const now = Math.floor(Date.now() / 1000);
    const row = this.store.db.prepare('SELECT * FROM photox_refresh_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(this.hash(refreshToken), now) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.store.db.prepare('UPDATE photox_refresh_sessions SET last_used_at=? WHERE session_id=?').run(now, String(row.session_id));
    return {
      subject: String(row.subject),
      deviceId: row.device_id ? String(row.device_id) : undefined,
      workspaceId: row.workspace_id ? String(row.workspace_id) : undefined,
      workspaceRole: row.workspace_role ? String(row.workspace_role) as WorkspaceSessionRole : undefined,
      scopes: JSON.parse(String(row.scopes_json)) as MediaApiScope[],
      sessionId: String(row.session_id),
    };
  }
  async revoke(sessionId: string): Promise<void> { this.store.db.prepare('UPDATE photox_refresh_sessions SET revoked_at=? WHERE session_id=?').run(Math.floor(Date.now() / 1000), sessionId); }
  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
}
"""
if old not in s:
    raise SystemExit('refresh session block not found')
p.write_text(s.replace(old,new))

t=Path('packages/persistence-sqlite/src/workspace.test.ts')
s=t.read_text()
s=s.replace("import { SqlitePhotoXStore } from './index.js';", "import { SqlitePhotoXStore, SqliteRefreshSessionStore } from './index.js';")
insert="""
  it('preserves workspace identity across refresh sessions', async () => {
    const { store } = setup();
    const sessions = new SqliteRefreshSessionStore(store);
    const created = await sessions.create({ subject: 'user-a', deviceId: 'phone-a', workspaceId: 'ws-a', workspaceRole: 'member', scopes: ['media:read', 'media:write'], expiresAt: Math.floor(Date.now() / 1000) + 60 });
    await expect(sessions.consume(created.refreshToken)).resolves.toMatchObject({ subject: 'user-a', deviceId: 'phone-a', workspaceId: 'ws-a', workspaceRole: 'member', scopes: ['media:read', 'media:write'], sessionId: created.sessionId });
    await sessions.revoke(created.sessionId);
    await expect(sessions.consume(created.refreshToken)).resolves.toBeNull();
    store.close();
  });
"""
marker="\n  it('stores audit events only inside their workspace', () => {"
if insert.strip() not in s:
    if marker not in s: raise SystemExit('test insertion marker not found')
    s=s.replace(marker, insert+marker)
t.write_text(s)
