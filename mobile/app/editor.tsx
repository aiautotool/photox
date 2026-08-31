import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import { EditorSettingsModel, SourceType } from '@imgly/editor-react-native';
import { PhotoEditorScreen, type PhotoEditorAsset } from '../src/editor/PhotoEditorScreen';
import { openNativePhotoEditor } from '../src/editor/EditorNavigationBridge';
import { saveEditRecipe } from '../src/editor/EditRecipeStore';
import type { ImageEditRecipe } from '@photox/image-editor';

function numberParam(value:string|string[]|undefined){const raw=Array.isArray(value)?value[0]:value;const n=raw?Number(raw):undefined;return Number.isFinite(n)?n:undefined;}

export default function PhotoEditorRoute(){
  const router=useRouter();
  const params=useLocalSearchParams<{id:string;uri:string;filename:string;width?:string;height?:string;mimeType?:string}>();
  const uri=Array.isArray(params.uri)?params.uri[0]:params.uri;
  const id=Array.isArray(params.id)?params.id[0]:params.id;
  const filename=Array.isArray(params.filename)?params.filename[0]:params.filename;
  const mimeType=Array.isArray(params.mimeType)?params.mimeType[0]:params.mimeType;
  const [measured,setMeasured]=useState<{width?:number;height?:number}>({});

  useEffect(()=>{
    let cancelled=false;
    if(!uri)return;
    const width=numberParam(params.width); const height=numberParam(params.height);
    if(width&&height){setMeasured({width,height});return;}
    void ImageManipulator.manipulateAsync(uri,[],{compress:1,format:ImageManipulator.SaveFormat.JPEG})
      .then(result=>{if(!cancelled)setMeasured({width:result.width,height:result.height});})
      .catch(()=>{});
    return()=>{cancelled=true;};
  },[uri,params.width,params.height]);

  const asset:PhotoEditorAsset|null=uri&&id?{id,uri,filename:filename||'photo.jpg',width:numberParam(params.width)||measured.width,height:numberParam(params.height)||measured.height,mimeType}:null;

  async function saveRecipe(recipe:ImageEditRecipe, renderedUri?:string){
    if(!asset)return;
    await saveEditRecipe(asset.id,recipe);
    if(renderedUri){
      const permission=await MediaLibrary.requestPermissionsAsync();
      if(!permission.granted){
        Alert.alert('Cần quyền thư viện ảnh','Cho phép truy cập Photos để lưu bản ảnh đã chỉnh sửa.');
        return;
      }
      await MediaLibrary.createAssetAsync(renderedUri);
      Alert.alert('Đã lưu ảnh','Đã tạo một ảnh chỉnh sửa mới. Ảnh gốc vẫn được giữ nguyên.',[{text:'OK',onPress:()=>router.back()}]);
      return;
    }
    Alert.alert('Đã lưu chỉnh sửa','Recipe đã được lưu không phá hủy. Ảnh gốc vẫn được giữ nguyên.');
  }

  async function openAdvanced(recipe:ImageEditRecipe){
    if(!asset)return;
    await saveEditRecipe(asset.id,recipe);
    const settings=new EditorSettingsModel({license:process.env.EXPO_PUBLIC_IMGLY_LICENSE||undefined,userId:'photosync-mobile'});
    const result=await openNativePhotoEditor(settings,{source:asset.uri,type:SourceType.IMAGE},{sourceAssetId:asset.id,filename:asset.filename});
    if(result?.artifact){
      const artifact=result.artifact.startsWith('/')?`file://${result.artifact}`:result.artifact;
      await MediaLibrary.createAssetAsync(artifact);
      Alert.alert('Đã lưu ảnh','Đã lưu kết quả từ Advanced Editor.');
    }
  }

  return <PhotoEditorScreen visible asset={asset} onClose={()=>router.back()} onSave={saveRecipe} onOpenAdvanced={openAdvanced}/>;
}
