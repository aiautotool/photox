import * as FileSystem from 'expo-file-system/legacy';
import type { ImageEditRecipe } from '@photox/image-editor';

const ROOT = `${FileSystem.documentDirectory}photox-edit-recipes/`;

function safeId(assetId:string){return assetId.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,180)||'asset';}
function pathFor(assetId:string){return `${ROOT}${safeId(assetId)}.json`;}

async function ensureRoot(){
  const info=await FileSystem.getInfoAsync(ROOT);
  if(!info.exists)await FileSystem.makeDirectoryAsync(ROOT,{intermediates:true});
}

export async function saveEditRecipe(assetId:string,recipe:ImageEditRecipe){
  await ensureRoot();
  await FileSystem.writeAsStringAsync(pathFor(assetId),JSON.stringify(recipe));
}

export async function loadEditRecipe(assetId:string):Promise<ImageEditRecipe|null>{
  try{
    const raw=await FileSystem.readAsStringAsync(pathFor(assetId));
    const value=JSON.parse(raw) as ImageEditRecipe;
    return value?.schemaVersion===1&&Array.isArray(value.operations)?value:null;
  }catch{return null;}
}

export async function removeEditRecipe(assetId:string){
  try{await FileSystem.deleteAsync(pathFor(assetId),{idempotent:true});}catch{}
}
