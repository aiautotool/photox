import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { Image } from 'expo-image';
import { EditSession, type AdjustmentName, type CropAspect, type ImageEditRecipe } from '@photox/image-editor';

const PURPLE='#8B5CF6', BG='#090A0C', PANEL='#111216', MUTED='#8A8D95';
const SCREEN=Dimensions.get('window').width;
const PREVIEW_W=Math.min(SCREEN-24,520);

type Tool='filters'|'adjust'|'crop'|'rotate';
type AdjustmentState={brightness:number;contrast:number;saturation:number;exposure:number;temperature:number;tint:number;sharpness:number;vibrance:number};
const DEFAULTS:AdjustmentState={brightness:1,contrast:1,saturation:1,exposure:0,temperature:0,tint:0,sharpness:0,vibrance:0};
const FILTERS:FilterName[]=['vivid','dramatic','warm','cool','vintage','clarendon','juno','lark','reyes','valencia','brooklyn','earlybird','hudson','inkwell','lofi','mayfair','nashville','perpetua','toaster','walden','xpro2','sepia','noir','fade','chrome'];
const ASPECTS:{label:string;value:CropAspect;ratio?:number}[]=[
  {label:'Free',value:'free'},
  {label:'1:1',value:'1:1',ratio:1},
  {label:'4:3',value:'4:3',ratio:4/3},
  {label:'3:4',value:'3:4',ratio:3/4},
  {label:'16:9',value:'16:9',ratio:16/9},
  {label:'9:16',value:'9:16',ratio:9/16},
];

export interface PhotoEditorAsset{id:string;uri:string;filename:string;width?:number;height?:number;mimeType?:string}
export interface PhotoEditorScreenProps{visible:boolean;asset:PhotoEditorAsset|null;onClose():void;onSave(recipe:ImageEditRecipe,renderedUri?:string):Promise<void>|void}

function Slider({label,value,min,max,step=0.05,onChange}:{label:string;value:number;min:number;max:number;step?:number;onChange(v:number):void}){
  const width=Math.min(SCREEN-150,300);
  const ratio=(value-min)/(max-min);
  const setX=(x:number)=>{const raw=min+Math.max(0,Math.min(1,x/width))*(max-min);onChange(Number((Math.round(raw/step)*step).toFixed(2)));};
  return <View style={s.sliderRow}><Text style={s.sliderLabel}>{label}</Text><View style={[s.track,{width}]} onTouchStart={e=>setX(e.nativeEvent.locationX)} onTouchMove={e=>setX(e.nativeEvent.locationX)}><View style={s.trackBase}/><View style={[s.trackFill,{width:Math.max(0,Math.min(width,ratio*width))}]}/><View style={[s.thumb,{left:Math.max(0,Math.min(width-14,ratio*width-7))}]}/></View><Text style={s.sliderValue}>{value}</Text></View>;
}

export function PhotoEditorScreen({visible,asset,onClose,onSave}:PhotoEditorScreenProps){
  const sessionRef=useRef<EditSession|null>(null);
  const [workingUri,setWorkingUri]=useState<string|null>(null);
  const [size,setSize]=useState({width:1,height:1});
  const [tool,setTool]=useState<Tool>('filters');
  const [filter,setFilter]=useState<FilterName>('custom');
  const [intensity,setIntensity]=useState(1);
  const [adjust,setAdjust]=useState<AdjustmentState>(DEFAULTS);
  const [cropRect,setCropRectState]=useState<CropRect|null>(null);
  const [cropAspect,setCropAspect]=useState<CropAspect>('free');
  const [cropRatio,setCropRatio]=useState<number|undefined>();
  const [compare,setCompare]=useState(false);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    if(!asset)return;
    sessionRef.current=new EditSession({uri:asset.uri,width:asset.width,height:asset.height,mimeType:asset.mimeType});
    setWorkingUri(asset.uri);
    setSize({width:asset.width||1,height:asset.height||1});
    setFilter('custom');setIntensity(1);setAdjust(DEFAULTS);setCropRectState(null);setCropAspect('free');
  },[asset?.id,asset?.uri]);

  const session=sessionRef.current;
  const customParams=useMemo<CustomFilterParams>(()=>({...adjust}),[adjust]);
  const previewHeight=Math.min(460,Math.max(280,PREVIEW_W*(size.height/Math.max(1,size.width))));

  function setAdjustment(name:keyof AdjustmentState,value:number){
    setFilter('custom');
    setAdjust(prev=>({...prev,[name]:value}));
    session?.apply({id:`adjust:${name}`,type:'adjust',name:name as AdjustmentName,value});
  }

  function pickFilter(name:FilterName){
    setFilter(name);
    setIntensity(1);
    session?.apply({id:`filter:${Date.now()}`,type:'filter',filterId:String(name),intensity:1});
  }

  async function applyCrop(){
    if(!workingUri||!cropRect)return;
    setBusy(true);
    try{
      const result=await cropImage({sourceUri:workingUri,cropRect,returnFormat:'uri',quality:95});
      if(!result.uri)throw new Error('Crop không trả về file ảnh.');
      session?.apply({id:`crop:${Date.now()}`,type:'crop',rect:{x:cropRect.x/Math.max(1,size.width),y:cropRect.y/Math.max(1,size.height),width:cropRect.width/Math.max(1,size.width),height:cropRect.height/Math.max(1,size.height),aspect:cropAspect}});
      setWorkingUri(result.uri);setSize({width:result.width,height:result.height});setCropRectState(null);setTool('filters');
    }catch(e){Alert.alert('Crop thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }

  async function rotate(degrees:number){
    if(!workingUri)return;
    setBusy(true);
    try{
      const result=await rotateImage({sourceUri:workingUri,degrees,expand:true,returnFormat:'uri',quality:95});
      if(!result.uri)throw new Error('Rotate không trả về file ảnh.');
      session?.apply({id:`rotate:${Date.now()}`,type:'rotate',degrees:degrees as 90|180|270});
      setWorkingUri(result.uri);setSize({width:result.width,height:result.height});
    }catch(e){Alert.alert('Xoay ảnh thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }

  async function saveNow(){
    if(!asset||!session||!workingUri)return;
    setBusy(true);
    try{
      const result=await applyFilter({sourceUri:workingUri,filter,intensity,customParams:filter==='custom'?customParams:undefined,returnFormat:'uri',quality:95});
      if(!result.uri)throw new Error('Editor không trả về file ảnh.');
      await onSave(session.recipe({assetId:asset.id,filename:asset.filename}),result.uri);
    }catch(e){Alert.alert('Lưu ảnh thất bại',e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }

  function reset(){
    if(!asset)return;
    session?.reset();setWorkingUri(asset.uri);setSize({width:asset.width||1,height:asset.height||1});setFilter('custom');setIntensity(1);setAdjust(DEFAULTS);setCropRectState(null);setCropAspect('free');
  }

  if(!asset||!workingUri||!session)return null;

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><SafeAreaView style={s.root}>
    <View style={s.header}><Pressable onPress={onClose}><Text style={s.close}>×</Text></Pressable><Text style={s.title}>Edit Photo</Text><Pressable disabled={busy} onPress={()=>void saveNow()} style={[s.save,busy&&s.disabled]}><Text style={s.saveText}>{busy?'Working…':'Save'}</Text></Pressable></View>

    <View style={[s.preview,{height:previewHeight}]}>
      {tool==='crop'?<CropperView source={{uri:workingUri}} aspectRatio={cropRatio} showGrid gridColor="#fff" overlayColor="rgba(0,0,0,.48)" onCropRectChange={setCropRectState} onGestureEnd={setCropRectState} style={StyleSheet.absoluteFill}/>:compare?<Image source={{uri:workingUri}} contentFit="contain" style={StyleSheet.absoluteFill}/>:<FilteredImageView source={{uri:workingUri}} filter={filter} intensity={intensity} customParams={filter==='custom'?customParams:undefined} resizeMode="contain" style={StyleSheet.absoluteFill} onError={e=>console.warn('Photo editor preview error',e)}/>}
      {tool!=='crop'&&<Pressable style={s.compare} onPressIn={()=>setCompare(true)} onPressOut={()=>setCompare(false)}><Text style={s.compareText}>Hold Original</Text></Pressable>}
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tools}>{(['filters','adjust','crop','rotate'] as Tool[]).map(t=><Pressable key={t} onPress={()=>setTool(t)} style={[s.tool,t===tool&&s.toolActive]}><Text style={[s.toolText,t===tool&&s.activeText]}>{t[0].toUpperCase()+t.slice(1)}</Text></Pressable>)}</ScrollView>

    <View style={s.panel}>
      {tool==='filters'&&<><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cards}><Pressable onPress={()=>pickFilter('custom')} style={[s.card,filter==='custom'&&s.cardActive]}><Text style={s.cardTitle}>Original</Text></Pressable>{FILTERS.map(f=><Pressable key={f} onPress={()=>pickFilter(f)} style={[s.card,filter===f&&s.cardActive]}><Text style={s.cardTitle}>{f}</Text></Pressable>)}</ScrollView><Slider label="Intensity" value={intensity} min={0} max={1} step={0.05} onChange={setIntensity}/></>}
      {tool==='adjust'&&<ScrollView contentContainerStyle={{paddingBottom:24}}>
        <Slider label="Brightness" value={adjust.brightness} min={0.5} max={2} onChange={v=>setAdjustment('brightness',v)}/>
        <Slider label="Contrast" value={adjust.contrast} min={0.5} max={2} onChange={v=>setAdjustment('contrast',v)}/>
        <Slider label="Saturation" value={adjust.saturation} min={0} max={2} onChange={v=>setAdjustment('saturation',v)}/>
        <Slider label="Exposure" value={adjust.exposure} min={-2} max={2} onChange={v=>setAdjustment('exposure',v)}/>
        <Slider label="Temperature" value={adjust.temperature} min={-1} max={1} onChange={v=>setAdjustment('temperature',v)}/>
        <Slider label="Tint" value={adjust.tint} min={-1} max={1} onChange={v=>setAdjustment('tint',v)}/>
        <Slider label="Sharpness" value={adjust.sharpness} min={0} max={2} onChange={v=>setAdjustment('sharpness',v)}/>
        <Slider label="Vibrance" value={adjust.vibrance} min={0} max={2} onChange={v=>setAdjustment('vibrance',v)}/>
      </ScrollView>}
      {tool==='crop'&&<View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cards}>{ASPECTS.map(a=><Pressable key={a.label} onPress={()=>{setCropAspect(a.value);setCropRatio(a.ratio);}} style={[s.card,cropAspect===a.value&&s.cardActive]}><Text style={s.cardTitle}>{a.label}</Text></Pressable>)}</ScrollView><Pressable disabled={!cropRect||busy} style={[s.applyCrop,(!cropRect||busy)&&s.disabled]} onPress={()=>void applyCrop()}><Text style={s.saveText}>Apply Crop</Text></Pressable></View>}
      {tool==='rotate'&&<View style={s.rotateRow}><Pressable style={s.action} onPress={()=>void rotate(270)}><Text style={s.actionText}>↶ 90°</Text></Pressable><Pressable style={s.action} onPress={()=>void rotate(90)}><Text style={s.actionText}>↷ 90°</Text></Pressable><Pressable style={s.action} onPress={()=>void rotate(180)}><Text style={s.actionText}>180°</Text></Pressable></View>}
    </View>

    <View style={s.bottom}><Pressable onPress={reset}><Text style={s.bottomText}>Reset</Text></Pressable><Text style={s.status}>GPU filters • native crop • full-size export</Text></View>
  </SafeAreaView></Modal>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:BG},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:'#1c1d22'},close:{fontSize:34,color:'#fff',lineHeight:36},title:{fontSize:17,fontWeight:'700',color:'#fff'},save:{backgroundColor:PURPLE,borderRadius:12,paddingHorizontal:16,paddingVertical:9},saveText:{color:'#fff',fontWeight:'700'},disabled:{opacity:.45},
  preview:{width:PREVIEW_W,alignSelf:'center',marginTop:12,backgroundColor:'#050506',borderRadius:16,overflow:'hidden'},compare:{position:'absolute',right:10,bottom:10,backgroundColor:'rgba(0,0,0,.65)',paddingHorizontal:10,paddingVertical:7,borderRadius:10},compareText:{color:'#fff',fontSize:12,fontWeight:'600'},
  tools:{paddingHorizontal:12,paddingVertical:12,gap:8},tool:{paddingHorizontal:15,paddingVertical:9,borderRadius:12,backgroundColor:'#17181d'},toolActive:{backgroundColor:'#2c2340'},toolText:{color:'#a8aab0',fontWeight:'600'},activeText:{color:'#c8adff'},
  panel:{flex:1,minHeight:220,backgroundColor:PANEL,borderTopLeftRadius:18,borderTopRightRadius:18,paddingTop:10},cards:{paddingHorizontal:12,paddingVertical:8,gap:8},card:{minWidth:88,paddingHorizontal:14,paddingVertical:16,borderRadius:14,backgroundColor:'#1a1b20',alignItems:'center'},cardActive:{borderWidth:1,borderColor:PURPLE,backgroundColor:'#2b2340'},cardTitle:{color:'#fff',fontSize:12,fontWeight:'600',textTransform:'capitalize'},
  sliderRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:12},sliderLabel:{width:88,color:'#d8d9dd',fontSize:12},track:{height:26,justifyContent:'center'},trackBase:{position:'absolute',left:0,right:0,height:3,borderRadius:3,backgroundColor:'#34363d'},trackFill:{height:3,borderRadius:3,backgroundColor:PURPLE},thumb:{position:'absolute',width:14,height:14,borderRadius:7,backgroundColor:'#fff'},sliderValue:{width:42,textAlign:'right',color:'#fff'},
  applyCrop:{alignSelf:'center',marginTop:12,backgroundColor:PURPLE,borderRadius:12,paddingHorizontal:22,paddingVertical:12},rotateRow:{flexDirection:'row',padding:16,gap:10},action:{backgroundColor:'#1a1b20',borderRadius:12,paddingHorizontal:18,paddingVertical:14},actionText:{color:'#fff',fontWeight:'700'},
  bottom:{height:56,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderTopWidth:1,borderTopColor:'#202127'},bottomText:{color:'#fff',fontWeight:'700'},status:{color:MUTED,fontSize:11}
});
