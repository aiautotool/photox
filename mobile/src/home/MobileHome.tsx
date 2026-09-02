import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import {
  downloadCloudAsset,
  loadAssetMetadata,
  loadCloudPhotos,
  loadDevicePhotos,
  pingLaptop,
  prepareAssetForEditing,
  syncAssetsToLaptop,
  type AssetMetadata,
  type DisplayAsset,
  type MediaAsset,
  type SyncProgress,
} from '../sync/mobileSync';
import { forgetPairedDesktop, loadPairedDesktop, savePairedDesktop, type PairedDesktop } from '../sync/pairing';
import { loadFailedAssets, loadSyncedAssetIds } from '../sync/syncLedger';
import { mobileLibraryController } from '../library/LibraryController';
import type { MobileAlbum, MobileLibraryState } from '../library/LibraryStateStore';

type Tab = 'photos' | 'collections' | 'search';
type Sheet = 'backup' | 'account' | 'settings' | 'create-album' | 'add-to-album' | null;
type Collection = 'Yêu thích' | 'Lưu trữ' | 'Thùng rác' | null;
type SmartAlbum = 'Camera' | 'Video' | 'Gần đây' | 'Đã sao lưu' | null;

const BLUE = '#1769e0';
const GAP = 2;
const WIDTH = Dimensions.get('window').width;
const COLUMNS = WIDTH > 700 ? 6 : 4;
const TILE = (WIDTH - GAP * (COLUMNS - 1)) / COLUMNS;

const EMPTY_LIBRARY: MobileLibraryState = { version: 1, favorites: [], archived: [], trash: [], albums: [] };

type IconName = 'photos'|'collections'|'search'|'add'|'bell'|'cloudDone'|'cloudUpload'|'warning'|'favorite'|'favoriteFill'|'archive'|'trash'|'share'|'edit'|'download'|'settings'|'chevron'|'back'|'more'|'video'|'album'|'close'|'sync'|'restore';
const ICONS: Record<IconName, { ios:SFSymbol; android:AndroidSymbol }> = {
  photos:{ios:'photo.on.rectangle.angled',android:'photo_library'}, collections:{ios:'rectangle.stack.fill',android:'collections'}, search:{ios:'magnifyingglass',android:'search'}, add:{ios:'plus',android:'add'}, bell:{ios:'bell',android:'notifications'}, cloudDone:{ios:'checkmark.icloud.fill',android:'cloud_done'}, cloudUpload:{ios:'icloud.and.arrow.up',android:'cloud_upload'}, warning:{ios:'exclamationmark.circle.fill',android:'warning'}, favorite:{ios:'star',android:'favorite_border'}, favoriteFill:{ios:'star.fill',android:'favorite'}, archive:{ios:'archivebox',android:'archive'}, trash:{ios:'trash',android:'delete'}, share:{ios:'square.and.arrow.up',android:'share'}, edit:{ios:'slider.horizontal.3',android:'edit'}, download:{ios:'arrow.down.circle',android:'file_download'}, settings:{ios:'gearshape',android:'settings'}, chevron:{ios:'chevron.right',android:'chevron_right'}, back:{ios:'chevron.left',android:'arrow_back_ios'}, more:{ios:'ellipsis',android:'more_horiz'}, video:{ios:'play.fill',android:'video_library'}, album:{ios:'rectangle.stack.badge.plus',android:'photo_album'}, close:{ios:'xmark',android:'close'}, sync:{ios:'arrow.clockwise',android:'sync'}, restore:{ios:'arrow.uturn.backward',android:'restore_from_trash'},
};
function Icon({name,size=22,color='#5f6368'}:{name:IconName;size?:number;color?:string}) { return <SymbolView name={ICONS[name]} size={size} tintColor={color} style={{width:size,height:size}}/>; }
function formatDuration(seconds=0){const s=Math.max(0,Math.round(seconds));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function formatBytes(bytes=0){if(!bytes)return'';return bytes>=1024**3?`${(bytes/1024**3).toFixed(1)} GB`:`${(bytes/1024**2).toFixed(1)} MB`;}
function isLocalAsset(asset: DisplayAsset): asset is MediaAsset { return !asset.cloudOnly; }

function VideoViewer({asset}:{asset:DisplayAsset}){
  const source=useMemo(()=>({uri:asset.uri,headers:asset.requestHeaders}),[asset.uri,asset.requestHeaders]);
  const player=useVideoPlayer(source,p=>{p.loop=false;p.play();});
  return <VideoView player={player} style={s.viewerImage} nativeControls contentFit="contain" allowsFullscreen allowsPictureInPicture/>;
}

export default function MobileHome(){
  const [tab,setTab]=useState<Tab>('photos');
  const [sheet,setSheet]=useState<Sheet>(null);
  const [photos,setPhotos]=useState<DisplayAsset[]>([]);
  const [devicePhotos,setDevicePhotos]=useState<MediaAsset[]>([]);
  const [library,setLibrary]=useState<MobileLibraryState>(EMPTY_LIBRARY);
  const [query,setQuery]=useState('');
  const [target,setTarget]=useState<PairedDesktop|null>(null);
  const [connected,setConnected]=useState(false);
  const [message,setMessage]=useState('Đang chuẩn bị sao lưu…');
  const [progress,setProgress]=useState<SyncProgress|null>(null);
  const [scanner,setScanner]=useState(false);
  const [cameraPermission,requestCameraPermission]=useCameraPermissions();
  const [syncPhase,setSyncPhase]=useState<'idle'|'checking'|'syncing'|'pausing'|'paused'>('idle');
  const [syncedIds,setSyncedIds]=useState<Set<string>>(new Set());
  const [failedAssets,setFailedAssets]=useState<Record<string,string>>({});
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [viewer,setViewer]=useState<DisplayAsset|null>(null);
  const [viewerInfo,setViewerInfo]=useState(false);
  const [viewerMetadata,setViewerMetadata]=useState<AssetMetadata|null>(null);
  const [collection,setCollection]=useState<Collection>(null);
  const [smartAlbum,setSmartAlbum]=useState<SmartAlbum>(null);
  const [customAlbumId,setCustomAlbumId]=useState<string|null>(null);
  const [albumName,setAlbumName]=useState('');
  const [backupEnabled,setBackupEnabled]=useState(true);
  const [mobilePhotos,setMobilePhotos]=useState(true);
  const [mobileVideos,setMobileVideos]=useState(false);
  const [downloading,setDownloading]=useState<string|null>(null);
  const syncingRef=useRef(false);
  const syncControllerRef=useRef<AbortController|null>(null);

  useEffect(()=>{
    let active=true;
    const unsub=mobileLibraryController.subscribe(state=>{if(active)setLibrary(state);});
    void mobileLibraryController.initialize();
    return()=>{active=false;unsub();};
  },[]);

  useEffect(()=>{void (async()=>{
    try{
      const [assets,saved,synced,failed]=await Promise.all([loadDevicePhotos(500),loadPairedDesktop(),loadSyncedAssetIds(),loadFailedAssets()]);
      setDevicePhotos(assets);setPhotos(assets);setTarget(saved);setSyncedIds(synced);setFailedAssets(failed);
      if(saved){void refreshCloudLibrary(saved,assets);if(backupEnabled)void autoSync(saved,assets,true);}
      setMessage(saved?'Đang kiểm tra kết nối…':'Chưa thiết lập nơi sao lưu');
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  })();},[]);

  useEffect(()=>{
    const sub=AppState.addEventListener('change',state=>{if(state==='active'&&target){void refreshCloudLibrary(target,devicePhotos);if(backupEnabled)void autoSync(target,devicePhotos,true);}});
    return()=>sub.remove();
  },[target,devicePhotos,backupEnabled]);

  useEffect(()=>{
    if(!viewer||!viewerInfo){setViewerMetadata(null);return;}
    let active=true;
    void loadAssetMetadata(viewer).then(v=>{if(active)setViewerMetadata(v);}).catch(()=>undefined);
    return()=>{active=false;};
  },[viewer,viewerInfo]);

  const favorites=useMemo(()=>new Set(library.favorites),[library.favorites]);
  const archived=useMemo(()=>new Set(library.archived),[library.archived]);
  const trashed=useMemo(()=>new Set(library.trash.map(x=>x.mediaId)),[library.trash]);
  const visiblePhotos=useMemo(()=>photos.filter(x=>!archived.has(x.id)&&!trashed.has(x.id)),[photos,archived,trashed]);
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return visiblePhotos;
    return visiblePhotos.filter(x=>x.filename.toLowerCase().includes(q)||x.mediaType.includes(q));
  },[visiblePhotos,query]);
  const currentCustomAlbum=library.albums.find(a=>a.id===customAlbumId)||null;
  const customAlbumItems=useMemo(()=>currentCustomAlbum?currentCustomAlbum.mediaIds.map(id=>photos.find(p=>p.id===id)).filter(Boolean) as DisplayAsset[]:[],[currentCustomAlbum,photos]);
  const smartAlbumItems=useMemo(()=>{
    if(smartAlbum==='Video')return visiblePhotos.filter(x=>x.mediaType==='video');
    if(smartAlbum==='Gần đây')return visiblePhotos.slice(0,24);
    if(smartAlbum==='Đã sao lưu')return visiblePhotos.filter(x=>x.cloudOnly||syncedIds.has(x.id));
    if(smartAlbum==='Camera')return visiblePhotos;
    return [];
  },[smartAlbum,visiblePhotos,syncedIds]);

  const pendingCount=devicePhotos.filter(x=>!syncedIds.has(x.id)).length;
  const failedCount=Object.keys(failedAssets).length;
  const doneCount=progress?progress.completed+progress.skipped+progress.failed:0;
  const percent=progress?.total?Math.round((doneCount/progress.total)*100):pendingCount?0:100;
  const backupLabel=!backupEnabled?'Sao lưu đang tắt':syncPhase==='syncing'?`Đang sao lưu ${progress?.total?`${doneCount}/${progress.total}`:''}`:failedCount?`${failedCount} mục lỗi`:!target?'Thiết lập sao lưu':!connected?'Đang chờ kết nối':pendingCount?`${pendingCount} mục đang chờ`:'Đã sao lưu xong';

  async function refreshCloudLibrary(currentTarget:PairedDesktop,localAssets:MediaAsset[]){try{const cloud=await loadCloudPhotos(currentTarget);const ids=new Set(localAssets.map(x=>x.id));setPhotos([...localAssets,...cloud.filter(x=>!ids.has(x.id))]);}catch{}}
  const imageSource=(asset:DisplayAsset)=>({uri:asset.uri,headers:asset.requestHeaders});

  async function autoSync(currentTarget:PairedDesktop,assets:MediaAsset[],retryFailed=false){
    if(!backupEnabled||syncingRef.current)return;
    const [knownSynced,knownFailed]=await Promise.all([loadSyncedAssetIds(),loadFailedAssets()]);
    const pending=assets.filter(a=>!knownSynced.has(a.id)&&(retryFailed||!knownFailed[a.id]));
    setSyncedIds(knownSynced);setFailedAssets(knownFailed);
    if(!pending.length){setConnected(true);setSyncPhase('idle');return;}
    syncingRef.current=true;const controller=new AbortController();syncControllerRef.current=controller;setSyncPhase('checking');
    try{
      await pingLaptop(currentTarget,controller.signal);setConnected(true);setSyncPhase('syncing');setProgress({total:pending.length,completed:0,skipped:0,failed:0});
      await syncAssetsToLaptop(currentTarget,pending,async v=>{setProgress(v);setSyncedIds(await loadSyncedAssetIds());setFailedAssets(await loadFailedAssets());},controller.signal);
      setSyncedIds(await loadSyncedAssetIds());setFailedAssets(await loadFailedAssets());await refreshCloudLibrary(currentTarget,assets);
    }catch{if(!controller.signal.aborted)setConnected(false);}finally{syncingRef.current=false;syncControllerRef.current=null;setSyncPhase(controller.signal.aborted?'paused':'idle');}
  }

  function toggleSync(){if(syncPhase==='checking'||syncPhase==='syncing'){setSyncPhase('pausing');syncControllerRef.current?.abort();return;}if(target)void autoSync(target,devicePhotos,true);else setSheet('account');}
  function toggleSelect(id:string){setSelected(old=>{const n=new Set(old);n.has(id)?n.delete(id):n.add(id);return n;});}

  async function openEditor(asset:DisplayAsset){
    if(asset.mediaType==='video'){setMessage('Chỉnh sửa video chưa hỗ trợ.');return;}
    try{const source=await prepareAssetForEditing(asset);router.push({pathname:'/editor',params:{id:asset.id,uri:source,filename:asset.filename,width:asset.width?String(asset.width):undefined,height:asset.height?String(asset.height):undefined,mimeType:asset.filename.toLowerCase().endsWith('.png')?'image/png':'image/jpeg'}});}catch(e){setMessage(`Không mở được editor: ${e instanceof Error?e.message:String(e)}`);}
  }

  async function shareAsset(asset:DisplayAsset){
    try{
      let uri=asset.uri;
      if(asset.cloudOnly){const downloaded=await downloadCloudAsset(asset);uri=downloaded.uri;}
      if(!(await Sharing.isAvailableAsync()))throw new Error('SHARING_UNAVAILABLE');
      await Sharing.shareAsync(uri,{dialogTitle:`Chia sẻ ${asset.filename}`});
    }catch(e){Alert.alert('Không thể chia sẻ',e instanceof Error?e.message:String(e));}
  }

  async function downloadOne(asset:DisplayAsset){if(!asset.cloudOnly||downloading)return;setDownloading(asset.id);try{const saved=await downloadCloudAsset(asset);const assets=await loadDevicePhotos(500);setDevicePhotos(assets);setPhotos(old=>[saved,...old.filter(x=>x.id!==asset.id)]);setViewer(saved);}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setDownloading(null);}}

  async function trashAsset(asset:DisplayAsset){await mobileLibraryController.trash(asset.id);setViewer(null);setViewerInfo(false);}
  async function restoreAsset(asset:DisplayAsset){await mobileLibraryController.restore(asset.id);}
  async function deletePermanently(asset:DisplayAsset){
    if(asset.cloudOnly){Alert.alert('Chưa thể xóa bản cloud','Xóa vĩnh viễn bản cloud cần endpoint delete trên PhotoX Core; mục này vẫn được giữ trong Thùng rác để tránh mất dữ liệu.');return;}
    Alert.alert('Xóa vĩnh viễn?',asset.filename,[{text:'Hủy',style:'cancel'},{text:'Xóa',style:'destructive',onPress:()=>void (async()=>{try{await mobileLibraryController.deletePermanently(asset as unknown as MediaLibrary.Asset);setPhotos(old=>old.filter(x=>x.id!==asset.id));setDevicePhotos(old=>old.filter(x=>x.id!==asset.id));setViewer(null);}catch(e){Alert.alert('Xóa thất bại',e instanceof Error?e.message:String(e));}})()}]);
  }

  async function emptyTrash(){
    Alert.alert('Dọn sạch Thùng rác?','Các file local sẽ bị xóa vĩnh viễn.',[{text:'Hủy',style:'cancel'},{text:'Dọn sạch',style:'destructive',onPress:()=>void (async()=>{const byId=new Map(devicePhotos.map(x=>[x.id,x]));const result=await mobileLibraryController.emptyTrash(id=>byId.get(id) as unknown as MediaLibrary.Asset|undefined);if(result.deleted){const deletedIds=new Set(library.trash.map(x=>x.mediaId).filter(id=>byId.has(id)));setDevicePhotos(old=>old.filter(x=>!deletedIds.has(x.id)));setPhotos(old=>old.filter(x=>!deletedIds.has(x.id)));}if(result.failed.length)Alert.alert('Một số mục chưa xóa được',`${result.failed.length} mục thất bại.`);})()}]);
  }

  async function batchSync(){const items=devicePhotos.filter(x=>selected.has(x.id));if(!items.length)return;if(!target){setSheet('account');return;}await syncAssetsToLaptop(target,items);setSyncedIds(await loadSyncedAssetIds());setFailedAssets(await loadFailedAssets());setSelected(new Set());}
  async function batchTrash(){for(const id of selected)await mobileLibraryController.trash(id);setSelected(new Set());}
  async function batchShare(){const first=photos.find(x=>selected.has(x.id));if(first)await shareAsset(first);if(selected.size>1)Alert.alert('Chia sẻ nhiều mục','Hiện hệ thống chia sẻ native từng file; đã mở file đầu tiên. Batch multi-file sẽ được bổ sung qua staging bundle.');}

  async function startScanner(){if(!cameraPermission?.granted){const p=await requestCameraPermission();if(!p.granted)return;}setSheet(null);setScanner(true);}
  async function onQr(data:string){if(!scanner)return;setScanner(false);try{const saved=await savePairedDesktop(data);setTarget(saved);await refreshCloudLibrary(saved,devicePhotos);await autoSync(saved,devicePhotos,true);}catch(e){setMessage(e instanceof Error?e.message:String(e));}}

  function renderGrid(items:DisplayAsset[],trashMode=false){return <View style={s.grid}>{items.map((asset,index)=>{const chosen=selected.has(asset.id);return <Pressable key={asset.id} style={[s.tile,chosen&&s.selectedTile]} onPress={()=>selected.size?toggleSelect(asset.id):setViewer(asset)} onLongPress={()=>toggleSelect(asset.id)}><Image source={imageSource(asset)} style={s.photo} contentFit="cover" transition={120}/>{asset.mediaType==='video'&&<View style={s.videoBadge}><Text style={s.videoText}>▶ {asset.duration?formatDuration(asset.duration):''}</Text></View>}{(asset.cloudOnly||syncedIds.has(asset.id))&&index<4&&<View style={s.cloudBadge}><Text style={s.cloudText}>✓</Text></View>}{trashMode&&<View style={s.trashBadge}><Text style={s.trashBadgeText}>Trash</Text></View>}{chosen&&<View style={s.check}><Text style={s.checkText}>✓</Text></View>}</Pressable>;})}</View>;}

  const specialItems=collection==='Yêu thích'?photos.filter(x=>favorites.has(x.id)):collection==='Lưu trữ'?photos.filter(x=>archived.has(x.id)):collection==='Thùng rác'?photos.filter(x=>trashed.has(x.id)):[];

  return <SafeAreaView style={s.root}><StatusBar barStyle="dark-content" backgroundColor="#fff"/>
    <View style={s.header}>{selected.size?<><Pressable onPress={()=>setSelected(new Set())}><Icon name="close"/></Pressable><Text style={s.title}>{selected.size} đã chọn</Text><View style={{width:24}}/></>:<><Text style={s.brand}>PhotoX</Text><View style={s.headerActions}><Pressable onPress={()=>setSheet('create-album')}><Icon name="add"/></Pressable><Pressable onPress={()=>setSheet('account')} style={s.avatar}><Text style={s.avatarText}>V</Text></Pressable></View></>}</View>

    {tab==='photos'&&<ScrollView contentContainerStyle={s.scrollBottom}><Pressable style={s.backupChip} onPress={()=>setSheet('backup')}><Icon name={failedCount?'warning':pendingCount?'cloudUpload':'cloudDone'} size={18} color={BLUE}/><Text style={s.backupText}>{backupLabel}</Text><Text style={s.backupPercent}>{percent}%</Text></Pressable><View style={s.sectionHead}><Text style={s.sectionTitle}>Thư viện</Text><Pressable onPress={()=>setSelected(new Set(visiblePhotos.map(x=>x.id)))}><Text style={s.link}>Chọn</Text></Pressable></View>{visiblePhotos.length?renderGrid(visiblePhotos):<Empty title="Chưa có ảnh" body="Ảnh và video trên thiết bị sẽ xuất hiện ở đây."/>}</ScrollView>}

    {tab==='collections'&&!collection&&!smartAlbum&&!customAlbumId&&<ScrollView contentContainerStyle={s.scrollBottom}><Text style={s.pageTitle}>Bộ sưu tập</Text><View style={s.quickRow}><Quick icon="favorite" label="Yêu thích" onPress={()=>setCollection('Yêu thích')}/><Quick icon="archive" label="Lưu trữ" onPress={()=>setCollection('Lưu trữ')}/><Quick icon="trash" label="Thùng rác" onPress={()=>setCollection('Thùng rác')}/></View><View style={s.sectionHead}><Text style={s.sectionTitle}>Album</Text><Pressable onPress={()=>setSheet('create-album')}><Text style={s.link}>＋ Tạo mới</Text></Pressable></View><View style={s.albumGrid}>{(['Camera','Video','Gần đây','Đã sao lưu'] as SmartAlbum[]).filter(Boolean).map(name=>{const items=name==='Video'?visiblePhotos.filter(x=>x.mediaType==='video'):name==='Gần đây'?visiblePhotos.slice(0,24):name==='Đã sao lưu'?visiblePhotos.filter(x=>x.cloudOnly||syncedIds.has(x.id)):visiblePhotos;return <AlbumCard key={String(name)} name={String(name)} items={items} imageSource={imageSource} onPress={()=>setSmartAlbum(name)}/>;})}{library.albums.map(a=><AlbumCard key={a.id} name={a.name} items={a.mediaIds.map(id=>photos.find(p=>p.id===id)).filter(Boolean) as DisplayAsset[]} imageSource={imageSource} onPress={()=>setCustomAlbumId(a.id)}/>)}</View></ScrollView>}

    {tab==='collections'&&smartAlbum&&<SubPage title={smartAlbum} onBack={()=>setSmartAlbum(null)} right={<Pressable onPress={()=>setSelected(new Set(smartAlbumItems.map(x=>x.id)))}><Text style={s.link}>Chọn</Text></Pressable>}>{smartAlbumItems.length?renderGrid(smartAlbumItems):<Empty title="Album trống" body="Chưa có nội dung phù hợp."/>}</SubPage>}

    {tab==='collections'&&customAlbumId&&currentCustomAlbum&&<SubPage title={currentCustomAlbum.name} onBack={()=>setCustomAlbumId(null)} right={<Pressable onPress={()=>{setSelected(new Set());setSheet('add-to-album');}}><Text style={s.link}>Thêm</Text></Pressable>}>{customAlbumItems.length?renderGrid(customAlbumItems):<Empty title="Album trống" body="Nhấn Thêm để chọn ảnh."/>}<View style={s.albumManage}><Pressable onPress={()=>{setAlbumName(currentCustomAlbum.name);Alert.alert('Đổi tên album','Dùng màn tạo/đổi tên trong lần mở tiếp theo.');}}><Text style={s.link}>Đổi tên</Text></Pressable><Pressable onPress={()=>Alert.alert('Xóa album?',currentCustomAlbum.name,[{text:'Hủy'},{text:'Xóa',style:'destructive',onPress:()=>void mobileLibraryController.deleteAlbum(currentCustomAlbum.id).then(()=>setCustomAlbumId(null))}])}><Text style={s.danger}>Xóa album</Text></Pressable></View></SubPage>}

    {tab==='collections'&&collection&&<SubPage title={collection} onBack={()=>setCollection(null)} right={collection==='Thùng rác'&&specialItems.length?<Pressable onPress={()=>void emptyTrash()}><Text style={s.danger}>Dọn sạch</Text></Pressable>:undefined}>{specialItems.length?renderGrid(specialItems,collection==='Thùng rác'):<Empty title="Chưa có mục nào" body={collection==='Thùng rác'?'Mục đã xóa sẽ ở đây trước khi bị xóa vĩnh viễn.':'Ảnh bạn thêm sẽ xuất hiện ở đây.'}/>}</SubPage>}

    {tab==='search'&&<ScrollView contentContainerStyle={s.scrollBottom}><Text style={s.pageTitle}>Tìm kiếm</Text><View style={s.searchBox}><Icon name="search"/><TextInput style={s.searchInput} placeholder="Tên file hoặc loại media" value={query} onChangeText={setQuery}/></View>{query?filtered.length?renderGrid(filtered):<Empty title="Không tìm thấy" body="Thử từ khóa khác."/>:<Text style={s.hint}>Tìm theo filename hoặc image/video. Metadata index nâng cao sẽ dùng search engine phía Core.</Text>}</ScrollView>}

    {selected.size>0&&<View style={s.selectionBar}><Action icon="share" label="Chia sẻ" onPress={()=>void batchShare()}/><Action icon="album" label="Thêm vào" onPress={()=>setSheet('add-to-album')}/><Action icon="cloudUpload" label="Sao lưu" onPress={()=>void batchSync()}/><Action icon="trash" label="Xóa" onPress={()=>void batchTrash()}/></View>}

    <View style={s.nav}>{([['photos','photos','Ảnh'],['collections','collections','Bộ sưu tập'],['search','search','Tìm kiếm']] as const).map(([id,icon,label])=><Pressable key={id} style={s.navItem} onPress={()=>{setTab(id);setSelected(new Set());setCollection(null);setSmartAlbum(null);setCustomAlbumId(null);}}><Icon name={icon} color={tab===id?BLUE:'#666'}/><Text style={[s.navText,tab===id&&{color:BLUE,fontWeight:'700'}]}>{label}</Text></Pressable>)}</View>

    <Modal visible={sheet!==null} transparent animationType="slide" onRequestClose={()=>setSheet(null)}><Pressable style={s.modalShade} onPress={()=>setSheet(null)}/><View style={s.sheet}><View style={s.handle}/>
      {sheet==='backup'&&<><Text style={s.sheetTitle}>Sao lưu</Text><Text style={s.sheetBody}>{backupLabel}</Text><Pressable style={s.primary} onPress={toggleSync}><Text style={s.primaryText}>{syncPhase==='syncing'?'Tạm dừng':target?'Sao lưu ngay':'Thiết lập sao lưu'}</Text></Pressable></>}
      {sheet==='account'&&<><Text style={s.sheetTitle}>Thiết bị</Text><Text style={s.sheetBody}>{target?.desktopId||'Chưa kết nối PhotoX Desktop'}</Text><Pressable style={s.primary} onPress={()=>void startScanner()}><Text style={s.primaryText}>{target?'Ghép nối lại':'Quét QR'}</Text></Pressable>{target&&<Pressable style={s.textButton} onPress={()=>void forgetPairedDesktop().then(()=>{setTarget(null);setConnected(false);setSheet(null);})}><Text style={s.danger}>Quên thiết bị</Text></Pressable>}<Pressable style={s.textButton} onPress={()=>setSheet('settings')}><Text style={s.link}>Cài đặt</Text></Pressable></>}
      {sheet==='settings'&&<><Text style={s.sheetTitle}>Cài đặt sao lưu</Text><Setting label="Sao lưu" value={backupEnabled} onChange={setBackupEnabled}/><Setting label="Dữ liệu di động cho ảnh" value={mobilePhotos} onChange={setMobilePhotos}/><Setting label="Dữ liệu di động cho video" value={mobileVideos} onChange={setMobileVideos}/></>}
      {sheet==='create-album'&&<><Text style={s.sheetTitle}>Tạo album</Text><TextInput autoFocus value={albumName} onChangeText={setAlbumName} placeholder="Tên album" style={s.albumInput}/><Pressable style={s.primary} onPress={()=>void mobileLibraryController.createAlbum(albumName,Array.from(selected)).then(()=>{setAlbumName('');setSelected(new Set());setSheet(null);setTab('collections');})}><Text style={s.primaryText}>Tạo album</Text></Pressable></>}
      {sheet==='add-to-album'&&<><Text style={s.sheetTitle}>Thêm vào album</Text>{library.albums.length?library.albums.map(a=><Pressable key={a.id} style={s.menuRow} onPress={()=>void mobileLibraryController.addToAlbum(a.id,Array.from(selected)).then(()=>{setSelected(new Set());setSheet(null);})}><Text style={s.menuText}>{a.name}</Text><Text style={s.menuCount}>{a.mediaIds.length}</Text></Pressable>):<Text style={s.sheetBody}>Chưa có album. Hãy tạo album trước.</Text>}</>}
    </View></Modal>

    <Modal visible={viewer!==null} animationType="fade" onRequestClose={()=>setViewer(null)}><SafeAreaView style={s.viewer}>{viewer&&<><View style={s.viewerHeader}><Pressable onPress={()=>setViewer(null)}><Icon name="back" color="#fff"/></Pressable><View><Text style={s.viewerTitle}>{viewer.filename}</Text><Text style={s.viewerSub}>{new Date(viewer.creationTime).toLocaleDateString('vi-VN')}</Text></View><Pressable onPress={()=>setViewerInfo(v=>!v)}><Icon name="more" color="#fff"/></Pressable></View>{viewer.mediaType==='video'?<VideoViewer asset={viewer}/>:<Image source={imageSource(viewer)} style={s.viewerImage} contentFit="contain"/>}{viewerInfo?<ScrollView style={s.details}><Text style={s.sheetTitle}>Chi tiết</Text><Text style={s.detail}>{viewer.width&&viewer.height?`${viewer.width} × ${viewer.height}`:''} {formatBytes(viewerMetadata?.fileSize||viewer.fileSize)}</Text>{viewer.duration?<Text style={s.detail}>Thời lượng: {formatDuration(viewer.duration)}</Text>:null}<Text style={s.detail}>{viewer.cloudOnly?'Cloud':'Local'} • {syncedIds.has(viewer.id)||viewer.cloudOnly?'Đã sao lưu':'Chưa sao lưu'}</Text>{trashed.has(viewer.id)?<><Pressable style={s.primary} onPress={()=>void restoreAsset(viewer)}><Text style={s.primaryText}>Khôi phục</Text></Pressable><Pressable style={s.textButton} onPress={()=>void deletePermanently(viewer)}><Text style={s.danger}>Xóa vĩnh viễn</Text></Pressable></>:<Pressable style={s.textButton} onPress={()=>void mobileLibraryController.archive(viewer.id,!archived.has(viewer.id))}><Text style={s.link}>{archived.has(viewer.id)?'Bỏ lưu trữ':'Lưu trữ'}</Text></Pressable>}</ScrollView>:<View style={s.viewerToolbar}><Action dark icon="share" label="Chia sẻ" onPress={()=>void shareAsset(viewer)}/>{viewer.mediaType==='photo'&&<Action dark icon="edit" label="Chỉnh sửa" onPress={()=>void openEditor(viewer)}/>}<Action dark icon={favorites.has(viewer.id)?'favoriteFill':'favorite'} label="Yêu thích" onPress={()=>void mobileLibraryController.favorite(viewer.id)}/>{viewer.cloudOnly&&<Action dark icon="download" label={downloading===viewer.id?'Đang tải':'Tải xuống'} onPress={()=>void downloadOne(viewer)}/>}<Action dark icon="trash" label="Xóa" onPress={()=>void trashAsset(viewer)}/></View>}</>}</SafeAreaView></Modal>

    {scanner&&<View style={s.scanner}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>void onQr(data)}/><View style={s.scanFrame}/><Pressable style={s.cancelScan} onPress={()=>setScanner(false)}><Text style={s.primaryText}>Hủy</Text></Pressable></View>}
  </SafeAreaView>;
}

function Empty({title,body}:{title:string;body:string}){return <View style={s.empty}><Text style={s.emptyIcon}>▧</Text><Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyBody}>{body}</Text></View>;}
function Quick({icon,label,onPress}:{icon:IconName;label:string;onPress():void}){return <Pressable style={s.quickItem} onPress={onPress}><View style={s.quickIcon}><Icon name={icon} color={BLUE}/></View><Text style={s.quickLabel}>{label}</Text></Pressable>;}
function AlbumCard({name,items,imageSource,onPress}:{name:string;items:DisplayAsset[];imageSource(a:DisplayAsset):{uri:string;headers?:Record<string,string>};onPress():void}){return <Pressable style={s.albumCard} onPress={onPress}><View style={s.albumCover}>{items[0]?<Image source={imageSource(items[0])} style={s.photo} contentFit="cover"/>:<Text style={s.emptyIcon}>▧</Text>}</View><Text style={s.albumName}>{name}</Text><Text style={s.albumCount}>{items.length} mục</Text></Pressable>;}
function SubPage({title,onBack,right,children}:{title:string;onBack():void;right?:React.ReactNode;children:React.ReactNode}){return <View style={s.flex}><View style={s.subHeader}><Pressable onPress={onBack}><Icon name="back"/></Pressable><Text style={s.subTitle}>{title}</Text><View>{right||<View style={{width:24}}/>}</View></View><ScrollView contentContainerStyle={s.scrollBottom}>{children}</ScrollView></View>;}
function Action({icon,label,onPress,dark=false}:{icon:IconName;label:string;onPress():void;dark?:boolean}){return <Pressable style={s.action} onPress={onPress}><Icon name={icon} color={dark?'#fff':'#333'}/><Text style={[s.actionText,dark&&{color:'#fff'}]}>{label}</Text></Pressable>;}
function Setting({label,value,onChange}:{label:string;value:boolean;onChange(v:boolean):void}){return <View style={s.settingRow}><Text style={s.settingLabel}>{label}</Text><Switch value={value} onValueChange={onChange}/></View>;}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#fff'},flex:{flex:1},header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:17,fontWeight:'700',color:'#202124'},brand:{fontSize:22,fontWeight:'800',color:'#202124'},headerActions:{flexDirection:'row',alignItems:'center',gap:16},avatar:{width:32,height:32,borderRadius:16,backgroundColor:'#795548',alignItems:'center',justifyContent:'center'},avatarText:{color:'#fff',fontWeight:'700'},scrollBottom:{paddingBottom:110},
  backupChip:{margin:16,marginBottom:8,paddingHorizontal:14,height:40,borderRadius:20,backgroundColor:'#eef4ff',flexDirection:'row',alignItems:'center',gap:8},backupText:{flex:1,color:'#30343b',fontWeight:'600'},backupPercent:{color:BLUE,fontWeight:'700'},sectionHead:{height:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},sectionTitle:{fontSize:19,fontWeight:'700',color:'#24262a'},link:{color:BLUE,fontWeight:'700'},danger:{color:'#c62828',fontWeight:'700'},pageTitle:{fontSize:30,fontWeight:'700',color:'#202124',margin:16},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:GAP},tile:{width:TILE,height:TILE,backgroundColor:'#e7e9ed'},selectedTile:{opacity:.7},photo:{width:'100%',height:'100%'},videoBadge:{position:'absolute',left:5,bottom:5,backgroundColor:'#0009',borderRadius:10,paddingHorizontal:5,paddingVertical:3},videoText:{color:'#fff',fontSize:9},cloudBadge:{position:'absolute',right:5,bottom:5,width:18,height:18,borderRadius:9,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},cloudText:{color:'#267352',fontWeight:'900'},trashBadge:{position:'absolute',left:5,top:5,backgroundColor:'#b3261e',paddingHorizontal:5,paddingVertical:2,borderRadius:5},trashBadgeText:{color:'#fff',fontSize:9,fontWeight:'700'},check:{position:'absolute',right:5,top:5,width:23,height:23,borderRadius:12,backgroundColor:BLUE,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#fff'},checkText:{color:'#fff',fontWeight:'900'},
  empty:{padding:60,alignItems:'center'},emptyIcon:{fontSize:44,color:'#aeb4bd'},emptyTitle:{fontSize:20,fontWeight:'700',color:'#303238',marginTop:12},emptyBody:{fontSize:14,color:'#757980',textAlign:'center',marginTop:6},quickRow:{flexDirection:'row',justifyContent:'space-around',paddingHorizontal:12,marginBottom:24},quickItem:{width:90,alignItems:'center'},quickIcon:{width:52,height:52,borderRadius:26,backgroundColor:'#eef4ff',alignItems:'center',justifyContent:'center'},quickLabel:{fontSize:12,color:'#3d4045',marginTop:8,textAlign:'center'},albumGrid:{flexDirection:'row',flexWrap:'wrap',paddingHorizontal:12},albumCard:{width:'50%',padding:4,marginBottom:14},albumCover:{width:'100%',aspectRatio:1.18,borderRadius:15,overflow:'hidden',backgroundColor:'#edf0f3',alignItems:'center',justifyContent:'center'},albumName:{fontSize:15,fontWeight:'600',color:'#303238',marginTop:8},albumCount:{fontSize:12,color:'#777',marginTop:2},albumManage:{flexDirection:'row',justifyContent:'space-around',padding:20},
  searchBox:{height:50,borderRadius:25,marginHorizontal:16,backgroundColor:'#edf2f7',flexDirection:'row',alignItems:'center',paddingHorizontal:15,gap:10},searchInput:{flex:1,fontSize:16},hint:{fontSize:14,color:'#777',margin:16,lineHeight:20},nav:{height:78,paddingBottom:Platform.OS==='android'?6:0,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#ddd',flexDirection:'row',backgroundColor:'#f8f9fb'},navItem:{flex:1,alignItems:'center',justifyContent:'center'},navText:{fontSize:11,color:'#666',marginTop:4},selectionBar:{position:'absolute',left:0,right:0,bottom:78,height:70,backgroundColor:'#fff',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#ddd',flexDirection:'row',justifyContent:'space-around',zIndex:20},action:{minWidth:64,alignItems:'center',justifyContent:'center'},actionText:{fontSize:11,color:'#444',marginTop:4},
  modalShade:{flex:1,backgroundColor:'#0005'},sheet:{maxHeight:'80%',backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:18,paddingBottom:34},handle:{width:40,height:4,borderRadius:2,backgroundColor:'#ccc',alignSelf:'center',marginBottom:16},sheetTitle:{fontSize:22,fontWeight:'700',color:'#202124',marginBottom:14},sheetBody:{fontSize:14,color:'#666',marginBottom:12},primary:{height:48,borderRadius:24,backgroundColor:BLUE,alignItems:'center',justifyContent:'center',marginTop:10},primaryText:{color:'#fff',fontWeight:'700'},textButton:{height:44,alignItems:'center',justifyContent:'center'},albumInput:{height:48,borderRadius:12,borderWidth:1,borderColor:'#d4d7dc',paddingHorizontal:14,fontSize:16},menuRow:{height:54,flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#ddd'},menuText:{flex:1,fontSize:16,color:'#303238'},menuCount:{color:'#777'},settingRow:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#ddd'},settingLabel:{fontSize:15,color:'#303238'},
  subHeader:{height:55,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},subTitle:{fontSize:19,fontWeight:'700',color:'#202124'},viewer:{flex:1,backgroundColor:'#070707'},viewerHeader:{height:64,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},viewerTitle:{fontSize:14,fontWeight:'700',color:'#fff',textAlign:'center'},viewerSub:{fontSize:11,color:'#aaa',textAlign:'center',marginTop:2},viewerImage:{flex:1,width:'100%'},viewerToolbar:{height:100,paddingBottom:16,flexDirection:'row',alignItems:'center',justifyContent:'space-around',backgroundColor:'#111'},details:{position:'absolute',left:0,right:0,bottom:0,maxHeight:'65%',backgroundColor:'#fff',borderTopLeftRadius:24,borderTopRightRadius:24,padding:20},detail:{fontSize:14,color:'#656970',marginBottom:8},
  scanner:{position:'absolute',left:0,right:0,top:0,bottom:0,zIndex:50,backgroundColor:'#000'},scanFrame:{position:'absolute',top:'25%',left:'13%',right:'13%',aspectRatio:1,borderWidth:3,borderColor:'#fff',borderRadius:24},cancelScan:{position:'absolute',bottom:50,alignSelf:'center',backgroundColor:BLUE,borderRadius:22,paddingHorizontal:24,paddingVertical:12},
});
