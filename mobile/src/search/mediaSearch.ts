import type { DisplayAsset } from '../sync/mobileSync';
import type { MobileAlbum } from '../library/LibraryStateStore';

function normalize(value:unknown){return String(value??'').toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function durationText(seconds=0){const s=Math.max(0,Math.round(seconds));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}

export function buildMediaSearchText(asset:DisplayAsset,albums:MobileAlbum[]=[]){
  const date=new Date(asset.creationTime||0);
  const albumNames=albums.filter(a=>a.mediaIds.includes(asset.id)).map(a=>a.name);
  const values=[
    asset.filename,asset.mediaType,asset.mimeType,asset.container,asset.videoCodec,asset.audioCodec,
    asset.width&&asset.height?`${asset.width}x${asset.height}`:'',
    asset.duration?durationText(asset.duration):'',
    asset.duration?`${Math.round(asset.duration)}s`:'',
    asset.cloudOnly?'cloud':'local',
    ...albumNames,
  ];
  if(Number.isFinite(date.getTime())&&date.getTime()>0){
    values.push(
      date.toLocaleDateString('vi-VN'),
      date.toLocaleDateString('vi-VN',{month:'long'}),
      String(date.getFullYear()),
      String(date.getMonth()+1),
      String(date.getDate()),
    );
  }
  return normalize(values.filter(Boolean).join(' '));
}

export function searchMedia(assets:DisplayAsset[],query:string,albums:MobileAlbum[]=[]){
  const terms=normalize(query).trim().split(/\s+/).filter(Boolean);
  if(!terms.length)return assets;
  return assets.filter(asset=>{const text=buildMediaSearchText(asset,albums);return terms.every(term=>text.includes(term));});
}
