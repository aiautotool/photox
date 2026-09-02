from pathlib import Path

index=Path('packages/persistence-sqlite/src/index.ts')
s=index.read_text()
line="export * from './workspace.js';"
if line not in s:
    s=s.rstrip()+"\n"+line+"\n"
index.write_text(s)

p=Path('packages/persistence-sqlite/src/workspace.ts')
s=p.read_text()
old="""    const tx = this.store.db.transaction(() => {
      this.putWorkspace(legacy.workspace);
      this.putMembership(legacy.membership);
      this.setUsage(legacy.workspace.id, { ...ZERO_USAGE, members: 1 });
    });
    tx();
"""
new="""    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.putWorkspace(legacy.workspace);
      this.putMembership(legacy.membership);
      this.setUsage(legacy.workspace.id, { ...ZERO_USAGE, members: 1 });
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
"""
if old not in s:
    raise SystemExit('workspace transaction block not found')
p.write_text(s.replace(old,new))
