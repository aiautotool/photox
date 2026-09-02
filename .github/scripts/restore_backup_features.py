from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# Durable backup settings
# -----------------------------------------------------------------------------
settings_path = Path('mobile/src/sync/backupSettings.ts')
settings_path.write_text("""import * as FileSystem from 'expo-file-system/legacy';

export interface BackupSettings {
  enabled: boolean;
  backupPhotos: boolean;
  backupVideos: boolean;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  backupPhotos: true,
  backupVideos: true,
};

const root = FileSystem.documentDirectory || FileSystem.cacheDirectory;
const SETTINGS_PATH = root ? `${root}photox-backup-settings.json` : null;
const TEMP_PATH = root ? `${root}photox-backup-settings.tmp.json` : null;
let writeQueue: Promise<void> = Promise.resolve();

function normalize(value: unknown): BackupSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_BACKUP_SETTINGS };
  const raw = value as Partial<BackupSettings>;
  return {
    enabled: raw.enabled !== false,
    backupPhotos: raw.backupPhotos !== false,
    backupVideos: raw.backupVideos !== false,
  };
}

export async function loadBackupSettings(): Promise<BackupSettings> {
  if (!SETTINGS_PATH) return { ...DEFAULT_BACKUP_SETTINGS };
  try {
    const info = await FileSystem.getInfoAsync(SETTINGS_PATH);
    if (!info.exists) return { ...DEFAULT_BACKUP_SETTINGS };
    return normalize(JSON.parse(await FileSystem.readAsStringAsync(SETTINGS_PATH)));
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}

export function saveBackupSettings(settings: BackupSettings): Promise<void> {
  const normalized = normalize(settings);
  writeQueue = writeQueue.then(async () => {
    if (!SETTINGS_PATH || !TEMP_PATH) return;
    await FileSystem.writeAsStringAsync(TEMP_PATH, JSON.stringify(normalized), { encoding: FileSystem.EncodingType.UTF8 });
    await FileSystem.deleteAsync(SETTINGS_PATH, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: TEMP_PATH, to: SETTINGS_PATH });
  });
  return writeQueue;
}
""", encoding='utf-8')

# -----------------------------------------------------------------------------
# Mobile sync: expose cloud key + delete endpoint client
# -----------------------------------------------------------------------------
mobile_sync_path = Path('mobile/src/sync/mobileSync.ts')
mobile_sync = mobile_sync_path.read_text(encoding='utf-8')
mobile_sync = replace_once(
    mobile_sync,
    "  cloudOnly?: boolean;\n  requestHeaders?: Record<string, string>;",
    "  cloudOnly?: boolean;\n  cloudKey?: string;\n  requestHeaders?: Record<string, string>;",
    'DisplayAsset cloudKey',
)
mobile_sync = replace_once(
    mobile_sync,
    "      cloudOnly: true,\n      mimeType: item.mimeType || mimeForFilename(item.filename, item.mediaType),",
    "      cloudOnly: true,\n      cloudKey: item.key,\n      mimeType: item.mimeType || mimeForFilename(item.filename, item.mediaType),",
    'cloud library key mapping',
)
anchor = "export type SyncProgress = {\n"
delete_fn = """export async function deleteCloudAsset(asset: DisplayAsset): Promise<void> {
  if (!asset.cloudOnly || !asset.cloudKey) throw new Error('Mục này không phải media cloud hợp lệ.');
  const base = asset.uri.replace(/\\/api\\/v1\\/(?:media|playback)\\/[^/]+(?:\\?.*)?$/, '');
  const endpoint = `${base}/api/v1/media/${encodeURIComponent(asset.cloudKey)}`;
  const response = await fetch(endpoint, { method: 'DELETE', headers: asset.requestHeaders });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Xóa cloud thất bại (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}

"""
mobile_sync = replace_once(mobile_sync, anchor, delete_fn + anchor, 'deleteCloudAsset insertion')
mobile_sync_path.write_text(mobile_sync, encoding='utf-8')

# -----------------------------------------------------------------------------
# Library controller: forget deleted cloud media from local metadata
# -----------------------------------------------------------------------------
controller_path = Path('mobile/src/library/LibraryController.ts')
controller = controller_path.read_text(encoding='utf-8')
controller = replace_once(
    controller,
    "  async favorite(mediaId: string) {\n",
    "  async forget(mediaId: string) {\n    await this.initialize();\n    return this.commit(forgetMedia(this.snapshot(), mediaId));\n  }\n\n  async favorite(mediaId: string) {\n",
    'controller forget method',
)
controller_path.write_text(controller, encoding='utf-8')

# -----------------------------------------------------------------------------
# Mobile home: restore detailed backup dashboard and real config
# -----------------------------------------------------------------------------
home_path = Path('mobile/src/home/MobileHome.tsx')
home = home_path.read_text(encoding='utf-8')
home = replace_once(home, "  downloadCloudAsset,\n", "  deleteCloudAsset,\n  downloadCloudAsset,\n", 'deleteCloudAsset import')
home = replace_once(
    home,
    "import { loadFailedAssets, loadSyncedAssetIds } from '../sync/syncLedger';\n",
    "import { loadFailedAssets, loadSyncedAssetIds } from '../sync/syncLedger';\nimport { loadBackupSettings, saveBackupSettings, type BackupSettings } from '../sync/backupSettings';\n",
    'backup settings import',
)
home = replace_once(
    home,
    "  const [backupEnabled,setBackupEnabled]=useState(true);\n  const [mobilePhotos,setMobilePhotos]=useState(true);\n  const [mobileVideos,setMobileVideos]=useState(false);\n",
    "  const [backupEnabled,setBackupEnabled]=useState(true);\n  const [backupPhotos,setBackupPhotos]=useState(true);\n  const [backupVideos,setBackupVideos]=useState(true);\n  const [backupSettingsLoaded,setBackupSettingsLoaded]=useState(false);\n",
    'backup settings state',
)
home = replace_once(
    home,
    "      const [assets,saved,synced,failed]=await Promise.all([loadDevicePhotos(500),loadPairedDesktop(),loadSyncedAssetIds(),loadFailedAssets()]);\n      setDevicePhotos(assets);setPhotos(assets);setTarget(saved);setSyncedIds(synced);setFailedAssets(failed);\n      if(saved){void refreshCloudLibrary(saved,assets);if(backupEnabled)void autoSync(saved,assets,true);}\n",
    "      const [assets,saved,synced,failed,backupSettings]=await Promise.all([loadDevicePhotos(500),loadPairedDesktop(),loadSyncedAssetIds(),loadFailedAssets(),loadBackupSettings()]);\n      setDevicePhotos(assets);setPhotos(assets);setTarget(saved);setSyncedIds(synced);setFailedAssets(failed);\n      setBackupEnabled(backupSettings.enabled);setBackupPhotos(backupSettings.backupPhotos);setBackupVideos(backupSettings.backupVideos);setBackupSettingsLoaded(true);\n      if(saved){void refreshCloudLibrary(saved,assets);if(backupSettings.enabled)void autoSync(saved,assets,true,backupSettings);}\n",
    'initial backup settings load',
)
home = replace_once(
    home,
    "  useEffect(()=>{\n    const sub=AppState.addEventListener('change',state=>{if(state==='active'&&target){void refreshCloudLibrary(target,devicePhotos);if(backupEnabled)void autoSync(target,devicePhotos,true);}});\n",
    "  useEffect(()=>{if(backupSettingsLoaded)void saveBackupSettings({enabled:backupEnabled,backupPhotos,backupVideos});},[backupSettingsLoaded,backupEnabled,backupPhotos,backupVideos]);\n\n  useEffect(()=>{\n    const sub=AppState.addEventListener('change',state=>{if(state==='active'&&target){void refreshCloudLibrary(target,devicePhotos);if(backupEnabled)void autoSync(target,devicePhotos,true);}});\n",
    'persist backup settings',
)
home = replace_once(
    home,
    "  const pendingCount=devicePhotos.filter(x=>!syncedIds.has(x.id)).length;\n",
    "  const backupEligible=(asset:MediaAsset)=>asset.mediaType==='video'?backupVideos:backupPhotos;\n  const pendingCount=devicePhotos.filter(x=>backupEligible(x)&&!syncedIds.has(x.id)).length;\n",
    'pending filtered by config',
)
home = replace_once(
    home,
    "  const backupLabel=!backupEnabled?'Sao lưu đang tắt':syncPhase==='syncing'?`Đang sao lưu ${progress?.total?`${doneCount}/${progress.total}`:''}`:failedCount?`${failedCount} mục lỗi`:!target?'Thiết lập sao lưu':!connected?'Đang chờ kết nối':pendingCount?`${pendingCount} mục đang chờ`:'Đã sao lưu xong';\n",
    "  const backupLabel=!backupEnabled?'Sao lưu đang tắt':syncPhase==='syncing'?`Đang sao lưu ${progress?.total?`${doneCount}/${progress.total}`:''}`:failedCount?`${failedCount} mục lỗi`:!target?'Thiết lập sao lưu':!connected?'Đang chờ kết nối':pendingCount?`${pendingCount} mục đang chờ`:'Đã sao lưu xong';\n  const currentBytesUploaded=progress?.currentBytesUploaded||0;\n  const currentBytesTotal=progress?.currentBytesTotal||0;\n  const currentBytesRemaining=progress?.currentBytesRemaining??Math.max(currentBytesTotal-currentBytesUploaded,0);\n  const currentBytePercent=currentBytesTotal?Math.min(100,Math.round(currentBytesUploaded/currentBytesTotal*100)):0;\n",
    'byte progress fields',
)
home = replace_once(
    home,
    "  const imageSource=(asset:DisplayAsset)=>({uri:asset.uri,headers:asset.requestHeaders});\n",
    "  const imageSource=(asset:DisplayAsset)=>({uri:asset.thumbnailUri||asset.uri,headers:asset.requestHeaders});\n",
    'video thumbnail source',
)
home = replace_once(
    home,
    "  async function autoSync(currentTarget:PairedDesktop,assets:MediaAsset[],retryFailed=false){\n    if(!backupEnabled||syncingRef.current)return;\n    const [knownSynced,knownFailed]=await Promise.all([loadSyncedAssetIds(),loadFailedAssets()]);\n    const pending=assets.filter(a=>!knownSynced.has(a.id)&&(retryFailed||!knownFailed[a.id]));",
    "  async function autoSync(currentTarget:PairedDesktop,assets:MediaAsset[],retryFailed=false,override?:BackupSettings){\n    const settings=override||{enabled:backupEnabled,backupPhotos,backupVideos};\n    if(!settings.enabled||syncingRef.current)return;\n    const [knownSynced,knownFailed]=await Promise.all([loadSyncedAssetIds(),loadFailedAssets()]);\n    const pending=assets.filter(a=>(a.mediaType==='video'?settings.backupVideos:settings.backupPhotos)&&!knownSynced.has(a.id)&&(retryFailed||!knownFailed[a.id]));",
    'autoSync config filtering',
)
home = replace_once(
    home,
    "  async function deletePermanently(asset:DisplayAsset){\n    if(asset.cloudOnly){Alert.alert('Chưa thể xóa bản cloud','Core chưa có delete endpoint an toàn; PhotoX giữ mục trong Thùng rác để không mất dữ liệu.');return;}\n",
    "  async function deletePermanently(asset:DisplayAsset){\n    if(asset.cloudOnly){Alert.alert('Xóa khỏi PhotoX Cloud?',`${asset.filename} sẽ bị xóa khỏi laptop và tất cả replica cloud đã quản lý. Thao tác này không thể hoàn tác.`,[{text:'Hủy',style:'cancel'},{text:'Xóa khỏi cloud',style:'destructive',onPress:()=>void (async()=>{try{await deleteCloudAsset(asset);await mobileLibraryController.forget(asset.id);setPhotos(old=>old.filter(x=>x.id!==asset.id));setViewer(null);setViewerInfo(false);setMessage('Đã xóa media khỏi PhotoX Cloud.');}catch(e){Alert.alert('Xóa cloud thất bại',e instanceof Error?e.message:String(e));}})()}]);return;}\n",
    'cloud permanent delete action',
)
old_backup = "{sheet==='backup'&&<><Text style={s.sheetTitle}>Sao lưu</Text><Text style={s.sheetBody}>{backupLabel}</Text><Pressable style={s.primary} onPress={toggleSync}><Text style={s.primaryText}>{syncPhase==='syncing'?'Tạm dừng':target?'Sao lưu ngay':'Thiết lập sao lưu'}</Text></Pressable></>}"
new_backup = """{sheet==='backup'&&<><Text style={s.sheetTitle}>Sao lưu</Text><Text style={s.sheetBody}>{backupLabel}</Text>{(syncPhase==='syncing'||syncPhase==='checking'||progress?.current)&&<View style={s.backupDetail}><Text style={s.backupCurrentLabel}>Đang tải lên</Text><Text style={s.backupCurrentFile} numberOfLines={1}>{progress?.current||'Đang chuẩn bị file…'}</Text><View style={s.backupByteRow}><Text style={s.backupByteText}>{formatBytes(currentBytesUploaded)||'0 MB'} / {formatBytes(currentBytesTotal)||'--'}</Text><Text style={s.backupByteText}>{currentBytePercent}%</Text></View><View style={s.backupTrack}><View style={[s.backupFill,{width:`${currentBytePercent}%`}]}/></View><Text style={s.backupRemaining}>Còn lại của file: {formatBytes(currentBytesRemaining)||'--'} • Hàng đợi: {Math.max((progress?.total||pendingCount)-doneCount,0)} file</Text>{progress?.lastError?<Text style={s.backupError}>{progress.lastError}</Text>:null}</View>}<View style={s.backupStats}><View><Text style={s.backupStatValue}>{progress?.completed||syncedIds.size}</Text><Text style={s.backupStatLabel}>Đã tải</Text></View><View><Text style={s.backupStatValue}>{pendingCount}</Text><Text style={s.backupStatLabel}>Đang chờ</Text></View><View><Text style={s.backupStatValue}>{failedCount}</Text><Text style={s.backupStatLabel}>Lỗi</Text></View></View><Pressable style={s.primary} onPress={toggleSync}><Text style={s.primaryText}>{syncPhase==='syncing'||syncPhase==='checking'?'Tạm dừng':target?'Sao lưu ngay':'Thiết lập sao lưu'}</Text></Pressable><Pressable style={s.textButton} onPress={()=>setSheet('settings')}><Text style={s.link}>Cấu hình tải lên</Text></Pressable></>}"""
home = replace_once(home, old_backup, new_backup, 'detailed backup sheet')
old_settings = "{sheet==='settings'&&<><Text style={s.sheetTitle}>Cài đặt sao lưu</Text><Setting label=\"Sao lưu\" value={backupEnabled} onChange={setBackupEnabled}/><Setting label=\"Dữ liệu di động cho ảnh\" value={mobilePhotos} onChange={setMobilePhotos}/><Setting label=\"Dữ liệu di động cho video\" value={mobileVideos} onChange={setMobileVideos}/></>}"
new_settings = "{sheet==='settings'&&<><Text style={s.sheetTitle}>Cấu hình tải lên</Text><Setting label=\"Tự động sao lưu\" value={backupEnabled} onChange={setBackupEnabled}/><Setting label=\"Sao lưu ảnh\" value={backupPhotos} onChange={setBackupPhotos}/><Setting label=\"Sao lưu video\" value={backupVideos} onChange={setBackupVideos}/><Text style={s.sheetBody}>Cấu hình được lưu trên thiết bị và áp dụng cho cả sao lưu tự động lẫn hàng đợi tiếp theo.</Text></>}"
home = replace_once(home, old_settings, new_settings, 'backup config sheet')
viewer_anchor = "{trashed.has(viewer.id)?<><Pressable style={s.primary} onPress={()=>void restoreAsset(viewer)}><Text style={s.primaryText}>Khôi phục</Text></Pressable><Pressable style={s.textButton} onPress={()=>void deletePermanently(viewer)}><Text style={s.danger}>Xóa vĩnh viễn</Text></Pressable></>:<Pressable style={s.textButton} onPress={()=>void mobileLibraryController.archive(viewer.id,!archived.has(viewer.id))}><Text style={s.link}>{archived.has(viewer.id)?'Bỏ lưu trữ':'Lưu trữ'}</Text></Pressable>}"
viewer_new = "{trashed.has(viewer.id)?<><Pressable style={s.primary} onPress={()=>void restoreAsset(viewer)}><Text style={s.primaryText}>Khôi phục</Text></Pressable><Pressable style={s.textButton} onPress={()=>void deletePermanently(viewer)}><Text style={s.danger}>Xóa vĩnh viễn</Text></Pressable></>:<><Pressable style={s.textButton} onPress={()=>void mobileLibraryController.archive(viewer.id,!archived.has(viewer.id))}><Text style={s.link}>{archived.has(viewer.id)?'Bỏ lưu trữ':'Lưu trữ'}</Text></Pressable>{viewer.cloudOnly&&<Pressable style={s.textButton} onPress={()=>void deletePermanently(viewer)}><Text style={s.danger}>Xóa khỏi cloud</Text></Pressable>}</>}"
home = replace_once(home, viewer_anchor, viewer_new, 'viewer cloud delete button')
style_anchor = "  modalShade:{flex:1,backgroundColor:'#0005'},sheet:{maxHeight:'80%',backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:18,paddingBottom:34},handle:{width:40,height:4,borderRadius:2,backgroundColor:'#ccc',alignSelf:'center',marginBottom:16},sheetTitle:{fontSize:22,fontWeight:'700',color:'#202124',marginBottom:14},sheetBody:{fontSize:14,color:'#666',marginBottom:12},primary:{height:48,borderRadius:24,backgroundColor:BLUE,alignItems:'center',justifyContent:'center',marginTop:10},primaryText:{color:'#fff',fontWeight:'700'},textButton:{height:44,alignItems:'center',justifyContent:'center'},albumInput:{height:48,borderRadius:12,borderWidth:1,borderColor:'#d4d7dc',paddingHorizontal:14,fontSize:16},menuRow:{height:54,flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#ddd'},menuText:{flex:1,fontSize:16,color:'#303238'},menuCount:{color:'#777'},settingRow:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#ddd'},settingLabel:{fontSize:15,color:'#303238'},\n"
style_new = "  modalShade:{flex:1,backgroundColor:'#0005'},sheet:{maxHeight:'80%',backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:18,paddingBottom:34},handle:{width:40,height:4,borderRadius:2,backgroundColor:'#ccc',alignSelf:'center',marginBottom:16},sheetTitle:{fontSize:22,fontWeight:'700',color:'#202124',marginBottom:14},sheetBody:{fontSize:14,color:'#666',marginBottom:12},backupDetail:{backgroundColor:'#f6f8fc',borderRadius:16,padding:14,marginVertical:8},backupCurrentLabel:{fontSize:12,color:'#6b7280',fontWeight:'700'},backupCurrentFile:{fontSize:15,color:'#202124',fontWeight:'700',marginTop:4},backupByteRow:{flexDirection:'row',justifyContent:'space-between',marginTop:12},backupByteText:{fontSize:12,color:'#4b5563',fontWeight:'600'},backupTrack:{height:8,borderRadius:4,backgroundColor:'#dce4f1',overflow:'hidden',marginTop:8},backupFill:{height:8,backgroundColor:BLUE,borderRadius:4},backupRemaining:{fontSize:12,color:'#666',marginTop:8},backupError:{fontSize:12,color:'#b3261e',marginTop:8},backupStats:{flexDirection:'row',justifyContent:'space-around',paddingVertical:12},backupStatValue:{fontSize:20,fontWeight:'800',color:'#202124',textAlign:'center'},backupStatLabel:{fontSize:11,color:'#777',marginTop:2},primary:{height:48,borderRadius:24,backgroundColor:BLUE,alignItems:'center',justifyContent:'center',marginTop:10},primaryText:{color:'#fff',fontWeight:'700'},textButton:{height:44,alignItems:'center',justifyContent:'center'},albumInput:{height:48,borderRadius:12,borderWidth:1,borderColor:'#d4d7dc',paddingHorizontal:14,fontSize:16},menuRow:{height:54,flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#ddd'},menuText:{flex:1,fontSize:16,color:'#303238'},menuCount:{color:'#777'},settingRow:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#ddd'},settingLabel:{fontSize:15,color:'#303238'},\n"
home = replace_once(home, style_anchor, style_new, 'backup styles')
home_path.write_text(home, encoding='utf-8')

# -----------------------------------------------------------------------------
# Desktop receiver: safe destructive cloud delete across managed replicas
# -----------------------------------------------------------------------------
main_path = Path('desktop/electron/main.ts')
main = main_path.read_text(encoding='utf-8')
insert_after = "async function fetchCloudMedia(row:MediaIndexRow,request:Request):Promise<Response>{\n"
# Insert before fetchCloudMedia to keep helper near delivery code.
delete_server_fn = """async function deleteManagedMedia(key:string){
  const rows=await readIndex();const index=rows.findIndex(row=>row.key===key);if(index<0)throw new Error('MEDIA_NOT_FOUND');const row=rows[index];
  const accounts=new Map((await savedDriveAccounts()).map(account=>[account.id,account]));const failures:string[]=[];
  for(const replica of replicasOf(row).filter(replica=>replica.remoteFileId)){
    if(!replica.accountId){failures.push('Replica thiếu accountId');continue;}
    const account=accounts.get(replica.accountId);if(!account){failures.push(`Không còn thông tin tài khoản ${replica.accountId}`);continue;}
    try{
      const client=oauthClient();client.setCredentials(account.tokens);const token=await client.getAccessToken();if(!token.token)throw new Error('Không lấy được access token');
      const response=await net.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(replica.remoteFileId!)}`,{method:'DELETE',headers:{authorization:`Bearer ${token.token}`}});
      if(!response.ok&&response.status!==404)throw new Error(`Drive ${response.status}: ${await response.text()}`);
    }catch(error){failures.push(`${replica.accountEmail||replica.accountId}: ${error instanceof Error?error.message:String(error)}`)}
  }
  if(failures.length)throw new Error(`Không xóa hết replica cloud: ${failures.join(' | ')}`);
  for(const filePath of [row.thumbnailPath,row.playbackPath,row.path])if(filePath)await fs.unlink(filePath).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error});
  rows.splice(index,1);await writeIndex(rows);notifyRenderer('photosync:media-deleted',{key,filename:row.filename});return {deleted:true,key,filename:row.filename};
}

"""
main = replace_once(main, insert_after, delete_server_fn + insert_after, 'desktop delete helper')
route_anchor = "    if(req.method==='GET'&&url.pathname.startsWith('/api/v1/media/')){\n"
delete_route = """    if(req.method==='DELETE'&&url.pathname.startsWith('/api/v1/media/')){
      const key=decodeURIComponent(url.pathname.slice('/api/v1/media/'.length));try{const result=await deleteManagedMedia(key);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}catch(error){const message=error instanceof Error?error.message:String(error);res.writeHead(message==='MEDIA_NOT_FOUND'?404:409,{'content-type':'application/json'});res.end(JSON.stringify({error:message}));}return;
    }
"""
main = replace_once(main, route_anchor, delete_route + route_anchor, 'desktop DELETE route')
main_path.write_text(main, encoding='utf-8')

# -----------------------------------------------------------------------------
# Docs
# -----------------------------------------------------------------------------
doc_path = Path('docs/IMPLEMENTATION_PLAN.md')
doc = doc_path.read_text(encoding='utf-8')
marker = "## Remaining work\n"
notes = """## Backup UI and cloud management restoration
- Detailed mobile upload progress restored using real native upload byte callbacks: current filename, uploaded bytes, total bytes, remaining bytes and queue count.
- Backup configuration is persisted on-device and controls automatic backup plus photo/video inclusion.
- Cloud-only assets can already be downloaded to the device; viewer keeps the original-download path even when compatibility playback uses a derivative.
- Added authenticated `DELETE /api/v1/media/:key`: managed Google Drive replicas are deleted first; local original/thumbnail/playback and catalog row are removed only after replica deletion succeeds.
- Mobile viewer exposes `Xóa khỏi cloud` with destructive confirmation and removes the deleted asset from local PhotoX metadata.

"""
doc = replace_once(doc, marker, notes + marker, 'docs backup restoration')
doc_path.write_text(doc, encoding='utf-8')

print('Backup restoration patch applied successfully.')
