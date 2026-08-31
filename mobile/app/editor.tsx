import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { EditorSettingsModel, SourceType } from '@imgly/editor-react-native';
import { PhotoEditorScreen, type PhotoEditorAsset } from '../src/editor/PhotoEditorScreen';
import { openNativePhotoEditor } from '../src/editor/EditorNavigationBridge';
import type { ImageEditRecipe } from '@photox/image-editor';

function numberParam(value:string|string[]|undefined){const raw=Array.isArray(value)?value[0]:value;const n=raw?Number(raw):undefined;return Number.isFinite(n)?n:undefined;}

export default function PhotoEditorRoute(){
  const router=useRouter();
  const params=useLocalSearchParams<{id:string;uri:string;filename:string;width?:string;height?:string;mimeType?:string}>();
  const uri=Array.isArray(params.uri)?params.uri[0]:params.uri;
  const id=Array.isArray(params.id)?params.id[0]:params.id;
  const filename=Array.isArray(params.filename)?params.filename[0]:params.filename;
  const mimeType=Array.isArray(params.mimeType)?params.mimeType[0]:params.mimeType;
  const asset:PhotoEditorAsset|null=uri&&id?{id,uri,filename:filename||'photo.jpg',width:numberParam(params.width),height:numberParam(params.height),mimeType}:null;

  async function saveRecipe(recipe:ImageEditRecipe){
    if(!asset)return;
    await SecureStore.setItemAsync(`photox.edit.recipe.${asset.id}`,JSON.stringify(recipe));
    Alert.alert('Đã lưu chỉnh sửa','Recipe đã được lưu không phá hủy. Ảnh gốc vẫn được giữ nguyên.');
  }

  async function openAdvanced(recipe:ImageEditRecipe){
    if(!asset)return;
    await SecureStore.setItemAsync(`photox.edit.recipe.${asset.id}`,JSON.stringify(recipe));
    const settings=new EditorSettingsModel({license:process.env.EXPO_PUBLIC_IMGLY_LICENSE||undefined,userId:'photosync-mobile'});
    await openNativePhotoEditor(settings,{source:asset.uri,type:SourceType.IMAGE},{sourceAssetId:asset.id,filename:asset.filename});
  }

  return <PhotoEditorScreen visible asset={asset} onClose={()=>router.back()} onSave={saveRecipe} onOpenAdvanced={openAdvanced}/>;
}
