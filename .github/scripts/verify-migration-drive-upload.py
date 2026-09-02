from pathlib import Path
p=Path('desktop/electron/main.ts')
s=p.read_text()
s=s.replace("import { DRIVE_SCOPE, createResumableUploadSession, ensurePhotoSyncFolder, getStorageQuota, listPhotoSyncFiles } from '@photosync/google-drive';", "import { DRIVE_SCOPE, createResumableUploadSession, ensurePhotoSyncFolder, getDriveFile, getStorageQuota, listPhotoSyncFiles } from '@photosync/google-drive';")
old="""  const result=await uploaded.json() as {id?:string;webViewLink?:string};if(!result.id)throw new Error('GOOGLE_DRIVE_DESTINATION_ID_MISSING');
  return {targetId:result.id,targetUrl:result.webViewLink};
"""
new="""  const result=await uploaded.json() as {id?:string};if(!result.id)throw new Error('GOOGLE_DRIVE_DESTINATION_ID_MISSING');
  const verified=await getDriveFile(token.token,result.id);if(Number(verified.size||0)!==bytes.byteLength)throw new Error(`GOOGLE_DRIVE_SIZE_MISMATCH:${verified.size||0}:${bytes.byteLength}`);
  return {targetId:verified.id,targetUrl:verified.webViewLink};
"""
if old not in s: raise SystemExit('upload verification target not found')
s=s.replace(old,new)
p.write_text(s)
