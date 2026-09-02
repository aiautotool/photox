import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';
import {
  FilteredImageView,
  CropperView,
  applyFilter,
  cropImage,
  rotateImage,
  type CropRect,
  type FilterName,
  type CustomFilterParams,
} from '@dariyd/react-native-image-filters';
import { EditSession, type AdjustmentName, type CropAspect, type ImageEditRecipe } from '@photox/image-editor';

const PURPLE='#8B5CF6';
const BG='#090A0D';
const PANEL='#101216';
const PANEL_2='#17191F';
const TEXT='#F5F5F7';
const MUTED='#8B8F98';
const SCREEN=Dimensions.get('window').width;
const PREVIEW_W=Math.min(SCREEN,560);

type Mode='presets'|'adjust'|'crop'|'filters'|'effects'|'history'|'export';
type AdjustTab='light'|'color'|'detail';
type AdjustmentState={
  brightness:number;contrast:number;saturation:number;exposure:number;highlights:number;shadows:number;
  temperature:number;tint:number;sharpness:number;vibrance:number;hue:number;gamma:number;
};
type ExportFormat='jpeg'|'png'|'webp';
type Resolution='original'|'2048'|'1080';
type Snapshot={uri:string;width:number;height:number;filter:FilterName;intensity:number;adjust:AdjustmentState;cropAspect:CropAspect;cropRatio?:number;straighten:number};

type Preset={id:string;name:string;filter:FilterName;intensity:number;category:'recommended'|'portrait'|'landscape'|'food'|'night'|'film'};

const DEFAULT_ADJUST:AdjustmentState={brightness:1,contrast:1,saturation:1,exposure:0,highlights:0,shadows:0,temperature:0,tint:0,sharpness:0,vibrance:0,hue:0,gamma:1};
const PRESETS:Preset[]=[
  {id:'auto',name:'Auto Enhance',filter:'vivid',intensity:.55,category:'recommended'},
  {id:'clean',name:'Clean',filter:'chrome',intensity:.42,category:'recommended'},
  {id:'vivid',name:'Vivid',filter:'vivid',intensity:.82,category:'landscape'},
  {id:'cinematic',name:'Cinematic',filter:'dramatic',intensity:.72,category:'recommended'},
  {id:'golden',name:'Golden Hour',filter:'warm',intensity:.68,category:'portrait'},
  {id:'film',name:'Film 01',filter:'vintage',intensity:.72,category:'film'},
  {id:'night',name:'Night',filter:'cool',intensity:.62,category:'night'},
  {id:'food',name:'Food Pop',filter:'clarendon',intensity:.55,category:'food'},
];
const FILTERS:FilterName[]=['vivid','dramatic','warm','cool','vintage','clarendon','juno','lark','reyes','valencia','brooklyn','earlybird','hudson','inkwell','lofi','mayfair','nashville','perpetua','toaster','walden','xpro2','sepia','noir','fade','chrome'];
const EFFECTS:{name:string;filter:FilterName}[]=[
  {name:'Dramatic',filter:'dramatic'},{name:'Vintage',filter:'vintage'},{name:'Chrome',filter:'chrome'},
  {name:'Fade',filter:'fade'},{name:'Warm',filter:'warm'},{name:'Noir',filter:'noir'},
];
const ASPECTS:{label:string;value:CropAspect;ratio?:number}[]=[
  {label:'Free',value:'free'},{label:'Original',value:'original'},{label:'1:1',value:'1:1',ratio:1},
  {label:'4:3',value:'4:3',ratio:4/3},{label:'3:4',value:'3:4',ratio:3/4},{label:'16:9',value:'16:9',ratio:16/9},{label:'9:16',value:'9:16',ratio:9/16},
];

export interface PhotoEditorAsset{id:string;uri:string;filename:string;width?:number;height?:number;mimeType?:string}
export interface PhotoEditorScreenProps{visible:boolean;asset:PhotoEditorAsset|null;onClose():void;onSave(recipe:ImageEditRecipe,renderedUri?:string):Promise<void>|void}

function sameAdjust(a:AdjustmentState,b:AdjustmentState){return (Object.keys(a) as (keyof AdjustmentState)[]).every(k=>Math.abs(a[k]-b[k])<.0001);}
function signed(v:number,digits=0){const n=Number(v.toFixed(digits));return n>0?`+${n}`:`${n}`;}
function displayAdjust(name:keyof AdjustmentState,value:number){if(name==='brightness'||name==='contrast'||name==='saturation'||name==='gamma')return signed((value-1)*100);return signed(value*100);}

function Slider({label,value,min,max,step=.01,onBegin,onChange,onCommit}:{label:string;value:number;min:number;max:number;step?:number;onBegin?():void;onChange(v:number):void;onCommit?(v:number):void}){
  const trackW=Math.min(SCREEN-150,360);
  const ratio=Math.max(0,Math.min(1,(value-min)/(max-min)));
  const current=useRef(value);const active=useRef(false);
  const setX=(x:number)=>{const raw=min+Math.max(0,Math.min(1,x/trackW))*(max-min);const next=Number((Math.round(raw/step)*step).toFixed(3));current.current=next;onChange(next);};
  return <View style={s.sliderRow}><Text style={s.sliderLabel}>{label}</Text><View style={[s.sliderTrack,{width:trackW}]} onTouchStart={e=>{active.current=true;onBegin?.();setX(e.nativeEvent.locationX);}} onTouchMove={e=>setX(e.nativeEvent.locationX)} onTouchEnd={()=>{if(active.current)onCommit?.(current.current);active.current=false;}}><View style={s.sliderBase}/><View style={[s.sliderFill,{width:ratio*trackW}]}/><View style={[s.sliderThumb,{left:Math.max(0,Math.min(trackW-12,ratio*trackW-6))}]}/></View><Text style={s.sliderValue}>{displayAdjust(label.toLowerCase() as keyof AdjustmentState,value)}</Text></View>;
}

export function PhotoEditorScreen({visible,asset,onClose,onSave}:PhotoEditorScreenProps){
  const sessionRef=useRef<EditSession|null>(null);
  const historyRef=useRef<Snapshot[]>([]);const futureRef=useRef<Snapshot[]>([]);const gestureStart=useRef<Snapshot|null>(null);
  const [workingUri,setWorkingUri]=useState<string|null>(null);
  const [size,setSize]=useState({width:1,height:1});
  const [mode,setMode]=useState<Mode>('presets');
  const [adjustTab,setAdjustTab]=useState<AdjustTab>('light');
  const [filter,setFilter]=useState<FilterName>('custom');
  const [intensity,setIntensity]=useState(1);
  const [adjust,setAdjust]=useState<AdjustmentState>(DEFAULT_ADJUST);
  const [cropRect,setCropRect]=useState<CropRect|null>(null);
  const [cropAspect,setCropAspect]=useState<CropAspect>('free');
  const [cropRatio,setCropRatio]=useState<number|undefined>();
  const [straighten,setStraighten]=useState(0);
  const [compare,setCompare]=useState(false);
  const [busy,setBusy]=useState(false);
  const [historyVersion,setHistoryVersion]=useState(0);
  const [exportFormat,setExportFormat]=useState<ExportFormat>('jpeg');
  const [exportQuality,setExportQuality]=useState(.9);
  const [resolution,setResolution]=useState<Resolution>('original');
  const [presetCategory,setPresetCategory]=useState('recommended');

  useEffect(()=>{
    if(!asset)return;
    sessionRef.current=new EditSession({uri:asset.uri,width:asset.width,height:asset.height,mimeType:asset.mimeType});
    historyRef.current=[];futureRef.current=[];setHistoryVersion(v=>v+1);
    setWorkingUri(asset.uri);setSize({width:asset.width||1,height:asset.height||1});setMode('presets');setAdjustTab('light');
    setFilter('custom');setIntensity(1);setAdjust(DEFAULT_ADJUST);setCropRect(null);setCropAspect('free');setCropRatio(undefined);setStraighten(0);
    setExportFormat('jpeg');setExportQuality(.9);setResolution('original');
  },[asset?.id,asset?.uri]);

  const session=sessionRef.current;
  const customParams=useMemo<CustomFilterParams>(()=>({...adjust}),[adjust]);
  const previewHeight=Math.min(470,Math.max(250,PREVIEW_W*(size.height/Math.max(1,size.width))));

  function snapshot():Snapshot|null{return workingUri?{uri:workingUri,width:size.width,height:size.height,filter,intensity,adjust:{...adjust},cropAspect,cropRatio,straighten}:null;}
  function remember(before:Snapshot|null){if(!before)return;historyRef.current.push(before);if(historyRef.current.length>80)historyRef.current.shift();futureRef.current=[];setHistoryVersion(v=>v+1);}
  function restore(v:Snapshot){setWorkingUri(v.uri);setSize({width:v.width,height:v.height});setFilter(v.filter);setIntensity(v.intensity);setAdjust(v.adjust);setCropAspect(v.cropAspect);setCropRatio(v.cropRatio);setStraighten(v.straighten);setCropRect(null);}
  function undo(){const prev=historyRef.current.pop();const cur=snapshot();if(!prev||!cur)return;futureRef.current.push(cur);session?.undo();restore(prev);setHistoryVersion(v=>v+1);}
  function redo(){const next=futureRef.current.pop();const cur=snapshot();if(!next||!cur)return;historyRef.current.push(cur);session?.redo();restore(next);setHistoryVersion(v=>v+1);}

  async function bakeVisuals():Promise<{uri:string;width:number;height:number}>{
    if(!workingUri)throw new Error('Không có ảnh đang chỉnh.');
    const hasCustom=!sameAdjust(adjust,DEFAULT_ADJUST);
    if(filter==='custom'&&!hasCustom)return {uri:workingUri,width:size.width,height:size.height};
    const result=await applyFilter({sourceUri:workingUri,filter,intensity,customParams:filter==='custom'?customParams:undefined,returnFormat:'uri',quality:100});
    if(!result.uri)throw new Error('Không thể kết xuất bước chỉnh hiện tại.');
    setWorkingUri(result.uri);setSize({width:result.width,height:result.height});setFilter('custom');setIntensity(1);setAdjust(DEFAULT_ADJUST);
    return {uri:result.uri,width:result.width,height:result.height};
  }

  async function openMode(next:Mode){
    if(next===mode)return;
    setBusy(true);
    try{
      if(next==='adjust'&&filter!=='custom')await bakeVisuals();
      if((next==='presets'||next==='filters'||next==='effects'||next==='crop'||next==='export')&&filter==='custom'&&!sameAdjust(adjust,DEFAULT_ADJUST))await bakeVisuals();
      setMode(next);
    }catch(e){Alert.alert('Không thể chuyển công cụ',e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }

  function chooseFilter(next:FilterName,nextIntensity=1){const before=snapshot();setFilter(next);setIntensity(nextIntensity);session?.apply({id:`filter:${Date.now()}`,type:'filter',filterId:String(next),intensity:nextIntensity});remember(before);}
  function beginAdjustment(){gestureStart.current=snapshot();}
  function commitAdjustment(name:keyof AdjustmentState,value:number){session?.apply({id:`adjust:${name}:${Date.now()}`,type:'adjust',name:name as AdjustmentName,value});remember(gestureStart.current);gestureStart.current=null;}
  function setAdjustment(name:keyof AdjustmentState,value:number){setFilter('custom');setAdjust(v=>({...v,[name]:value}));}

  async function applyCropNow(){if(!workingUri||!cropRect)return;const before=snapshot();setBusy(true);try{const baked=await bakeVisuals();const result=await cropImage({sourceUri:baked.uri,cropRect,returnFormat:'uri',quality:100});if(!result.uri)throw new Error('Crop không trả file.');session?.apply({id:`crop:${Date.now()}`,type:'crop',rect:{x:cropRect.x/Math.max(1,size.width),y:cropRect.y/Math.max(1,size.height),width:cropRect.width/Math.max(1,size.width),height:cropRect.height/Math.max(1,size.height),aspect:cropAspect}});remember(before);setWorkingUri(result.uri);setSize({width:result.width,height:result.height});setCropRect(null);}catch(e){Alert.alert('Crop thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function rotate(degrees:90|180|270){if(!workingUri)return;const before=snapshot();setBusy(true);try{const baked=await bakeVisuals();const result=await rotateImage({sourceUri:baked.uri,degrees,expand:true,returnFormat:'uri',quality:100});if(!result.uri)throw new Error('Rotate không trả file.');session?.apply({id:`rotate:${Date.now()}`,type:'rotate',degrees});remember(before);setWorkingUri(result.uri);setSize({width:result.width,height:result.height});}catch(e){Alert.alert('Xoay ảnh thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function flip(axis:'horizontal'|'vertical'){if(!workingUri)return;const before=snapshot();setBusy(true);try{const baked=await bakeVisuals();const result=await ImageManipulator.manipulateAsync(baked.uri,[{flip:axis==='horizontal'?ImageManipulator.FlipType.Horizontal:ImageManipulator.FlipType.Vertical}],{compress:1,format:ImageManipulator.SaveFormat.JPEG});session?.apply({id:`flip:${Date.now()}`,type:'flip',axis});remember(before);setWorkingUri(result.uri);setSize({width:result.width,height:result.height});}catch(e){Alert.alert('Lật ảnh thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function straightenNow(){if(!workingUri||Math.abs(straighten)<.05)return;const before=snapshot();setBusy(true);try{const baked=await bakeVisuals();const result=await rotateImage({sourceUri:baked.uri,degrees:straighten,expand:true,returnFormat:'uri',quality:100});if(!result.uri)throw new Error('Straighten không trả file.');session?.apply({id:`straighten:${Date.now()}`,type:'straighten',degrees:straighten});remember(before);setWorkingUri(result.uri);setSize({width:result.width,height:result.height});setStraighten(0);}catch(e){Alert.alert('Căn thẳng thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}}

  async function exportNow(){if(!asset||!session||!workingUri)return;setBusy(true);try{
    let source=workingUri;let w=size.width,h=size.height;
    const visual=await applyFilter({sourceUri:source,filter,intensity,customParams:filter==='custom'?customParams:undefined,returnFormat:'uri',quality:100});if(visual.uri){source=visual.uri;w=visual.width;h=visual.height;}
    const max=resolution==='original'?undefined:resolution==='2048'?2048:1080;const actions:ImageManipulator.Action[]=[];
    if(max&&Math.max(w,h)>max){if(w>=h)actions.push({resize:{width:max}});else actions.push({resize:{height:max}});}
    const format=exportFormat==='png'?ImageManipulator.SaveFormat.PNG:exportFormat==='webp'?ImageManipulator.SaveFormat.WEBP:ImageManipulator.SaveFormat.JPEG;
    const out=await ImageManipulator.manipulateAsync(source,actions,{compress:exportFormat==='png'?1:exportQuality,format});
    await onSave(session.recipe({assetId:asset.id,filename:asset.filename,export:{format:exportFormat,quality:exportQuality,resolution}}),out.uri);
  }catch(e){Alert.alert('Export thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}}

  function reset(){if(!asset)return;const before=snapshot();session?.reset();remember(before);setWorkingUri(asset.uri);setSize({width:asset.width||1,height:asset.height||1});setFilter('custom');setIntensity(1);setAdjust(DEFAULT_ADJUST);setCropRect(null);setCropAspect('free');setCropRatio(undefined);setStraighten(0);}

  if(!asset||!workingUri||!session)return null;
  const canUndo=historyRef.current.length>0,canRedo=futureRef.current.length>0;void historyVersion;
  const recipe=session.recipe({assetId:asset.id,filename:asset.filename});

  const preview=<View style={[s.preview,{height:previewHeight}]}> {mode==='crop'?<CropperView source={{uri:workingUri}} aspectRatio={cropRatio} showGrid gridColor="#FFFFFFCC" overlayColor="rgba(0,0,0,.52)" onCropRectChange={setCropRect} onGestureEnd={setCropRect} style={StyleSheet.absoluteFill}/>:compare?<Image source={{uri:asset.uri}} style={StyleSheet.absoluteFill} contentFit="contain"/>:<FilteredImageView source={{uri:workingUri}} filter={filter} intensity={intensity} customParams={filter==='custom'?customParams:undefined} resizeMode="contain" style={StyleSheet.absoluteFill}/>} </View>;

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><SafeAreaView style={s.root}>
    <View style={s.header}><View style={s.headerSide}><Pressable onPress={onClose}><Text style={s.close}>×</Text></Pressable><Pressable disabled={!canUndo||busy} onPress={undo}><Text style={[s.undo,(!canUndo||busy)&&s.off]}>↶</Text></Pressable><Pressable disabled={!canRedo||busy} onPress={redo}><Text style={[s.undo,(!canRedo||busy)&&s.off]}>↷</Text></Pressable></View><Text style={s.headerTitle}>{mode==='crop'?'Crop':mode==='history'?'History':mode==='export'?'Export':'Edit'}</Text><View style={s.headerSideRight}>{mode!=='export'&&mode!=='history'&&mode!=='crop'?<Pressable onPressIn={()=>setCompare(true)} onPressOut={()=>setCompare(false)} style={s.compareBtn}><Text style={s.compareText}>Compare</Text></Pressable>:null}{mode==='crop'?<Pressable disabled={!cropRect||busy} onPress={()=>void applyCropNow()}><Text style={s.check}>✓</Text></Pressable>:mode==='history'?<View style={{width:28}}/>:<Pressable disabled={busy} onPress={()=>mode==='export'?void exportNow():void openMode('export')} style={s.saveBtn}><Text style={s.saveText}>{busy?'…':mode==='export'?'Export':'Save'}</Text></Pressable>}</View></View>

    {mode==='history'?<HistoryPanel recipe={recipe} onReset={reset}/>:mode==='export'?<ExportPanel format={exportFormat} setFormat={setExportFormat} quality={exportQuality} setQuality={setExportQuality} resolution={resolution} setResolution={setResolution} busy={busy} onExport={()=>void exportNow()}/>:<>
      {preview}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolBar}>{(['presets','adjust','crop','filters','effects'] as Mode[]).map(m=><Pressable key={m} onPress={()=>void openMode(m)} style={s.toolItem}><View style={[s.toolIcon,mode===m&&s.toolIconActive]}><Text style={[s.toolIconText,mode===m&&s.purple]}>{m==='presets'?'✣':m==='adjust'?'☼':m==='crop'?'⌗':m==='filters'?'▦':'◉'}</Text></View><Text style={[s.toolText,mode===m&&s.purple]}>{m[0].toUpperCase()+m.slice(1)}</Text></Pressable>)}</ScrollView>
      <View style={s.panel}>{mode==='presets'&&<PresetPanel uri={workingUri} filter={filter} intensity={intensity} category={presetCategory} setCategory={setPresetCategory} onChoose={p=>chooseFilter(p.filter,p.intensity)} onIntensity={v=>setIntensity(v)}/>} {mode==='filters'&&<FilterPanel uri={workingUri} filter={filter} intensity={intensity} onChoose={f=>chooseFilter(f,1)} onIntensity={setIntensity}/>} {mode==='effects'&&<EffectPanel uri={workingUri} filter={filter} intensity={intensity} onChoose={f=>chooseFilter(f,.7)} onIntensity={setIntensity}/>} {mode==='adjust'&&<AdjustPanel tab={adjustTab} setTab={setAdjustTab} value={adjust} onBegin={beginAdjustment} onChange={setAdjustment} onCommit={commitAdjustment}/>} {mode==='crop'&&<CropPanel aspect={cropAspect} setAspect={(a,r)=>{setCropAspect(a);setCropRatio(r);}} straighten={straighten} setStraighten={setStraighten} onStraighten={()=>void straightenNow()} onRotate={()=>void rotate(90)} onFlipH={()=>void flip('horizontal')} onFlipV={()=>void flip('vertical')} busy={busy}/>}</View>
      <View style={s.footer}><Pressable onPress={()=>void openMode('history')}><Text style={s.footerText}>History</Text></Pressable><Pressable onPress={reset}><Text style={s.footerText}>Reset</Text></Pressable><Pressable onPress={()=>void openMode('export')}><Text style={s.footerText}>More</Text></Pressable></View>
    </>}
  </SafeAreaView></Modal>;
}

function PresetPanel({uri,filter,intensity,category,setCategory,onChoose,onIntensity}:{uri:string;filter:FilterName;intensity:number;category:string;setCategory(v:string):void;onChoose(v:Preset):void;onIntensity(v:number):void}){const cats=['recommended','portrait','landscape','food','night','film'];const items=PRESETS.filter(p=>category==='recommended'?true:p.category===category);return <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>{cats.map(c=><Pressable key={c} onPress={()=>setCategory(c)}><Text style={[s.tab,c===category&&s.tabActive]}>{c[0].toUpperCase()+c.slice(1)}</Text></Pressable>)}</ScrollView><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.presetRow}>{items.map(p=><Pressable key={p.id} style={[s.presetCard,filter===p.filter&&Math.abs(intensity-p.intensity)<.02&&s.selectedCard]} onPress={()=>onChoose(p)}><FilteredImageView source={{uri}} filter={p.filter} intensity={p.intensity} resizeMode="cover" style={s.thumbImage}/><Text style={s.presetName}>{p.name}</Text></Pressable>)}</ScrollView><SimpleSlider label="Intensity" value={intensity} min={0} max={1} onChange={onIntensity}/></>}
function FilterPanel({uri,filter,intensity,onChoose,onIntensity}:{uri:string;filter:FilterName;intensity:number;onChoose(v:FilterName):void;onIntensity(v:number):void}){return <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.presetRow}><Pressable style={[s.presetCard,filter==='custom'&&s.selectedCard]} onPress={()=>onChoose('custom')}><Image source={{uri}} style={s.thumbImage}/><Text style={s.presetName}>Original</Text></Pressable>{FILTERS.map(f=><Pressable key={f} style={[s.presetCard,filter===f&&s.selectedCard]} onPress={()=>onChoose(f)}><FilteredImageView source={{uri}} filter={f} intensity={1} resizeMode="cover" style={s.thumbImage}/><Text style={s.presetName}>{f}</Text></Pressable>)}</ScrollView><SimpleSlider label="Intensity" value={intensity} min={0} max={1} onChange={onIntensity}/></>}
function EffectPanel({uri,filter,intensity,onChoose,onIntensity}:{uri:string;filter:FilterName;intensity:number;onChoose(v:FilterName):void;onIntensity(v:number):void}){return <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.presetRow}>{EFFECTS.map(e=><Pressable key={e.name} style={[s.effectCard,filter===e.filter&&s.selectedCard]} onPress={()=>onChoose(e.filter)}><FilteredImageView source={{uri}} filter={e.filter} intensity={.75} resizeMode="cover" style={s.effectThumb}/><Text style={s.presetName}>{e.name}</Text></Pressable>)}</ScrollView><SimpleSlider label="Intensity" value={intensity} min={0} max={1} onChange={onIntensity}/></>}

function AdjustPanel({tab,setTab,value,onBegin,onChange,onCommit}:{tab:AdjustTab;setTab(v:AdjustTab):void;value:AdjustmentState;onBegin():void;onChange(k:keyof AdjustmentState,v:number):void;onCommit(k:keyof AdjustmentState,v:number):void}){const rows:Record<AdjustTab,[keyof AdjustmentState,string,number,number][]>={light:[['exposure','Exposure',-2,2],['brightness','Brightness',.5,1.5],['contrast','Contrast',.5,1.5],['highlights','Highlights',-1,1],['shadows','Shadows',-1,1],['gamma','Gamma',.5,1.5]],color:[['temperature','Temp',-1,1],['tint','Tint',-1,1],['vibrance','Vibrance',-1,1],['saturation','Saturation',0,2],['hue','Hue',-1,1]],detail:[['sharpness','Sharpness',0,2]]};return <><View style={s.adjustTabs}>{(['light','color','detail'] as AdjustTab[]).map(t=><Pressable key={t} onPress={()=>setTab(t)} style={[s.adjustTab,tab===t&&s.adjustTabActive]}><Text style={[s.adjustTabText,tab===t&&s.purple]}>{t[0].toUpperCase()+t.slice(1)}</Text></Pressable>)}</View><ScrollView contentContainerStyle={s.adjustList}>{rows[tab].map(([key,label,min,max])=><Slider key={key} label={label} value={value[key]} min={min} max={max} onBegin={onBegin} onChange={v=>onChange(key,v)} onCommit={v=>onCommit(key,v)}/>)}</ScrollView></>}
function CropPanel({aspect,setAspect,straighten,setStraighten,onStraighten,onRotate,onFlipH,onFlipV,busy}:{aspect:CropAspect;setAspect(a:CropAspect,r?:number):void;straighten:number;setStraighten(v:number):void;onStraighten():void;onRotate():void;onFlipH():void;onFlipV():void;busy:boolean}){return <ScrollView><Text style={s.groupTitle}>Aspect ratio</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.aspectRow}>{ASPECTS.map(a=><Pressable key={a.label} onPress={()=>setAspect(a.value,a.ratio)} style={[s.aspect,aspect===a.value&&s.aspectActive]}><Text style={s.aspectIcon}>▣</Text><Text style={[s.aspectText,aspect===a.value&&s.purple]}>{a.label}</Text></Pressable>)}</ScrollView><Text style={s.groupTitle}>Rotate & Flip</Text><SimpleSlider label="Straighten" value={straighten} min={-45} max={45} onChange={setStraighten}/><View style={s.rotateRow}><Pressable disabled={busy} style={s.rotateBtn} onPress={onFlipH}><Text style={s.rotateIcon}>↔</Text></Pressable><Pressable disabled={busy} style={s.rotateBtn} onPress={onFlipV}><Text style={s.rotateIcon}>↕</Text></Pressable><Pressable disabled={busy} style={s.rotateBtn} onPress={onRotate}><Text style={s.rotateIcon}>↻</Text></Pressable><Pressable disabled={busy||Math.abs(straighten)<.05} style={s.rotateBtn} onPress={onStraighten}><Text style={s.rotateIcon}>✓</Text></Pressable></View></ScrollView>}

function HistoryPanel({recipe,onReset}:{recipe:ImageEditRecipe;onReset():void}){return <View style={s.fullPanel}><ScrollView contentContainerStyle={{padding:16}}><HistoryRow title="Original" detail="Source"/>{recipe.operations.map((op,i)=><HistoryRow key={op.id} title={op.type==='adjust'?(op as any).name:op.type} detail={op.type==='filter'?`${Math.round((op as any).intensity*100)}%`:op.type==='rotate'?`${(op as any).degrees}°`:op.type==='straighten'?`${(op as any).degrees.toFixed(1)}°`:''}/>)}</ScrollView><Pressable style={s.resetBottom} onPress={onReset}><Text style={s.resetText}>Reset all edits</Text></Pressable></View>}
function HistoryRow({title,detail}:{title:string;detail:string}){return <View style={s.historyRow}><View style={s.historyThumb}><Text style={s.historyThumbText}>▧</Text></View><Text style={s.historyName}>{title[0].toUpperCase()+title.slice(1)}</Text><Text style={s.historyDetail}>{detail}</Text></View>}
function ExportPanel({format,setFormat,quality,setQuality,resolution,setResolution,busy,onExport}:{format:ExportFormat;setFormat(v:ExportFormat):void;quality:number;setQuality(v:number):void;resolution:Resolution;setResolution(v:Resolution):void;busy:boolean;onExport():void}){return <View style={s.fullPanel}><ScrollView contentContainerStyle={s.exportBody}><Text style={s.groupTitle}>Settings</Text><ChoiceRow label="Resolution" value={resolution} values={['original','2048','1080']} onChange={v=>setResolution(v as Resolution)}/><ChoiceRow label="Format" value={format.toUpperCase()} values={['jpeg','png','webp']} onChange={v=>setFormat(v as ExportFormat)}/><SimpleSlider label="Quality" value={quality} min={.4} max={1} onChange={setQuality}/><View style={s.exportNote}><Text style={s.exportNoteText}>Export tạo file mới, không ghi đè ảnh gốc. JPEG/PNG/WebP và resize được xử lý thật trên file full-resolution.</Text></View></ScrollView><Pressable disabled={busy} style={s.exportBtn} onPress={onExport}><Text style={s.exportBtnText}>{busy?'Exporting…':'Export'}</Text></Pressable></View>}
function ChoiceRow({label,value,values,onChange}:{label:string;value:string;values:string[];onChange(v:string):void}){return <View style={s.choiceRow}><Text style={s.choiceLabel}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{values.map(v=><Pressable key={v} onPress={()=>onChange(v)} style={[s.choicePill,value.toLowerCase()===v&&s.choicePillActive]}><Text style={s.choiceText}>{v.toUpperCase()}</Text></Pressable>)}</ScrollView></View>}
function SimpleSlider({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange(v:number):void}){const width=Math.min(SCREEN-130,380);const ratio=Math.max(0,Math.min(1,(value-min)/(max-min)));const setX=(x:number)=>onChange(Number((min+Math.max(0,Math.min(1,x/width))*(max-min)).toFixed(2)));return <View style={s.simpleRow}><Text style={s.simpleLabel}>{label}</Text><View style={[s.simpleTrack,{width}]} onTouchStart={e=>setX(e.nativeEvent.locationX)} onTouchMove={e=>setX(e.nativeEvent.locationX)}><View style={s.sliderBase}/><View style={[s.sliderFill,{width:ratio*width}]}/><View style={[s.sliderThumb,{left:Math.max(0,Math.min(width-12,ratio*width-6))}]}/></View><Text style={s.simpleValue}>{Math.abs(max)<=1?Math.round(value*100):Number(value.toFixed(1))}</Text></View>}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:BG},header:{height:58,paddingHorizontal:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#090A0D'},headerSide:{width:100,flexDirection:'row',alignItems:'center',gap:18},headerSideRight:{minWidth:100,flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:10},headerTitle:{color:TEXT,fontWeight:'700',fontSize:14},close:{color:TEXT,fontSize:28,fontWeight:'200'},undo:{color:TEXT,fontSize:22},off:{opacity:.25},compareBtn:{borderWidth:1,borderColor:'#41444D',borderRadius:6,paddingHorizontal:9,paddingVertical:6},compareText:{color:TEXT,fontSize:10},saveBtn:{backgroundColor:PURPLE,borderRadius:7,paddingHorizontal:14,paddingVertical:7},saveText:{color:'#fff',fontSize:11,fontWeight:'700'},check:{color:'#fff',fontSize:22},
  preview:{width:'100%',backgroundColor:'#050506',overflow:'hidden'},toolBar:{paddingHorizontal:12,paddingVertical:9,gap:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#24262B'},toolItem:{width:58,alignItems:'center'},toolIcon:{width:32,height:30,borderRadius:7,alignItems:'center',justifyContent:'center'},toolIconActive:{backgroundColor:'#25183A'},toolIconText:{color:'#C7C9D0',fontSize:16},toolText:{fontSize:10,color:'#C3C5CC',marginTop:3},purple:{color:PURPLE},
  panel:{flex:1,minHeight:260,backgroundColor:PANEL,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#22252B'},tabs:{paddingHorizontal:12,paddingVertical:11,gap:22},tab:{color:MUTED,fontSize:10},tabActive:{color:PURPLE,borderBottomWidth:1,borderBottomColor:PURPLE,paddingBottom:7},presetRow:{paddingHorizontal:10,paddingTop:4,paddingBottom:12,gap:8},presetCard:{width:72,borderRadius:8,overflow:'hidden',backgroundColor:PANEL_2,borderWidth:1,borderColor:'transparent'},selectedCard:{borderColor:PURPLE},thumbImage:{height:72,width:'100%'},presetName:{fontSize:9,color:TEXT,textAlign:'center',paddingVertical:6,textTransform:'capitalize'},effectCard:{width:82,borderRadius:8,overflow:'hidden',backgroundColor:PANEL_2,borderWidth:1,borderColor:'transparent'},effectThumb:{height:72,width:'100%'},
  sliderRow:{height:44,flexDirection:'row',alignItems:'center',paddingHorizontal:14},sliderLabel:{width:82,color:'#E4E5E8',fontSize:11},sliderTrack:{height:28,justifyContent:'center'},sliderBase:{height:2,backgroundColor:'#4A4D54',position:'absolute',left:0,right:0},sliderFill:{height:2,backgroundColor:PURPLE},sliderThumb:{position:'absolute',width:12,height:12,borderRadius:6,backgroundColor:'#fff',borderWidth:3,borderColor:PURPLE},sliderValue:{width:48,textAlign:'right',color:'#D6D8DD',fontSize:10},simpleRow:{height:50,flexDirection:'row',alignItems:'center',paddingHorizontal:14},simpleLabel:{width:82,color:TEXT,fontSize:11},simpleTrack:{height:30,justifyContent:'center'},simpleValue:{width:42,textAlign:'right',color:'#D6D8DD',fontSize:10},
  adjustTabs:{height:44,flexDirection:'row',alignItems:'flex-end',paddingHorizontal:18,gap:34},adjustTab:{paddingBottom:10},adjustTabActive:{borderBottomWidth:1,borderBottomColor:PURPLE},adjustTabText:{fontSize:10,color:MUTED},adjustList:{paddingVertical:8,paddingBottom:30},groupTitle:{fontSize:11,color:'#DADCE1',fontWeight:'700',marginHorizontal:14,marginTop:14,marginBottom:8},aspectRow:{paddingHorizontal:10,gap:8},aspect:{width:58,height:60,borderRadius:8,backgroundColor:PANEL_2,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'transparent'},aspectActive:{borderColor:PURPLE},aspectIcon:{color:'#D4D6DC',fontSize:18},aspectText:{fontSize:9,color:MUTED,marginTop:5},rotateRow:{flexDirection:'row',padding:14,gap:12},rotateBtn:{width:52,height:45,borderRadius:9,backgroundColor:PANEL_2,alignItems:'center',justifyContent:'center'},rotateIcon:{fontSize:20,color:TEXT},
  footer:{height:48,backgroundColor:'#0D0E11',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#25272C',flexDirection:'row',alignItems:'center',justifyContent:'space-around'},footerText:{fontSize:10,color:'#D0D2D7'},fullPanel:{flex:1,backgroundColor:BG},historyRow:{height:64,backgroundColor:PANEL_2,borderRadius:7,marginBottom:7,paddingHorizontal:10,flexDirection:'row',alignItems:'center'},historyThumb:{width:38,height:38,borderRadius:5,backgroundColor:'#30333A',alignItems:'center',justifyContent:'center'},historyThumbText:{color:'#777'},historyName:{flex:1,color:TEXT,fontSize:12,marginLeft:10,textTransform:'capitalize'},historyDetail:{color:'#C5C7CD',fontSize:11},resetBottom:{height:54,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#292B31',alignItems:'center',justifyContent:'center'},resetText:{color:TEXT,fontSize:11},
  exportBody:{padding:16},choiceRow:{minHeight:64,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#282B31',flexDirection:'row',alignItems:'center'},choiceLabel:{width:90,color:TEXT,fontSize:11},choicePill:{borderWidth:1,borderColor:'#333740',borderRadius:7,paddingHorizontal:10,paddingVertical:7,marginRight:6},choicePillActive:{borderColor:PURPLE,backgroundColor:'#241735'},choiceText:{color:'#E3E4E8',fontSize:9},exportNote:{marginTop:22,padding:14,borderRadius:10,backgroundColor:PANEL_2},exportNoteText:{fontSize:11,color:MUTED,lineHeight:17},exportBtn:{height:46,borderRadius:23,backgroundColor:PURPLE,margin:18,alignItems:'center',justifyContent:'center'},exportBtnText:{color:'#fff',fontSize:12,fontWeight:'700'},
});