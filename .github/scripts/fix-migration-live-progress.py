from pathlib import Path

p=Path('desktop/electron/main.ts')
s=p.read_text()
s=s.replace("ipcMain.handle('photosync:migration-run',(_event,jobId:string)=>requireMigrationService().run(jobId));", "ipcMain.handle('photosync:migration-run',async(_event,jobId:string)=>{const service=requireMigrationService();void service.run(jobId).catch(error=>console.error('Migration run failed',jobId,error));return (await service.getSnapshot(jobId)).job});")
s=s.replace("ipcMain.handle('photosync:migration-resume',(_event,jobId:string)=>requireMigrationService().resume(jobId));", "ipcMain.handle('photosync:migration-resume',async(_event,jobId:string)=>{const service=requireMigrationService();void service.resume(jobId).catch(error=>console.error('Migration resume failed',jobId,error));return (await service.getSnapshot(jobId)).job});")
s=s.replace("ipcMain.handle('photosync:migration-retry',(_event,jobId:string)=>requireMigrationService().retryFailed(jobId));", "ipcMain.handle('photosync:migration-retry',async(_event,jobId:string)=>{const service=requireMigrationService();void service.retryFailed(jobId).catch(error=>console.error('Migration retry failed',jobId,error));return (await service.getSnapshot(jobId)).job});")
if s==p.read_text(): raise SystemExit('main live progress patch did not apply')
p.write_text(s)

p=Path('desktop/src/MigrationPage.tsx')
s=p.read_text()
needle="  useEffect(()=>{void refresh();if(!bridge)return;return bridge.onMigrationUpdated(next=>{setSnapshot(next);void refresh()})},[bridge]);\n"
addition="  useEffect(()=>{void refresh();if(!bridge)return;return bridge.onMigrationUpdated(next=>{setSnapshot(next);void refresh()})},[bridge]);\n  useEffect(()=>{if(!bridge||!snapshot||snapshot.job.state!=='running')return;const id=snapshot.job.id;const timer=setInterval(()=>{void bridge.getMigration(id).then(setSnapshot).catch(()=>undefined)},1500);return()=>clearInterval(timer)},[bridge,snapshot?.job.id,snapshot?.job.state]);\n"
if needle not in s: raise SystemExit('polling insertion point not found')
s=s.replace(needle,addition)
s=s.replace("  const percent=job?.totalItems?Math.round(job.completedItems/job.totalItems*100):0;", "  const completedCount=snapshot?.items.filter(item=>item.state==='completed').length??job?.completedItems??0;\n  const failedCount=snapshot?.items.filter(item=>item.state==='failed').length??job?.failedItems??0;\n  const transferredBytes=snapshot?.items.reduce((sum,item)=>sum+item.transferredBytes,0)??job?.transferredBytes??0;\n  const percent=job?.totalItems?Math.round(completedCount/job.totalItems*100):0;")
s=s.replace("<span>{job.completedItems}/{job.totalItems} hoàn tất</span><span>{job.failedItems} lỗi</span><span>{formatBytes(job.transferredBytes)} đã chuyển</span>", "<span>{completedCount}/{job.totalItems} hoàn tất</span><span>{failedCount} lỗi</span><span>{formatBytes(transferredBytes)} đã chuyển</span>")
s=s.replace("{job.failedItems>0&&<button onClick={()=>void retry()} disabled={busy}>Thử lại file lỗi</button>}", "{failedCount>0&&<button onClick={()=>void retry()} disabled={busy}>Thử lại file lỗi</button>}")
if s==p.read_text(): raise SystemExit('migration page live progress patch did not apply')
p.write_text(s)
