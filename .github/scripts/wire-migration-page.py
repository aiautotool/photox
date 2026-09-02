from pathlib import Path
p=Path('desktop/src/App.tsx')
s=p.read_text()
s=s.replace("import { resolveDesktopBridge, type BackupHealthSnapshot, type CloudState, type CloudUpload, type DesktopStatus, type DriveAccount, type LocalMedia, type TunnelState } from './bridge';", "import { resolveDesktopBridge, type BackupHealthSnapshot, type CloudState, type CloudUpload, type DesktopStatus, type DriveAccount, type LocalMedia, type TunnelState } from './bridge';\nimport { MigrationPage } from './MigrationPage';\nimport './MigrationPage.css';")
s=s.replace("['◫','Thiết bị'],['⇧','Bản sao an toàn']", "['◫','Thiết bị'],['⇄','Chuyển dữ liệu'],['⇧','Bản sao an toàn']")
s=s.replace("  function renderContent(){\n", "  function renderContent(){\n    if(active==='Chuyển dữ liệu')return <MigrationPage bridge={bridge}/>;\n")
if s==p.read_text(): raise SystemExit('migration page patch did not apply')
p.write_text(s)
