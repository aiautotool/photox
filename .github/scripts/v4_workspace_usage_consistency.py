from pathlib import Path
p=Path('desktop/electron/main.ts')
s=p.read_text()
anchor="""async function bootstrapLegacyWorkspace(){\n  const repo=requireWorkspaceRepository();\n"""
if anchor not in s: raise SystemExit('bootstrap anchor missing')
helper="""async function syncWorkspaceProviderUsage(){\n  const repo=requireWorkspaceRepository();\n  const current=repo.getUsage(LEGACY_WORKSPACE_ID);\n  repo.setUsage(LEGACY_WORKSPACE_ID,{...current,storageProviders:(await savedDriveAccounts()).length});\n}\n\n"""
s=s.replace(anchor,helper+anchor,1)
connect_old="""      await fs.writeFile(path.join(driveAccountsDir(),`${id}.json`),JSON.stringify({id,email:email||id,tokens},null,2),'utf8');\n      res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<h2>Đã thêm Google Drive vào PhotoSync Laptop.</h2><p>Bạn có thể đóng tab này.</p>');server.close();\n      lastStatus={...lastStatus,message:'Đã thêm tài khoản Google Drive',driveAccounts:(await savedDriveAccounts()).length}; resolve(await desktopStatus());void retryQueuedCloud();\n"""
connect_new="""      await fs.writeFile(path.join(driveAccountsDir(),`${id}.json`),JSON.stringify({id,email:email||id,tokens},null,2),'utf8');\n      await syncWorkspaceProviderUsage();\n      requireWorkspaceRepository().appendAudit({workspaceId:LEGACY_WORKSPACE_ID,actorUserId:LEGACY_OWNER_USER_ID,actorDeviceId:LEGACY_DESKTOP_DEVICE_ID,action:'provider.connect',targetType:'google_drive',targetId:id,metadata:{email:email||id}});\n      res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<h2>Đã thêm Google Drive vào PhotoSync Laptop.</h2><p>Bạn có thể đóng tab này.</p>');server.close();\n      lastStatus={...lastStatus,message:'Đã thêm tài khoản Google Drive',driveAccounts:(await savedDriveAccounts()).length}; resolve(await desktopStatus());void retryQueuedCloud();\n"""
if connect_old not in s: raise SystemExit('connect snippet missing')
s=s.replace(connect_old,connect_new,1)
remove_old="""  for(const file of files)try{const saved:SavedDriveAccount=JSON.parse(await fs.readFile(path.join(driveAccountsDir(),file),'utf8'));if(saved.id===account.id)await fs.unlink(path.join(driveAccountsDir(),file))}catch{}\n  notifyRenderer('photosync:storage-updated',{accountId,removed:true});\n  return desktopStatus();\n"""
remove_new="""  for(const file of files)try{const saved:SavedDriveAccount=JSON.parse(await fs.readFile(path.join(driveAccountsDir(),file),'utf8'));if(saved.id===account.id)await fs.unlink(path.join(driveAccountsDir(),file))}catch{}\n  await syncWorkspaceProviderUsage();\n  requireWorkspaceRepository().appendAudit({workspaceId:LEGACY_WORKSPACE_ID,actorUserId:LEGACY_OWNER_USER_ID,actorDeviceId:LEGACY_DESKTOP_DEVICE_ID,action:'provider.disconnect',targetType:'google_drive',targetId:accountId,metadata:{email:account.email||account.id}});\n  notifyRenderer('photosync:storage-updated',{accountId,removed:true});\n  return desktopStatus();\n"""
if remove_old not in s: raise SystemExit('remove snippet missing')
s=s.replace(remove_old,remove_new,1)
delete_old="""  rows.splice(index,1);await writeIndex(rows);notifyRenderer('photosync:media-deleted',{key,filename:row.filename});return {deleted:true,key,filename:row.filename};\n"""
delete_new="""  rows.splice(index,1);await writeIndex(rows);\n  const repo=requireWorkspaceRepository();repo.releaseMediaReservation(LEGACY_WORKSPACE_ID,row.size,{releaseManaged:true,releaseIngress:false});\n  repo.appendAudit({workspaceId:LEGACY_WORKSPACE_ID,actorUserId:LEGACY_OWNER_USER_ID,actorDeviceId:LEGACY_DESKTOP_DEVICE_ID,action:'media.delete',targetType:'media',targetId:key,metadata:{filename:row.filename,size:row.size}});\n  notifyRenderer('photosync:media-deleted',{key,filename:row.filename});return {deleted:true,key,filename:row.filename};\n"""
if delete_old not in s: raise SystemExit('delete snippet missing')
s=s.replace(delete_old,delete_new,1)
p.write_text(s)
