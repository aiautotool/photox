import type { MediaAsset, MediaMetadata } from '@photox/contracts';
export interface HashService { sha256(uri:string):Promise<string>; }
export interface MetadataService { extract(uri:string,mimeType?:string):Promise<MediaMetadata>; }
export interface ThumbnailService { create(asset:MediaAsset,options?:{width?:number;height?:number;quality?:number}):Promise<string>; }
export class DuplicateDetector { isDuplicate(a:MediaAsset,b:MediaAsset):boolean { if(a.sha256&&b.sha256)return a.sha256===b.sha256; return a.filename===b.filename&&a.sizeBytes===b.sizeBytes&&a.createdAt===b.createdAt; } }
