import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState, Dimensions, Modal, Platform, Pressable, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as MediaLibrary from 'expo-media-library/legacy';
import IMGLYEditor, { EditorPreset, EditorSettingsModel, SourceType } from '@imgly/editor-react-native';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { downloadCloudAsset, loadAssetMetadata, loadCloudPhotos, loadDevicePhotos, pingLaptop, prepareAssetForEditing, syncAssetsToLaptop, type AssetMetadata, type DisplayAsset, type MediaAsset, type SyncProgress } from '../src/sync/mobileSync';
import { forgetPairedDesktop, loadPairedDesktop, savePairedDesktop, type PairedDesktop } from '../src/sync/pairing';
import { loadFailedAssets, loadSyncedAssetIds } from '../src/sync/syncLedger';

type Tab = 'photos' | 'collections' | 'search';
type Sheet = 'backup' | 'account' | 'settings' | 'create' | null;
type Collection = 'Yêu thích' | 'Lưu trữ' | 'Thư mục khóa' | 'Thùng rác' | null;

const BLUE = '#1769e0';
const COLUMNS = Dimensions.get('window').width > 700 ? 6 : 4;
const GAP = 2;
const TILE = (Dimensions.get('window').width - GAP * (COLUMNS - 1)) / COLUMNS;

type IconName = 'photos'|'collections'|'search'|'add'|'bell'|'cloudDone'|'cloudUpload'|'warning'|'favorite'|'favoriteFill'|'archive'|'lock'|'trash'|'share'|'edit'|'download'|'settings'|'chevron'|'back'|'more'|'video'|'album'|'person'|'place'|'document'|'close'|'check'|'sync';
const ICONS: Record<IconName, { ios: SFSymbol; android: AndroidSymbol }> = {
  photos:{ios:'photo.on.rectangle.angled',android:'photo_library'}, collections:{ios:'rectangle.stack.fill',android:'collections'}, search:{ios:'magnifyingglass',android:'search'}, add:{ios:'plus',android:'add'}, bell:{ios:'bell',android:'notifications'}, cloudDone:{ios:'checkmark.icloud.fill',android:'cloud_done'}, cloudUpload:{ios:'icloud.and.arrow.up',android:'cloud_upload'}, warning:{ios:'exclamationmark.circle.fill',android:'warning'}, favorite:{ios:'star',android:'favorite_border'}, favoriteFill:{ios:'star.fill',android:'favorite'}, archive:{ios:'archivebox',android:'archive'}, lock:{ios:'lock.fill',android:'lock'}, trash:{ios:'trash',android:'delete'}, share:{ios:'square.and.arrow.up',android:'share'}, edit:{ios:'slider.horizontal.3',android:'edit'}, download:{ios:'arrow.down.circle',android:'file_download'}, settings:{ios:'gearshape',android:'settings'}, chevron:{ios:'chevron.right',android:'chevron_right'}, back:{ios:'chevron.left',android:'arrow_back_ios'}, more:{ios:'ellipsis',android:'more_horiz'}, video:{ios:'play.fill',android:'video_library'}, album:{ios:'rectangle.stack.badge.plus',android:'photo_album'}, person:{ios:'person.2.fill',android:'person'}, place:{ios:'map.fill',android:'location_on'}, document:{ios:'doc.text.fill',android:'description'}, close:{ios:'xmark',android:'close'}, check:{ios:'checkmark',android:'check'}, sync:{ios:'arrow.clockwise',android:'sync'},
};
function Icon({ name, size = 22, color = '#5f6368', weight = 'regular' }: { name: IconName; size?: number; color?: string; weight?: 'regular'|'medium'|'semibold'|'bold' }) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} weight={weight} style={{ width:size, height:size }} />;
}
function formatBytes(bytes?: number) { if (!bytes) return ''; return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function formatDuration(seconds: number) { const value = Math.max(0, Math.round(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
function formatExposure(value?: number) { if (!value) return ''; return value < 1 ? `1/${Math.round(1 / value)} giây` : `${value} giây`; }
function VideoViewer({ asset }: { asset: DisplayAsset }) {
  const source = useMemo(() => ({ uri: asset.uri, headers: asset.requestHeaders }), [asset.uri, asset.requestHeaders]);
  const player = useVideoPlayer(source, player => { player.loop = false; player.play(); });
  return <VideoView player={player} style={s.viewerImage} nativeControls contentFit="contain" allowsFullscreen allowsPictureInPicture />;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('photos');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [photos, setPhotos] = useState<DisplayAsset[]>([]);
  const [devicePhotos, setDevicePhotos] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<PairedDesktop | null>(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('Đang chuẩn bị sao lưu…');
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [scanner, setScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [syncPhase, setSyncPhase] = useState<'idle' | 'checking' | 'syncing' | 'pausing' | 'paused'>('idle');
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  const [failedAssets, setFailedAssets] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<DisplayAsset | null>(null);
  const [viewerInfo, setViewerInfo] = useState(false);
  const [viewerMetadata, setViewerMetadata] = useState<AssetMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [editorOpening, setEditorOpening] = useState(false);
  const [collection, setCollection] = useState<Collection>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [trashed, setTrashed] = useState<Set<string>>(new Set());
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [mobilePhotos, setMobilePhotos] = useState(true);
  const [mobileVideos, setMobileVideos] = useState(false);
  const [manualSync, setManualSync] = useState<{ assetId: string; phase: 'syncing' | 'error' } | null>(null);
  const [downloadingAssetId, setDownloadingAssetId] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const syncControllerRef = useRef<AbortController | null>(null);

  useEffect(() => { void (async () => {
    try {
      const [assets, saved, synced, failed] = await Promise.all([
        loadDevicePhotos(500), loadPairedDesktop(), loadSyncedAssetIds(), loadFailedAssets(),
      ]);
      setDevicePhotos(assets); setPhotos(assets); setTarget(saved); setSyncedIds(synced); setFailedAssets(failed);
      if (saved) void refreshCloudLibrary(saved, assets);
      setMessage(saved ? 'Đang kiểm tra kết nối…' : 'Chưa thiết lập nơi sao lưu');
      if (saved) void autoSync(saved, assets, true);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  })(); }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && target) { void refreshCloudLibrary(target, devicePhotos); if (devicePhotos.length && backupEnabled) void autoSync(target, devicePhotos, true); }
    });
    return () => sub.remove();
  }, [target, devicePhotos, backupEnabled]);

  useEffect(() => {
    if (!viewer || !viewerInfo) { setViewerMetadata(null); return; }
    let active = true; setMetadataLoading(true);
    void loadAssetMetadata(viewer).then(value => { if (active) setViewerMetadata(value); }).catch(() => { if (active) setViewerMetadata({ fileSize: viewer.fileSize }); }).finally(() => { if (active) setMetadataLoading(false); });
    return () => { active = false; };
  }, [viewer, viewerInfo]);

  async function refreshCloudLibrary(currentTarget: PairedDesktop, localAssets: MediaAsset[]) {
    try {
      const cloudAssets = await loadCloudPhotos(currentTarget);
      const localIds = new Set(localAssets.map(asset => asset.id));
      setPhotos([...localAssets, ...cloudAssets.filter(asset => !localIds.has(asset.id))]);
    } catch {}
  }

  const imageSource = (asset: DisplayAsset) => ({ uri: asset.uri, headers: asset.requestHeaders });

  async function openEditor(asset: DisplayAsset) {
    if (asset.mediaType === 'video') { setMessage('Trình chỉnh sửa chuyên nghiệp hiện chỉ áp dụng cho ảnh.'); return; }
    if (editorOpening) return;
    setEditorOpening(true);
    try {
      const source = await prepareAssetForEditing(asset);
      const settings = new EditorSettingsModel({
        license: process.env.EXPO_PUBLIC_IMGLY_LICENSE || undefined,
        userId: target?.desktopId || 'photosync-mobile',
      });
      const result = await IMGLYEditor.openEditor(settings, { source, type:SourceType.IMAGE }, EditorPreset.PHOTO, { sourceAssetId:asset.id });
      if (result?.artifact) {
        const artifact = result.artifact.startsWith('/') ? `file://${result.artifact}` : result.artifact;
        const saved = await MediaLibrary.createAssetAsync(artifact);
        const assets = await loadDevicePhotos(500);
        setDevicePhotos(assets); setPhotos(assets); setViewer(saved);
        setMessage('Đã lưu bản chỉnh sửa mới, ảnh gốc được giữ nguyên.');
      }
    } catch (error) { setMessage(`Không mở được trình chỉnh sửa: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setEditorOpening(false); }
  }

  const visiblePhotos = useMemo(() => photos.filter(item => !archived.has(item.id) && !trashed.has(item.id)), [photos, archived, trashed]);
  const filtered = useMemo(() => visiblePhotos.filter(item => item.filename.toLowerCase().includes(query.trim().toLowerCase())), [visiblePhotos, query]);
  const pendingCount = devicePhotos.filter(item => !syncedIds.has(item.id)).length;
  const failedCount = Object.keys(failedAssets).length;
  const doneCount = progress ? progress.completed + progress.skipped + progress.failed : 0;
  const currentFileRatio = progress?.currentBytesTotal
    ? Math.min((progress.currentBytesUploaded || 0) / progress.currentBytesTotal, 1)
    : 0;
  const percent = progress?.total ? Math.round(((doneCount + currentFileRatio) / progress.total) * 100) : pendingCount ? 0 : 100;
  const formatMB = (bytes = 0) => `${(bytes / (1024 * 1024)).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  const currentAsset = progress?.currentAssetId ? photos.find(asset => asset.id === progress.currentAssetId) : undefined;
  const backupLabel = !backupEnabled ? 'Sao lưu đang tắt' : syncPhase === 'pausing' ? 'Đang tạm dừng sao lưu' : syncPhase === 'paused' ? 'Đã tạm dừng sao lưu' : failedCount ? `${failedCount} mục cần xử lý` : syncPhase === 'checking' ? 'Đang chuẩn bị sao lưu' : syncPhase === 'syncing' ? `Đang sao lưu ${progress?.total ? `${doneCount}/${progress.total}` : ''}` : !target ? 'Thiết lập sao lưu' : !connected ? 'Đang chờ kết nối' : pendingCount ? `${pendingCount} mục đang chờ` : 'Đã sao lưu xong';
  const syncButtonLabel = syncPhase === 'checking' || syncPhase === 'syncing'
    ? 'Tạm dừng sao lưu'
    : syncPhase === 'pausing'
      ? 'Đang tạm dừng…'
      : syncPhase === 'paused'
        ? 'Tiếp tục sao lưu'
        : target ? 'Sao lưu ngay' : 'Thiết lập sao lưu';

  async function autoSync(currentTarget: PairedDesktop, assets: MediaAsset[], retryFailed = false) {
    if (!backupEnabled || syncingRef.current) return;
    const [knownSynced, knownFailed] = await Promise.all([loadSyncedAssetIds(), loadFailedAssets()]);
    const pending = assets.filter(asset => !knownSynced.has(asset.id) && (retryFailed || !knownFailed[asset.id]));
    setSyncedIds(knownSynced); setFailedAssets(knownFailed);
    if (!pending.length) { setConnected(true); setSyncPhase('idle'); setMessage(Object.keys(knownFailed).length ? 'Một số mục cần thử lại.' : 'Thư viện đã được sao lưu an toàn.'); return; }
    syncingRef.current = true;
    const controller = new AbortController(); syncControllerRef.current = controller;
    setSyncPhase('checking'); setMessage(`Đang chuẩn bị ${pending.length} mục…`);
    try {
      await pingLaptop(currentTarget, controller.signal); setConnected(true);
      setProgress({ total: pending.length, completed: 0, skipped: 0, failed: 0 }); setSyncPhase('syncing');
      const result = await syncAssetsToLaptop(currentTarget, pending, async value => {
        setProgress(value);
        const [synced, failed] = await Promise.all([loadSyncedAssetIds(), loadFailedAssets()]);
        setSyncedIds(synced); setFailedAssets(failed);
      }, controller.signal);
      const [synced, failed] = await Promise.all([loadSyncedAssetIds(), loadFailedAssets()]);
      setSyncedIds(synced); setFailedAssets(failed);
      setMessage(result.failed ? `${result.failed} mục chưa thể sao lưu.` : 'Thư viện đã được sao lưu an toàn.');
      await refreshCloudLibrary(currentTarget, assets);
    } catch (error) {
      if (!controller.signal.aborted) setConnected(false);
      setMessage(controller.signal.aborted ? 'Đã tạm dừng sao lưu.' : 'Đang chờ kết nối với máy tính.');
    } finally {
      syncingRef.current = false; syncControllerRef.current = null;
      setSyncPhase(controller.signal.aborted ? 'paused' : 'idle');
    }
  }

  function toggleSync() {
    if (syncPhase === 'checking' || syncPhase === 'syncing') {
      setSyncPhase('pausing');
      setMessage('Đang dừng sau mục hiện tại…');
      syncControllerRef.current?.abort();
      return;
    }
    if (syncPhase === 'pausing') return;
    if (target) void autoSync(target, devicePhotos, true); else setSheet('account');
  }

  async function syncOneNow(asset: MediaAsset) {
    if (!target) {
      setViewer(null); setViewerInfo(false); setSheet('account');
      return;
    }
    if (manualSync?.assetId === asset.id && manualSync.phase === 'syncing') return;
    setManualSync({ assetId: asset.id, phase: 'syncing' });
    try {
      const result = await syncAssetsToLaptop(target, [asset]);
      const [synced, failed] = await Promise.all([loadSyncedAssetIds(), loadFailedAssets()]);
      setSyncedIds(synced); setFailedAssets(failed); setConnected(true);
      if (result.failed || !synced.has(asset.id)) throw new Error(result.lastError || 'Không thể sao lưu mục này.');
      setManualSync(null);
    } catch {
      setManualSync({ assetId: asset.id, phase: 'error' });
    }
  }

  async function downloadOne(asset: DisplayAsset) {
    if (!asset.cloudOnly || downloadingAssetId) return;
    setDownloadingAssetId(asset.id);
    try {
      const saved = await downloadCloudAsset(asset);
      const assets = await loadDevicePhotos(500);
      setDevicePhotos(assets);
      setPhotos(previous => [saved, ...previous.filter(item => item.id !== asset.id)]);
      setViewer(saved);
      setMessage(`Đã tải ${asset.filename} vào thư viện thiết bị.`);
    } catch (error) {
      setMessage(`Không tải được ${asset.filename}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDownloadingAssetId(null);
    }
  }

  function toggleSelect(id: string) {
    setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function startScanner() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { setMessage('Cần quyền camera để quét mã QR.'); return; }
    }
    setSheet(null); setScanner(true);
  }

  async function onQr(data: string) {
    if (!scanner) return; setScanner(false);
    try { const saved = await savePairedDesktop(data); setTarget(saved); setMessage('Đã kết nối. Bắt đầu sao lưu…'); await refreshCloudLibrary(saved, devicePhotos); await autoSync(saved, devicePhotos, true); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }

  const renderGrid = (items: DisplayAsset[]) => <View style={s.grid}>{items.map((asset, index) => {
    const chosen = selected.has(asset.id);
    return <Pressable key={asset.id} style={[s.tile, chosen && s.selectedTile]} onPress={() => selected.size ? toggleSelect(asset.id) : setViewer(asset)} onLongPress={() => toggleSelect(asset.id)}>
      <Image source={imageSource(asset)} style={s.photo} contentFit="cover" transition={120} />
      {asset.mediaType === 'video' && <View style={s.videoBadge}><Text style={s.videoText}>▶</Text></View>}
      {syncedIds.has(asset.id) && index < 4 && <View style={s.cloudBadge}><Text style={s.cloudText}>✓</Text></View>}
      {failedAssets[asset.id] && <View style={s.errorBadge}><Text style={s.errorText}>!</Text></View>}
      {chosen && <View style={s.check}><Text style={s.checkText}>✓</Text></View>}
    </Pressable>;
  })}</View>;

  return <SafeAreaView style={s.root}>
    <StatusBar barStyle="dark-content" backgroundColor="#fff" />
    {selected.size > 0 ? <View style={s.selectHeader}>
      <Pressable onPress={() => setSelected(new Set())}><Icon name="close" size={24} color="#333" /></Pressable>
      <Text style={s.selectCount}>{selected.size} đã chọn</Text>
      <Pressable><Icon name="more" size={23} color="#333" /></Pressable>
    </View> : <View style={s.header}>
      <View style={s.brand}><View style={s.pinwheel}><Text style={s.pinwheelText}>✦</Text></View><Text style={s.logo}>PhotoSync</Text></View>
      <View style={s.headerActions}><Pressable style={s.iconButton} onPress={() => setSheet('create')}><Icon name="add" size={24} color="#303238" /></Pressable><Pressable style={s.iconButton}><Icon name="bell" size={22} color="#303238" /></Pressable><Pressable style={s.avatar} onPress={() => setSheet('account')}><Text style={s.avatarText}>V</Text></Pressable></View>
    </View>}

    {tab === 'photos' && <ScrollView style={s.flex} contentContainerStyle={s.scrollBottom} stickyHeaderIndices={[0]}>
      <View style={s.backupWrap}><Pressable style={[s.backupChip, failedCount > 0 && s.warningChip]} onPress={() => setSheet('backup')}>
        <Icon name={syncPhase === 'syncing' ? 'sync' : failedCount ? 'warning' : pendingCount ? 'cloudUpload' : 'cloudDone'} size={18} color={failedCount ? '#c24e00' : BLUE} />
        <Text numberOfLines={1} style={s.backupText}>{backupLabel}</Text><Icon name="chevron" size={14} color="#777b82" />
      </Pressable></View>
      <View style={s.memoriesBlock}><Text style={s.sectionTitle}>Kỷ niệm</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.memoryRow}>
        {photos.slice(0, 4).map((item, index) => <Pressable key={item.id} style={s.memoryCard}><Image source={imageSource(item)} style={s.memoryImage} contentFit="cover" /><View style={s.scrim}/><Text style={s.memoryLabel}>{['Ngày này năm trước', 'Cuối tuần đáng nhớ', 'Những khoảnh khắc', 'Gần đây'][index]}</Text></Pressable>)}
        {!photos.length && <View style={[s.memoryCard, s.memoryPlaceholder]}><Text style={s.memoryEmpty}>Kỷ niệm của bạn sẽ xuất hiện ở đây</Text></View>}
      </ScrollView></View>
      <View style={s.dateRow}><Text style={s.dateTitle}>Hôm nay</Text><Pressable onPress={() => setSelected(new Set(visiblePhotos.map(x => x.id)))}><Text style={s.selectLink}>Chọn</Text></Pressable></View>
      {visiblePhotos.length ? renderGrid(visiblePhotos) : <View style={s.empty}><Text style={s.emptyIcon}>▧</Text><Text style={s.emptyTitle}>Chưa có ảnh</Text><Text style={s.emptyBody}>Ảnh và video trên thiết bị sẽ xuất hiện ở đây.</Text></View>}
    </ScrollView>}

    {tab === 'collections' && !collection && <ScrollView contentContainerStyle={s.page}>
      <Text style={s.pageTitle}>Bộ sưu tập</Text>
      <View style={s.quickRow}>{([['favorite','Yêu thích'],['archive','Lưu trữ'],['lock','Thư mục khóa'],['trash','Thùng rác']] as const).map(([icon, label]) => <Pressable key={label} style={s.quickItem} onPress={() => setCollection(label as Collection)}><View style={s.quickIcon}><Icon name={icon} size={23} color={BLUE} /></View><Text style={s.quickLabel}>{label}</Text></Pressable>)}</View>
      <View style={s.sectionHead}><Text style={s.sectionTitle}>Album</Text><Pressable onPress={() => setSheet('create')}><Text style={s.selectLink}>＋ Tạo mới</Text></Pressable></View>
      <View style={s.albumGrid}>{[['Camera', photos.slice(0, 1), photos.length], ['Video', photos.filter(x => x.mediaType === 'video').slice(0, 1), photos.filter(x => x.mediaType === 'video').length], ['Gần đây', photos.slice(2, 3), Math.min(photos.length, 24)], ['Đã sao lưu', photos.filter(x => syncedIds.has(x.id)).slice(0, 1), syncedIds.size]].map(([name, cover, count]) => <Pressable key={String(name)} style={s.album}>
        <View style={s.albumCover}>{(cover as DisplayAsset[])[0] ? <Image source={imageSource((cover as DisplayAsset[])[0])} style={s.photo} contentFit="cover" /> : <Text style={s.albumEmpty}>▧</Text>}</View>
        <Text style={s.albumName}>{String(name)}</Text><Text style={s.albumCount}>{String(count)} mục</Text>
      </Pressable>)}</View>
      <Pressable style={s.manageCard} onPress={() => setSheet('account')}><View><Text style={s.manageTitle}>Thiết bị sao lưu</Text><Text style={s.manageSub}>{target ? target.desktopId : 'Chưa kết nối máy tính'}</Text></View><Icon name="chevron" size={17} color="#777b82" /></Pressable>
    </ScrollView>}

    {tab === 'collections' && collection && <View style={s.flex}><View style={s.subHeader}><Pressable style={s.iconButton} onPress={() => setCollection(null)}><Icon name="back" size={22} color="#333" /></Pressable><Text style={s.subTitle}>{collection}</Text><Icon name="more" size={23} color="#333" /></View><ScrollView contentContainerStyle={s.scrollBottom}>
      {collection === 'Thư mục khóa' ? <View style={s.empty}><Text style={s.emptyIcon}>▣</Text><Text style={s.emptyTitle}>Thư mục khóa</Text><Text style={s.emptyBody}>Ảnh và video ở đây được ẩn khỏi thư viện, tìm kiếm và kỷ niệm.</Text><Pressable style={s.smallPrimary}><Text style={s.primaryButtonText}>Di chuyển mục</Text></Pressable></View> : (() => { const items = collection === 'Yêu thích' ? photos.filter(x => favorites.has(x.id)) : collection === 'Lưu trữ' ? photos.filter(x => archived.has(x.id)) : photos.filter(x => trashed.has(x.id)); return items.length ? renderGrid(items) : <View style={s.empty}><Text style={s.emptyIcon}>{collection === 'Yêu thích' ? '☆' : collection === 'Lưu trữ' ? '⌁' : '♲'}</Text><Text style={s.emptyTitle}>Chưa có mục nào</Text><Text style={s.emptyBody}>{collection === 'Thùng rác' ? 'Các mục trong thùng rác sẽ được xóa vĩnh viễn sau một khoảng thời gian.' : 'Ảnh bạn thêm sẽ xuất hiện ở đây.'}</Text></View>; })()}
    </ScrollView></View>}

    {tab === 'search' && <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.pageTitle}>Tìm kiếm</Text><View style={s.searchBox}><Icon name="search" size={21} color="#4d5156" /><TextInput value={query} onChangeText={setQuery} placeholder="Ảnh, địa điểm hoặc tên file" placeholderTextColor="#74777d" style={s.searchInput} />{query ? <Pressable onPress={() => setQuery('')}><Icon name="close" size={18} color="#5e6268" /></Pressable> : null}</View>
      {!query ? <><Text style={s.sectionTitle}>Khám phá</Text><View style={s.discovery}>{[['☺','Mọi người'],['⌖','Địa điểm'],['♨','Đồ vật'],['▤','Tài liệu']].map(([icon,label]) => <Pressable key={label} style={s.discoveryItem}><Text style={s.discoveryIcon}>{icon}</Text><Text style={s.discoveryLabel}>{label}</Text></Pressable>)}</View><Text style={s.sectionTitle}>Tìm kiếm gần đây</Text><Text style={s.hint}>Tên ảnh và video trên thiết bị</Text></> : filtered.length ? <><Text style={s.resultText}>{filtered.length} kết quả</Text>{renderGrid(filtered)}</> : <View style={s.empty}><Text style={s.emptyIcon}>⌕</Text><Text style={s.emptyTitle}>Không tìm thấy ảnh</Text><Text style={s.emptyBody}>Hãy thử một từ khóa khác.</Text></View>}
    </ScrollView>}

    {selected.size > 0 && <View style={s.selectionBar}>{([['share','Chia sẻ'],['album','Thêm vào'],['cloudUpload','Sao lưu'],['trash','Xóa']] as const).map(([icon,label]) => <Pressable key={label} style={s.action}><Icon name={icon} size={22} color="#333" /><Text style={s.actionLabel}>{label}</Text></Pressable>)}</View>}

    <View style={s.nav}>{([['photos','photos','Ảnh'],['collections','collections','Bộ sưu tập'],['search','search','Tìm kiếm']] as const).map(([id,icon,label]) => <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={s.navItem} onPress={() => { setTab(id); setSelected(new Set()); }}><View style={[s.navIconWrap, tab === id && s.navActive]}><Icon name={icon} size={21} color={tab === id ? BLUE : '#5f6368'} weight={tab === id ? 'semibold' : 'regular'} /></View><Text style={[s.navText, tab === id && s.navTextActive]}>{label}</Text></Pressable>)}</View>

    <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}><Pressable style={s.modalShade} onPress={() => setSheet(null)} /><View style={s.sheet}><View style={s.handle}/>
      {sheet === 'backup' && <><Text style={s.sheetTitle}>Sao lưu</Text><View style={s.backupHero}><View style={[s.bigStatus, { backgroundColor: failedCount ? '#fff0e9' : '#eaf2ff' }]}><Text style={s.bigStatusIcon}>{failedCount ? '!' : syncPhase === 'syncing' ? '◔' : '✓'}</Text></View><Text style={s.backupHeroTitle}>{backupLabel}</Text><Text style={s.backupHeroSub}>{message}</Text></View>
        {(progress || pendingCount > 0) && <><View style={s.progressTrack}><View style={[s.progressFill,{ width: `${percent}%` }]} /></View><Text style={s.progressLabel}>{percent}% • {pendingCount} mục còn lại</Text></>}
        {currentAsset && (syncPhase === 'syncing' || syncPhase === 'pausing') && <View style={s.currentUpload}>
          <Image source={imageSource(currentAsset)} style={s.currentUploadImage} contentFit="cover" />
          <View style={s.currentUploadCopy}><Text style={s.currentUploadEyebrow}>{syncPhase === 'pausing' ? 'ĐANG HOÀN TẤT MỤC HIỆN TẠI' : 'ĐANG TẢI LÊN'}</Text><Text numberOfLines={1} style={s.currentUploadName}>{currentAsset.filename}</Text><Text style={s.currentUploadType}>{currentAsset.mediaType === 'video' ? 'Video' : 'Ảnh'} • Mục {Math.min(doneCount + 1, progress?.total || 1)}/{progress?.total || 1}</Text>{progress?.currentBytesTotal ? <Text style={s.currentUploadBytes}>{Math.round(currentFileRatio * 100)}% • Đã tải {formatMB(progress.currentBytesUploaded)} • Còn {formatMB(progress.currentBytesRemaining)}</Text> : null}</View>
        </View>}
        <View style={s.infoRow}><Text style={s.infoIcon}>⌁</Text><View style={s.infoCopy}><Text style={s.infoTitle}>{connected ? 'Kết nối trực tiếp' : 'Đang chờ kết nối'}</Text><Text style={s.infoSub}>{target?.desktopId || 'Chưa chọn máy tính sao lưu'}</Text></View></View>
        <Pressable disabled={syncPhase === 'pausing'} style={[s.primaryButton, syncPhase === 'paused' && s.resumeButton, syncPhase === 'pausing' && s.disabledButton]} onPress={toggleSync}><Text style={[s.primaryButtonText, syncPhase === 'paused' && s.resumeButtonText]}>{syncButtonLabel}</Text></Pressable><Pressable style={s.textButton} onPress={() => setSheet('settings')}><Text style={s.textButtonText}>Cài đặt sao lưu</Text></Pressable></>}
      {sheet === 'account' && <><Text style={s.sheetTitle}>Tài khoản và thiết bị</Text><View style={s.account}><View style={s.avatarLarge}><Text style={s.avatarLargeText}>V</Text></View><Text style={s.accountName}>PhotoSync của bạn</Text><Text style={s.accountSub}>Ảnh riêng tư, lưu trên thiết bị bạn chọn</Text></View>
        <View style={s.accountCard}><Text style={s.infoTitle}>{target ? 'Máy tính đã kết nối' : 'Kết nối máy tính để sao lưu'}</Text><Text style={s.infoSub}>{target?.desktopId || 'Quét mã QR hiển thị trong PhotoSync Desktop'}</Text></View>
        <Pressable style={s.primaryButton} onPress={() => void startScanner()}><Text style={s.primaryButtonText}>{target ? 'Ghép nối lại' : 'Quét mã QR'}</Text></Pressable>{target && <Pressable style={s.textButton} onPress={() => void (async()=>{ await forgetPairedDesktop(); setTarget(null); setConnected(false); setSheet(null); })()}><Text style={[s.textButtonText,{color:'#c62828'}]}>Quên máy tính này</Text></Pressable>}<Pressable style={s.menuRow} onPress={() => setSheet('settings')}><Icon name="settings" size={22} color={BLUE} /><Text style={s.menuText}>Cài đặt PhotoSync</Text><Icon name="chevron" size={16} color="#777b82" /></Pressable></>}
      {sheet === 'settings' && <><Text style={s.sheetTitle}>Cài đặt sao lưu</Text>{[['Sao lưu',backupEnabled,setBackupEnabled],['Dùng dữ liệu di động cho ảnh',mobilePhotos,setMobilePhotos],['Dùng dữ liệu di động cho video',mobileVideos,setMobileVideos]].map(([label,value,setter]) => <View key={String(label)} style={s.settingRow}><Text style={s.settingLabel}>{String(label)}</Text><Switch value={value as boolean} onValueChange={setter as (value:boolean)=>void} trackColor={{ false:'#d7d9de', true:'#9fc1f7' }} thumbColor={(value as boolean) ? BLUE : '#fff'} /></View>)}<View style={s.settingRow}><View><Text style={s.settingLabel}>Chất lượng sao lưu</Text><Text style={s.infoSub}>Chất lượng gốc</Text></View><Text style={s.chevron}>›</Text></View><Text style={s.settingNote}>PhotoSync ưu tiên Wi‑Fi. Video sẽ chờ Wi‑Fi khi dữ liệu di động cho video bị tắt.</Text></>}
      {sheet === 'create' && <><Text style={s.sheetTitle}>Tạo mới</Text>{([['album','Album'],['collections','Ảnh ghép'],['video','Phim'],['photos','Ảnh động']] as const).map(([icon,label]) => <Pressable key={label} style={s.menuRow} onPress={() => setSheet(null)}><Icon name={icon} size={22} color={BLUE} /><Text style={s.menuText}>{label}</Text><Icon name="chevron" size={16} color="#777b82" /></Pressable>)}</>}
    </View></Modal>

    <Modal visible={viewer !== null} animationType="fade" onRequestClose={() => { setViewer(null); setViewerInfo(false); }}><SafeAreaView style={s.viewer}>
      <View style={s.viewerHeader}><Pressable style={s.iconButton} onPress={() => { setViewer(null); setViewerInfo(false); }}><Icon name="back" size={23} color="#fff" /></Pressable><View><Text style={s.viewerDate}>{viewer ? new Date(viewer.creationTime).toLocaleDateString('vi-VN') : ''}</Text><Text style={s.viewerName}>{viewer?.filename}</Text></View><Pressable style={s.iconButton} onPress={() => setViewerInfo(value => !value)}><Icon name="more" size={24} color="#fff" /></Pressable></View>
      {viewer && (viewer.mediaType === 'video' ? <VideoViewer asset={viewer} /> : <Image source={imageSource(viewer)} style={s.viewerImage} contentFit="contain" />)}
      {viewerInfo && viewer && <ScrollView style={s.details} contentContainerStyle={s.detailsContent}><View style={s.handle}/><Text style={s.sheetTitle}>Chi tiết</Text><Text style={s.detailName}>{viewer.filename}</Text><Text style={s.detailLine}>{new Date(viewerMetadata?.capturedAt || viewer.creationTime).toLocaleString('vi-VN')}</Text><Text style={s.detailLine}>{viewer.width && viewer.height ? `${viewer.width} × ${viewer.height}` : 'Kích thước ảnh gốc'}{formatBytes(viewerMetadata?.fileSize || viewer.fileSize) ? ` • ${formatBytes(viewerMetadata?.fileSize || viewer.fileSize)}` : ''}</Text>{viewer.mediaType === 'video' ? <Text style={s.detailLine}>Video{viewer.duration ? ` • ${formatDuration(viewer.duration)}` : ''}</Text> : <>{(viewerMetadata?.make || viewerMetadata?.model) && <Text style={s.detailLine}>Máy ảnh: {[viewerMetadata.make, viewerMetadata.model].filter(Boolean).join(' ')}</Text>}{viewerMetadata?.lens && <Text style={s.detailLine}>Ống kính: {viewerMetadata.lens}</Text>}{(viewerMetadata?.focalLength || viewerMetadata?.aperture || viewerMetadata?.exposureTime || viewerMetadata?.iso) && <Text style={s.detailLine}>{[viewerMetadata.focalLength && `${viewerMetadata.focalLength} mm`, viewerMetadata.aperture && `f/${viewerMetadata.aperture}`, formatExposure(viewerMetadata.exposureTime), viewerMetadata.iso && `ISO ${viewerMetadata.iso}`].filter(Boolean).join(' • ')}</Text>}{viewerMetadata?.latitude != null && viewerMetadata?.longitude != null && <Text style={s.detailLine}>Vị trí: {viewerMetadata.latitude.toFixed(5)}, {viewerMetadata.longitude.toFixed(5)}</Text>}{viewerMetadata?.software && <Text style={s.detailLine}>Phần mềm: {viewerMetadata.software}</Text>}</>}{metadataLoading && <Text style={s.detailMuted}>Đang đọc thông tin ảnh…</Text>}<Text style={[s.detailBackup, manualSync?.assetId === viewer.id && manualSync.phase === 'error' && s.detailBackupError]}>{syncedIds.has(viewer.id) || viewer.cloudOnly ? '✓ Đã sao lưu • Chất lượng gốc' : manualSync?.assetId === viewer.id && manualSync.phase === 'syncing' ? '☁ Đang sao lưu riêng mục này…' : manualSync?.assetId === viewer.id && manualSync.phase === 'error' ? '! Sao lưu chưa thành công' : '☁ Chưa sao lưu'}</Text>{!syncedIds.has(viewer.id) && !viewer.cloudOnly && <Pressable disabled={manualSync?.assetId === viewer.id && manualSync.phase === 'syncing'} style={[s.smallPrimary, manualSync?.assetId === viewer.id && manualSync.phase === 'syncing' && s.disabledButton]} onPress={() => void syncOneNow(viewer)}><Text style={s.primaryButtonText}>{manualSync?.assetId === viewer.id && manualSync.phase === 'syncing' ? 'Đang sao lưu…' : manualSync?.assetId === viewer.id && manualSync.phase === 'error' ? 'Thử lại' : 'Sao lưu ngay'}</Text></Pressable>}</ScrollView>}
      {!viewerInfo && <View style={s.viewerToolbar}>{([['share','Chia sẻ'],['edit','Chỉnh sửa'],[favorites.has(viewer?.id || '')?'favoriteFill':'favorite','Yêu thích'],...(viewer?.cloudOnly ? [['download', downloadingAssetId === viewer?.id ? 'Đang tải…' : 'Tải xuống'] as const] : []),['trash','Xóa']] as const).map(([icon,label]) => <Pressable key={label} disabled={label === 'Đang tải…'} style={[s.viewerAction, label === 'Đang tải…' && s.viewerActionDisabled]} onPress={() => { if (!viewer) return; if (label === 'Chỉnh sửa') void openEditor(viewer); if (label === 'Tải xuống') void downloadOne(viewer); if (label === 'Yêu thích') setFavorites(old => { const next = new Set(old); next.has(viewer.id) ? next.delete(viewer.id) : next.add(viewer.id); return next; }); if (label === 'Xóa') { setTrashed(old => new Set(old).add(viewer.id)); setViewer(null); } }}><Icon name={icon} size={24} color="#fff" /><Text style={s.viewerActionLabel}>{label}</Text></Pressable>)}</View>}
    </SafeAreaView></Modal>

    {scanner && <View style={s.scanner}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => void onQr(data)} /><View style={s.scanFrame}/><View style={s.scanBottom}><Text style={s.scanTitle}>Quét mã QR trên PhotoSync Desktop</Text><Pressable style={s.cancel} onPress={() => setScanner(false)}><Text style={s.cancelText}>Hủy</Text></Pressable></View></View>}
  </SafeAreaView>;
}

const s = StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: '#fff'
    },
    flex: {
      flex: 1
    },
    scrollBottom: {
      paddingBottom: 104
    },
    header: {
      height: 58,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: '#fff'
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9
    },
    pinwheel: {
      width: 30,
      height: 30,
      borderRadius: 10,
      backgroundColor: '#eaf2ff',
      alignItems: 'center',
      justifyContent: 'center'
    },
    pinwheelText: {
      color: BLUE,
      fontSize: 21,
      fontWeight: '900'
    },
    logo: {
      fontSize: 21,
      fontWeight: '700',
      color: '#202124',
      letterSpacing: -0.4
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10
    },
    iconButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center'
    },
    plus: {
      fontSize: 27,
      color: '#303238'
    },
    bell: {
      fontSize: 27,
      color: '#303238'
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#795548',
      alignItems: 'center',
      justifyContent: 'center'
    },
    avatarText: {
      color: '#fff',
      fontWeight: '700'
    },
    backupWrap: {
      backgroundColor: '#fff',
      paddingHorizontal: 16,
      paddingVertical: 8
    },
    backupChip: {
      height: 38,
      borderRadius: 20,
      backgroundColor: '#eef4ff',
      paddingHorizontal: 13,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    warningChip: {
      backgroundColor: '#fff1eb'
    },
    backupIcon: {
      color: BLUE,
      fontSize: 16,
      fontWeight: '800'
    },
    backupText: {
      color: '#30343b',
      fontWeight: '600',
      fontSize: 13,
      maxWidth: 250
    },
    chevron: {
      fontSize: 25,
      color: '#777b82'
    },
    memoriesBlock: {
      paddingTop: 11
    },
    sectionTitle: {
      fontSize: 19,
      fontWeight: '700',
      color: '#24262a',
      marginHorizontal: 16,
      marginBottom: 12
    },
    memoryRow: {
      paddingHorizontal: 16,
      gap: 10
    },
    memoryCard: {
      width: 108,
      height: 152,
      borderRadius: 17,
      overflow: 'hidden',
      backgroundColor: '#e9ecf1'
    },
    memoryImage: {
      width: '100%',
      height: '100%'
    },
    scrim: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: '#0002'
    },
    memoryLabel: {
      position: 'absolute',
      left: 10,
      right: 8,
      bottom: 10,
      color: '#fff',
      fontSize: 12,
      fontWeight: '800',
      textShadowColor: '#0009',
      textShadowRadius: 4
    },
    memoryPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12
    },
    memoryEmpty: {
      textAlign: 'center',
      fontSize: 12,
      color: '#73777d'
    },
    dateRow: {
      marginTop: 24,
      height: 40,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    dateTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: '#292b2f'
    },
    selectLink: {
      fontSize: 14,
      fontWeight: '700',
      color: BLUE
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: GAP
    },
    tile: {
      width: TILE,
      height: TILE,
      backgroundColor: '#e7e9ed'
    },
    selectedTile: {
      opacity: .72
    },
    photo: {
      width: '100%',
      height: '100%'
    },
    videoBadge: {
      position: 'absolute',
      left: 6,
      bottom: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#0008',
      alignItems: 'center',
      justifyContent: 'center'
    },
    videoText: {
      color: '#fff',
      fontSize: 10
    },
    cloudBadge: {
      position: 'absolute',
      right: 5,
      bottom: 5,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: '#fffddd',
      alignItems: 'center',
      justifyContent: 'center'
    },
    cloudText: {
      color: '#267352',
      fontSize: 11,
      fontWeight: '900'
    },
    errorBadge: {
      position: 'absolute',
      right: 5,
      top: 5,
      width: 21,
      height: 21,
      borderRadius: 11,
      backgroundColor: '#f9ab00',
      alignItems: 'center',
      justifyContent: 'center'
    },
    errorText: {
      fontWeight: '900',
      color: '#fff'
    },
    check: {
      position: 'absolute',
      right: 6,
      top: 6,
      width: 23,
      height: 23,
      borderRadius: 12,
      backgroundColor: BLUE,
      borderWidth: 2,
      borderColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center'
    },
    checkText: {
      color: '#fff',
      fontWeight: '900',
      fontSize: 12
    },
    empty: {
      padding: 60,
      alignItems: 'center'
    },
    emptyIcon: {
      fontSize: 52,
      color: '#aeb4bd'
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: '#303238',
      marginTop: 14
    },
    emptyBody: {
      fontSize: 14,
      color: '#757980',
      textAlign: 'center',
      marginTop: 6
    },
    page: {
      paddingBottom: 115
    },
    pageTitle: {
      fontSize: 30,
      fontWeight: '700',
      letterSpacing: -0.7,
      color: '#202124',
      margin: 16,
      marginTop: 13
    },
    quickRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: 8,
      marginBottom: 30
    },
    quickItem: {
      width: 82,
      alignItems: 'center'
    },
    quickIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: '#eef4ff',
      alignItems: 'center',
      justifyContent: 'center'
    },
    quickGlyph: {
      fontSize: 22,
      color: BLUE
    },
    quickLabel: {
      fontSize: 12,
      color: '#3d4045',
      textAlign: 'center',
      marginTop: 8
    },
    sectionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 2
    },
    albumGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 12
    },
    album: {
      width: '50%',
      padding: 4,
      marginBottom: 14
    },
    albumCover: {
      width: '100%',
      aspectRatio: 1.18,
      borderRadius: 15,
      overflow: 'hidden',
      backgroundColor: '#edf0f3',
      alignItems: 'center',
      justifyContent: 'center'
    },
    albumEmpty: {
      fontSize: 34,
      color: '#aab0b8'
    },
    albumName: {
      fontSize: 15,
      fontWeight: '600',
      color: '#303238',
      marginTop: 8
    },
    albumCount: {
      fontSize: 12,
      color: '#777b82',
      marginTop: 2
    },
    manageCard: {
      margin: 16,
      padding: 16,
      borderRadius: 14,
      backgroundColor: '#f4f6f8',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    manageTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: '#292b2f'
    },
    manageSub: {
      fontSize: 13,
      color: '#74777d',
      marginTop: 3
    },
    searchBox: {
      height: 50,
      borderRadius: 26,
      marginHorizontal: 16,
      marginBottom: 26,
      backgroundColor: '#edf2f7',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 15
    },
    searchIcon: {
      fontSize: 25,
      color: '#4d5156'
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: '#202124',
      paddingHorizontal: 11
    },
    mic: {
      fontSize: 22,
      color: '#5e6268'
    },
    discovery: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 12,
      marginBottom: 30
    },
    discoveryItem: {
      width: '50%',
      padding: 4
    },
    discoveryIcon: {
      height: 76,
      borderRadius: 15,
      backgroundColor: '#eef4ff',
      fontSize: 29,
      color: BLUE,
      textAlign: 'center',
      textAlignVertical: 'center',
      lineHeight: 76
    },
    discoveryLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: '#3b3e43',
      marginTop: 7
    },
    hint: {
      fontSize: 14,
      color: '#777b82',
      marginHorizontal: 16
    },
    resultText: {
      fontSize: 13,
      color: '#74777d',
      marginHorizontal: 16,
      marginBottom: 12
    },
    nav: {
      height: 78,
      paddingBottom: Platform.OS === 'android' ? 7 : 0,
      backgroundColor: '#f8f9fb',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: '#dfe2e7',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around'
    },
    navItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center'
    },
    navIconWrap: {
      height: 29,
      minWidth: 61,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center'
    },
    navActive: {
      backgroundColor: '#dce8fb'
    },
    icon: {
      fontSize: 21,
      color: '#5f6368'
    },
    navText: {
      fontSize: 11,
      color: '#5f6368',
      marginTop: 4,
      fontWeight: '500'
    },
    navTextActive: {
      color: '#1f4f8e',
      fontWeight: '700'
    },
    selectHeader: {
      height: 58,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: '#fff'
    },
    close: {
      fontSize: 31,
      color: '#333'
    },
    selectCount: {
      fontSize: 17,
      fontWeight: '700',
      color: '#202124'
    },
    more: {
      fontSize: 18,
      color: '#333',
      letterSpacing: 1
    },
    selectionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 78,
      height: 72,
      zIndex: 10,
      backgroundColor: '#fff',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: '#ddd',
      flexDirection: 'row',
      justifyContent: 'space-around'
    },
    action: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 70
    },
    actionIcon: {
      fontSize: 22,
      color: '#333'
    },
    actionLabel: {
      fontSize: 11,
      color: '#45484d',
      marginTop: 4
    },
    modalShade: {
      flex: 1,
      backgroundColor: '#0005'
    },
    sheet: {
      maxHeight: '86%',
      backgroundColor: '#fff',
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: 18,
      paddingBottom: 34
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#c8cbd0',
      alignSelf: 'center',
      marginTop: 9,
      marginBottom: 13
    },
    sheetTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: '#202124',
      marginBottom: 18
    },
    backupHero: {
      alignItems: 'center',
      paddingBottom: 18
    },
    bigStatus: {
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: 'center',
      justifyContent: 'center'
    },
    bigStatusIcon: {
      fontSize: 28,
      color: BLUE,
      fontWeight: '800'
    },
    backupHeroTitle: {
      fontSize: 19,
      fontWeight: '700',
      color: '#26282c',
      marginTop: 12
    },
    backupHeroSub: {
      fontSize: 13,
      color: '#74777d',
      marginTop: 5,
      textAlign: 'center'
    },
    progressTrack: {
      height: 7,
      backgroundColor: '#e3e7ed',
      borderRadius: 4,
      overflow: 'hidden'
    },
    progressFill: {
      height: 7,
      backgroundColor: BLUE,
      borderRadius: 4
    },
    progressLabel: {
      fontSize: 12,
      color: '#6e7278',
      marginTop: 7
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 18,
      padding: 14,
      borderRadius: 14,
      backgroundColor: '#f5f7f9'
    },
    infoIcon: {
      fontSize: 23,
      color: BLUE,
      marginRight: 13
    },
    infoCopy: {
      flex: 1
    },
    infoTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: '#303238'
    },
    infoSub: {
      fontSize: 12,
      color: '#73777d',
      marginTop: 3
    },
    primaryButton: {
      height: 48,
      borderRadius: 24,
      backgroundColor: BLUE,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 9
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700'
    },
    textButton: {
      height: 45,
      alignItems: 'center',
      justifyContent: 'center'
    },
    textButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: BLUE
    },
    account: {
      alignItems: 'center',
      paddingBottom: 18
    },
    avatarLarge: {
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: '#795548',
      alignItems: 'center',
      justifyContent: 'center'
    },
    avatarLargeText: {
      fontSize: 25,
      color: '#fff',
      fontWeight: '700'
    },
    accountName: {
      fontSize: 18,
      fontWeight: '700',
      color: '#25272b',
      marginTop: 10
    },
    accountSub: {
      fontSize: 13,
      color: '#757980',
      marginTop: 4
    },
    accountCard: {
      padding: 15,
      borderRadius: 14,
      backgroundColor: '#f5f7fa'
    },
    menuRow: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#e3e5e8'
    },
    menuGlyph: {
      fontSize: 22,
      color: BLUE,
      width: 38
    },
    menuText: {
      fontSize: 16,
      color: '#303238',
      flex: 1
    },
    settingRow: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#e1e3e6'
    },
    settingLabel: {
      fontSize: 15,
      color: '#303238'
    },
    settingNote: {
      fontSize: 12,
      color: '#74777d',
      lineHeight: 18,
      marginTop: 14
    },
    scanner: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 50,
      backgroundColor: '#000'
    },
    scanFrame: {
      position: 'absolute',
      top: '25%',
      left: '13%',
      right: '13%',
      aspectRatio: 1,
      borderWidth: 3,
      borderColor: '#fff',
      borderRadius: 24
    },
    scanBottom: {
      position: 'absolute',
      left: 20,
      right: 20,
      bottom: 65,
      alignItems: 'center'
    },
    scanTitle: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 16
    },
    cancel: {
      paddingHorizontal: 25,
      paddingVertical: 12,
      borderRadius: 22,
      backgroundColor: '#fff'
    },
    cancelText: {
      color: '#222',
      fontWeight: '700'
    },
    subHeader: {
      height: 55,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16
    },
    back: {
      fontSize: 38,
      color: '#333'
    },
    subTitle: {
      fontSize: 19,
      fontWeight: '700',
      color: '#202124'
    },
    smallPrimary: {
      marginTop: 18,
      paddingHorizontal: 22,
      height: 44,
      borderRadius: 22,
      backgroundColor: BLUE,
      alignItems: 'center',
      justifyContent: 'center'
    },
    viewer: {
      flex: 1,
      backgroundColor: '#070707'
    },
    viewerHeader: {
      height: 64,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    viewerButton: {
      fontSize: 42,
      color: '#fff',
      width: 45
    },
    viewerDate: {
      fontSize: 14,
      fontWeight: '700',
      color: '#fff',
      textAlign: 'center'
    },
    viewerName: {
      fontSize: 11,
      color: '#aaa',
      textAlign: 'center',
      marginTop: 2,
      maxWidth: 240
    },
    viewerMore: {
      fontSize: 18,
      color: '#fff',
      letterSpacing: 1,
      width: 45,
      textAlign: 'right'
    },
    viewerImage: {
      flex: 1,
      width: '100%'
    },
    viewerToolbar: {
      height: 100,
      paddingBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      backgroundColor: '#111'
    },
    viewerAction: {
      alignItems: 'center',
      minWidth: 70
    },
    viewerActionIcon: {
      fontSize: 25,
      color: '#fff'
    },
    viewerActionLabel: {
      fontSize: 11,
      color: '#fff',
      marginTop: 6
    },
    viewerActionDisabled: {
      opacity: 0.55
    },
    details: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      minHeight: 310,
      maxHeight: '72%',
      borderTopLeftRadius: 25,
      borderTopRightRadius: 25,
      backgroundColor: '#fff',
      paddingHorizontal: 20,
      paddingBottom: 30
    },
    detailsContent: {
      paddingBottom: 8
    },
    detailName: {
      fontSize: 16,
      fontWeight: '700',
      color: '#202124',
      marginBottom: 12
    },
    detailLine: {
      fontSize: 14,
      color: '#656970',
      marginBottom: 8
    },
    detailMuted: {
      fontSize: 12,
      color: '#8a8e94',
      marginBottom: 8
    },
    detailBackup: {
      fontSize: 14,
      color: '#276b4c',
      fontWeight: '600',
      marginTop: 10
    },
    detailBackupError: {
      color: '#c24e00'
    },
  currentUpload:{flexDirection:'row',alignItems:'center',marginTop:14,padding:10,borderRadius:14,backgroundColor:'#eef4ff'},
  currentUploadImage:{width:58,height:58,borderRadius:10,backgroundColor:'#dfe5ed'},
  currentUploadCopy:{flex:1,minWidth:0,marginLeft:12},
  currentUploadEyebrow:{fontSize:9,fontWeight:'800',letterSpacing:.6,color:BLUE},
  currentUploadName:{fontSize:14,fontWeight:'700',color:'#292b2f',marginTop:4},
  currentUploadType:{fontSize:11,color:'#73777d',marginTop:3},
  currentUploadBytes:{fontSize:11,fontWeight:'600',color:'#3f65a3',marginTop:4},
  resumeButton:{backgroundColor:'#fff',borderWidth:1.5,borderColor:BLUE},
  resumeButtonText:{color:BLUE},
  disabledButton:{backgroundColor:'#9bbce9'},
});
