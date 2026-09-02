from pathlib import Path
p=Path('packages/persistence-sqlite/src/index.ts')
s=p.read_text()
line="export * from './workspace.js';"
if line not in s:
    s=s.rstrip()+"\n"+line+"\n"
p.write_text(s)
