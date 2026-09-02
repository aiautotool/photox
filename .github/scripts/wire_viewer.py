from pathlib import Path
p=Path('mobile/src/home/MobileHome.tsx')
s=p.read_text()
s=s.replace("import { VideoView, useVideoPlayer } from 'expo-video';\n","")
s=s.replace("import type { MobileAlbum, MobileLibraryState } from '../library/LibraryStateStore';\n","import type { MobileAlbum, MobileLibraryState } from '../library/LibraryStateStore';\nimport { SwipeMediaStage } from '../viewer/SwipeMediaStage';\n")
old='''function VideoViewer({asset}:{asset:DisplayAsset}){\n  const source=useMemo(()=>({uri:asset.uri,headers:asset.requestHeaders}),[asset.uri,asset.requestHeaders]);\n  const player=useVideoPlayer(source,p=>{p.loop=false;p.play();});\n  return <VideoView player={player} style={s.viewerImage} nativeControls contentFit="contain" allowsFullscreen allowsPictureInPicture/>;\n}\n\n'''
if old not in s: raise SystemExit('video viewer block missing')
s=s.replace(old,'',1)
anchor="  const selectionActive=selected.size>0||Boolean(addTargetAlbumId);\n"
insert="  const selectionActive=selected.size>0||Boolean(addTargetAlbumId);\n  const viewerSequence=collection?specialItems:smartAlbum?smartAlbumItems:currentCustomAlbum?customAlbumItems:tab==='search'&&query?filtered:visiblePhotos;\n"
if anchor not in s: raise SystemExit('selection anchor missing')
s=s.replace(anchor,insert,1)
old_stage="{viewer.mediaType==='video'?<VideoViewer asset={viewer}/>:<Image source={imageSource(viewer)} style={s.viewerImage} contentFit=\"contain\"/>}"
new_stage="<SwipeMediaStage assets={viewerSequence.length?viewerSequence:[viewer]} current={viewer} onChange={asset=>{setViewer(asset);setViewerInfo(false);}}/>"
if old_stage not in s: raise SystemExit('viewer stage anchor missing')
s=s.replace(old_stage,new_stage,1)
p.write_text(s)
