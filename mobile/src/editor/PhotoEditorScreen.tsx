import { useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Canvas,
  ColorMatrix,
  Image as SkiaImage,
  RadialGradient,
  Rect,
  useCanvasRef,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { EditSession, type AdjustmentName, type CropAspect, type ImageEditRecipe } from '@photox/image-editor';

const PURPLE = '#8B5CF6';
const BG = '#090A0C';
const PANEL = '#111216';
const MUTED = '#8A8D95';
const SCREEN = Dimensions.get('window').width;
const PREVIEW_W = Math.min(SCREEN - 24, 520);

type Tool = 'presets' | 'adjust' | 'crop' | 'filters' | 'advanced';
type AdjustmentState = {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  fade: number;
  vignette: number;
};

type Preset = { id: string; label: string; values: Partial<AdjustmentState> };

const DEFAULTS: AdjustmentState = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  fade: 0,
  vignette: 0,
};

const PRESETS: Preset[] = [
  { id: 'clean', label: 'Clean', values: { exposure: 0.12, contrast: 8, saturation: 5 } },
  { id: 'vivid', label: 'Vivid', values: { contrast: 18, saturation: 24 } },
  { id: 'warm', label: 'Warm', values: { temperature: 24, saturation: 8 } },
  { id: 'cinema', label: 'Cinema', values: { contrast: 22, saturation: -10, fade: 8, vignette: 24 } },
  { id: 'bw', label: 'B&W', values: { saturation: -100, contrast: 18 } },
];

const FILTERS: Preset[] = [
  { id: 'natural', label: 'Natural', values: {} },
  { id: 'gold', label: 'Faded Gold', values: { temperature: 30, saturation: -8, fade: 15 } },
  { id: 'fuji', label: 'Fuji Pro', values: { contrast: 10, saturation: 15, tint: 6 } },
  { id: 'moody', label: 'Moody', values: { exposure: -0.1, contrast: 24, saturation: -18, vignette: 28 } },
  { id: 'retro', label: 'Retro', values: { temperature: 18, saturation: -20, fade: 24 } },
];

export interface PhotoEditorAsset {
  id: string;
  uri: string;
  filename: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface PhotoEditorScreenProps {
  visible: boolean;
  asset: PhotoEditorAsset | null;
  onClose(): void;
  onSave(recipe: ImageEditRecipe, renderedUri?: string): Promise<void> | void;
  onOpenAdvanced?(recipe: ImageEditRecipe): Promise<void> | void;
}

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

function multiply(a: number[], b: number[]) {
  const out = new Array(20).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      if (col === 4) {
        out[row * 5 + col] = a[row * 5 + 4];
        for (let k = 0; k < 4; k += 1) out[row * 5 + col] += a[row * 5 + k] * b[k * 5 + 4];
      } else {
        for (let k = 0; k < 4; k += 1) out[row * 5 + col] += a[row * 5 + k] * b[k * 5 + col];
      }
    }
  }
  return out;
}

function matrixFor(v: AdjustmentState) {
  let m = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];
  const exposure = Math.pow(2, v.exposure);
  m = multiply([exposure,0,0,0,0, 0,exposure,0,0,0, 0,0,exposure,0,0, 0,0,0,1,0], m);

  const c = 1 + v.contrast / 100;
  const co = 128 * (1 - c);
  m = multiply([c,0,0,0,co, 0,c,0,0,co, 0,0,c,0,co, 0,0,0,1,0], m);

  const s = 1 + v.saturation / 100;
  const ir = 0.2126 * (1 - s), ig = 0.7152 * (1 - s), ib = 0.0722 * (1 - s);
  m = multiply([
    ir+s, ig, ib, 0, 0,
    ir, ig+s, ib, 0, 0,
    ir, ig, ib+s, 0, 0,
    0,0,0,1,0,
  ], m);

  const temp = v.temperature * 0.55;
  const tint = v.tint * 0.35;
  m = multiply([1,0,0,0,temp+tint, 0,1,0,0,-tint, 0,0,1,0,-temp, 0,0,0,1,0], m);

  if (v.fade > 0) {
    const f = clamp(v.fade / 100, 0, 0.65);
    const k = 1 - f;
    const o = 128 * f;
    m = multiply([k,0,0,0,o, 0,k,0,0,o, 0,0,k,0,o, 0,0,0,1,0], m);
  }
  return m;
}

function Slider({ label, value, min, max, step = 1, onChange }:{ label:string; value:number; min:number; max:number; step?:number; onChange(v:number):void }) {
  const width = Math.min(SCREEN - 150, 300);
  const ratio = (value - min) / (max - min);
  const setX = (x:number) => {
    const raw = min + clamp(x / width, 0, 1) * (max - min);
    const next = Math.round(raw / step) * step;
    onChange(Number(next.toFixed(2)));
  };
  return <View style={s.sliderRow}>
    <Text style={s.sliderLabel}>{label}</Text>
    <View style={[s.track,{width}]} onTouchStart={e=>setX(e.nativeEvent.locationX)} onTouchMove={e=>setX(e.nativeEvent.locationX)}>
      <View style={s.trackBase}/><View style={[s.trackFill,{width:ratio*width}]}/><View style={[s.thumb,{left:clamp(ratio*width-7,0,width-14)}]}/>
    </View>
    <Text style={s.sliderValue}>{value > 0 ? '+' : ''}{value}</Text>
  </View>;
}

function centerCrop(width:number, height:number, aspect:CropAspect) {
  if (aspect === 'free' || aspect === 'original') return null;
  const [a,b] = String(aspect).split(':').map(Number);
  if (!a || !b) return null;
  const target = a / b;
  const current = width / height;
  if (current > target) {
    const cropWidth = Math.round(height * target);
    return { originX: Math.round((width - cropWidth) / 2), originY: 0, width: cropWidth, height };
  }
  const cropHeight = Math.round(width / target);
  return { originX: 0, originY: Math.round((height - cropHeight) / 2), width, height: cropHeight };
}

export function PhotoEditorScreen({ visible, asset, onClose, onSave, onOpenAdvanced }: PhotoEditorScreenProps) {
  const sessionRef = useRef<EditSession | null>(null);
  const canvasRef = useCanvasRef();
  const [workingUri,setWorkingUri] = useState<string | null>(null);
  const [size,setSize] = useState({ width: 1, height: 1 });
  const [adjust,setAdjust] = useState<AdjustmentState>(DEFAULTS);
  const [tool,setTool] = useState<Tool>('presets');
  const [compare,setCompare] = useState(false);
  const [busy,setBusy] = useState(false);
  const [selectedPreset,setSelectedPreset] = useState('');
  const [cropAspect,setCropAspect] = useState<CropAspect>('original');

  if (asset && (!sessionRef.current || sessionRef.current.recipe().source.uri !== asset.uri)) {
    sessionRef.current = new EditSession({ uri: asset.uri, width: asset.width, height: asset.height, mimeType: asset.mimeType });
    if (workingUri !== asset.uri) {
      setWorkingUri(asset.uri);
      setSize({ width: asset.width || 1, height: asset.height || 1 });
      setAdjust(DEFAULTS);
      setSelectedPreset('');
      setCropAspect('original');
    }
  }

  const image = useImage(workingUri || undefined);
  const matrix = useMemo(() => matrixFor(compare ? DEFAULTS : adjust), [adjust,compare]);
  const previewHeight = Math.min(430, Math.max(250, PREVIEW_W * (size.height / Math.max(1,size.width))));
  const session = sessionRef.current;

  function pushAdjust(name: keyof AdjustmentState, value:number) {
    setAdjust(prev => ({ ...prev, [name]: value }));
    session?.apply({ id:`adjust:${name}`, type:'adjust', name:name as AdjustmentName, value });
  }

  function applyPreset(p:Preset) {
    setSelectedPreset(p.id);
    const next = { ...DEFAULTS, ...p.values };
    setAdjust(next);
    Object.entries(next).forEach(([name,value]) => session?.apply({ id:`adjust:${name}`, type:'adjust', name:name as AdjustmentName, value }));
  }

  async function manipulate(actions: ImageManipulator.Action[]) {
    if (!workingUri) return;
    setBusy(true);
    try {
      const result = await ImageManipulator.manipulateAsync(workingUri, actions, { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
      setWorkingUri(result.uri);
      setSize({ width: result.width, height: result.height });
    } catch (e) {
      Alert.alert('Không chỉnh được ảnh', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function rotate(degrees: 90 | 180 | 270) {
    session?.apply({ id:`rotate:${Date.now()}`, type:'rotate', degrees });
    await manipulate([{ rotate: degrees }]);
  }

  async function flip(axis:'horizontal'|'vertical') {
    session?.apply({ id:`flip:${axis}:${Date.now()}`, type:'flip', axis });
    await manipulate([{ flip: axis === 'horizontal' ? ImageManipulator.FlipType.Horizontal : ImageManipulator.FlipType.Vertical }]);
  }

  async function crop(aspect:CropAspect) {
    setCropAspect(aspect);
    const rect = centerCrop(size.width,size.height,aspect);
    if (!rect) return;
    session?.apply({ id:`crop:${Date.now()}`, type:'crop', rect:{ x:rect.originX/size.width, y:rect.originY/size.height, width:rect.width/size.width, height:rect.height/size.height, aspect } });
    await manipulate([{ crop: rect }]);
  }

  function reset() {
    if (!asset) return;
    session?.reset();
    setWorkingUri(asset.uri);
    setSize({ width: asset.width || 1, height: asset.height || 1 });
    setAdjust(DEFAULTS);
    setSelectedPreset('');
    setCropAspect('original');
  }

  async function saveNow() {
    if (!asset || !session || !canvasRef.current) return;
    setBusy(true);
    try {
      const snapshot = await canvasRef.current.makeImageSnapshotAsync();
      if (!snapshot) throw new Error('Không tạo được ảnh xuất.');
      const base64 = snapshot.encodeToBase64();
      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) throw new Error('Không có thư mục tạm để lưu ảnh.');
      const out = `${dir}photox-edit-${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(out, base64, { encoding: FileSystem.EncodingType.Base64 });
      await onSave(session.recipe({ assetId:asset.id, filename:asset.filename }), out);
    } catch (e) {
      Alert.alert('Lưu ảnh thất bại', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!asset || !session || !workingUri) return null;

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Pressable onPress={onClose}><Text style={s.headerButton}>×</Text></Pressable>
        <Text style={s.title}>Edit Photo</Text>
        <Pressable disabled={busy} onPress={()=>void saveNow()} style={[s.save,busy&&s.disabled]}><Text style={s.saveText}>{busy?'Working…':'Save'}</Text></Pressable>
      </View>

      <View style={[s.previewWrap,{height:previewHeight}]}>
        <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
          {image && <SkiaImage image={image} x={0} y={0} width={PREVIEW_W} height={previewHeight} fit="contain">
            <ColorMatrix matrix={matrix}/>
          </SkiaImage>}
          {!compare && adjust.vignette > 0 && <Rect x={0} y={0} width={PREVIEW_W} height={previewHeight}>
            <RadialGradient c={vec(PREVIEW_W/2,previewHeight/2)} r={Math.max(PREVIEW_W,previewHeight)*0.7} colors={['rgba(0,0,0,0)','rgba(0,0,0,0)',`rgba(0,0,0,${clamp(adjust.vignette/125,0,0.75)})`]}/>
          </Rect>}
        </Canvas>
        <Pressable style={s.compare} onPressIn={()=>setCompare(true)} onPressOut={()=>setCompare(false)}><Text style={s.compareText}>Hold Original</Text></Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tools}>
        {(['presets','adjust','crop','filters','advanced'] as Tool[]).map(t=><Pressable key={t} onPress={()=>setTool(t)} style={[s.tool,t===tool&&s.toolActive]}><Text style={[s.toolText,t===tool&&s.activeText]}>{t[0].toUpperCase()+t.slice(1)}</Text></Pressable>)}
      </ScrollView>

      <View style={s.panel}>
        {tool==='presets' && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cards}>{PRESETS.map(p=><Pressable key={p.id} onPress={()=>applyPreset(p)} style={[s.card,selectedPreset===p.id&&s.cardActive]}><Text style={s.cardTitle}>{p.label}</Text></Pressable>)}</ScrollView>}
        {tool==='filters' && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cards}>{FILTERS.map(p=><Pressable key={p.id} onPress={()=>applyPreset(p)} style={[s.card,selectedPreset===p.id&&s.cardActive]}><Text style={s.cardTitle}>{p.label}</Text></Pressable>)}</ScrollView>}
        {tool==='adjust' && <ScrollView style={s.adjustScroll} contentContainerStyle={{paddingBottom:30}}>
          <Slider label="Exposure" value={adjust.exposure} min={-2} max={2} step={0.05} onChange={v=>pushAdjust('exposure',v)}/>
          <Slider label="Contrast" value={adjust.contrast} min={-100} max={100} onChange={v=>pushAdjust('contrast',v)}/>
          <Slider label="Saturation" value={adjust.saturation} min={-100} max={100} onChange={v=>pushAdjust('saturation',v)}/>
          <Slider label="Temperature" value={adjust.temperature} min={-100} max={100} onChange={v=>pushAdjust('temperature',v)}/>
          <Slider label="Tint" value={adjust.tint} min={-100} max={100} onChange={v=>pushAdjust('tint',v)}/>
          <Slider label="Fade" value={adjust.fade} min={0} max={100} onChange={v=>pushAdjust('fade',v)}/>
          <Slider label="Vignette" value={adjust.vignette} min={0} max={100} onChange={v=>pushAdjust('vignette',v)}/>
        </ScrollView>}
        {tool==='crop' && <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cards}>{(['original','1:1','4:3','3:4','16:9','9:16'] as CropAspect[]).map(a=><Pressable key={a} onPress={()=>void crop(a)} style={[s.card,cropAspect===a&&s.cardActive]}><Text style={s.cardTitle}>{a}</Text></Pressable>)}</ScrollView>
          <View style={s.geometryRow}><Pressable style={s.action} onPress={()=>void rotate(270)}><Text style={s.actionText}>↶ 90°</Text></Pressable><Pressable style={s.action} onPress={()=>void rotate(90)}><Text style={s.actionText}>↷ 90°</Text></Pressable><Pressable style={s.action} onPress={()=>void flip('horizontal')}><Text style={s.actionText}>↔ Flip</Text></Pressable><Pressable style={s.action} onPress={()=>void flip('vertical')}><Text style={s.actionText}>↕ Flip</Text></Pressable></View>
        </View>}
        {tool==='advanced' && <View style={s.advanced}><Text style={s.advancedTitle}>Advanced tools</Text><Text style={s.note}>Heal, remove object, face retouch, text and drawing use the native advanced engine. These controls are no longer shown as fake buttons.</Text><Pressable style={s.advancedButton} onPress={()=>void onOpenAdvanced?.(session.recipe())}><Text style={s.saveText}>Open Advanced Editor</Text></Pressable></View>}
      </View>

      <View style={s.bottom}><Pressable onPress={reset} style={s.bottomButton}><Text style={s.bottomText}>Reset</Text></Pressable><Text style={s.status}>{busy?'Processing image…':'Preview is live • export creates a new image'}</Text></View>
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  root:{flex:1,backgroundColor:BG},
  header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:'#1c1d22'},
  headerButton:{fontSize:34,color:'#fff',lineHeight:36}, title:{fontSize:17,fontWeight:'700',color:'#fff'},
  save:{backgroundColor:PURPLE,borderRadius:12,paddingHorizontal:16,paddingVertical:9},saveText:{color:'#fff',fontWeight:'700'},disabled:{opacity:.5},
  previewWrap:{width:PREVIEW_W,alignSelf:'center',marginTop:12,backgroundColor:'#050506',borderRadius:16,overflow:'hidden',justifyContent:'center'},
  compare:{position:'absolute',right:10,bottom:10,backgroundColor:'rgba(0,0,0,.65)',paddingHorizontal:10,paddingVertical:7,borderRadius:10},compareText:{color:'#fff',fontSize:12,fontWeight:'600'},
  tools:{paddingHorizontal:12,paddingVertical:12,gap:8},tool:{paddingHorizontal:15,paddingVertical:9,borderRadius:12,backgroundColor:'#17181d'},toolActive:{backgroundColor:'#2c2340'},toolText:{color:'#a8aab0',fontWeight:'600'},activeText:{color:'#c8adff'},
  panel:{flex:1,minHeight:210,backgroundColor:PANEL,borderTopLeftRadius:18,borderTopRightRadius:18,paddingTop:10},
  cards:{paddingHorizontal:12,paddingVertical:8,gap:8},card:{minWidth:88,paddingHorizontal:14,paddingVertical:16,borderRadius:14,backgroundColor:'#1a1b20',alignItems:'center'},cardActive:{borderWidth:1,borderColor:PURPLE,backgroundColor:'#2b2340'},cardTitle:{color:'#fff',fontSize:12,fontWeight:'600'},
  adjustScroll:{paddingHorizontal:12},sliderRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10},sliderLabel:{width:88,color:'#d8d9dd',fontSize:12},track:{height:26,justifyContent:'center'},trackBase:{position:'absolute',left:0,right:0,height:3,borderRadius:3,backgroundColor:'#34363d'},trackFill:{height:3,borderRadius:3,backgroundColor:PURPLE},thumb:{position:'absolute,width:14,height:14,borderRadius:7,backgroundColor:'#fff'},sliderValue:{width:42,textAlign:'right',color:'#fff',fontVariant:['tabular-nums']},
  geometryRow:{flexDirection:'row',flexWrap:'wrap',padding:12,gap:10},action:{backgroundColor:'#1a1b20',borderRadius:12,paddingHorizontal:14,paddingVertical:12},actionText:{color:'#fff',fontWeight:'600'},
  advanced:{padding:18},advancedTitle:{color:'#fff',fontSize:18,fontWeight:'700',marginBottom:8},note:{color:MUTED,lineHeight:20,marginBottom:16},advancedButton:{alignSelf:'flex-start',backgroundColor:PURPLE,borderRadius:12,paddingHorizontal:16,paddingVertical:12},
  bottom:{height:56,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderTopWidth:1,borderTopColor:'#202127'},bottomButton:{padding:8},bottomText:{color:'#fff',fontWeight:'700'},status:{color:MUTED,fontSize:11},
});
