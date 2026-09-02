import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import { PhotoEditorScreen, type PhotoEditorAsset } from '../src/editor/PhotoEditorScreen';
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
  const asset:PhotoEditorAsset|null=uri&&id?{id,uri,filename:filename||'photo.jpg',width:numberParam(params.width),height:numberParam(params.height),mimeType}:null;

  async function saveRecipe(recipe:ImageEditRecipe, renderedUri?:string){
    if(!asset)return;
    await saveEditRecipe(asset.id,recipe);
    if(!renderedUri)return;
    const permission=await MediaLibrary.requestPermissionsAsync();
    if(!permission.granted){
      Alert.alert('Cần quyền thư viện ảnh','Cho phép truy cập Photos để lưu bản ảnh đã chỉnh sửa.');
      return;
    }
    await MediaLibrary.createAssetAsync(renderedUri);
    Alert.alert('Đã lưu ảnh','Đã tạo một ảnh chỉnh sửa mới. Ảnh gốc vẫn được giữ nguyên.',[{text:'OK',onPress:()=>router.back()}]);
  }

  return <PhotoEditorScreen visible asset={asset} onClose={()=>router.back()} onSave={saveRecipe}/>;
}
