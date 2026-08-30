import fs from 'node:fs'; import path from 'node:path'; import { pipeline } from 'node:stream/promises';
import type { StorageAccount, StorageDownloadInput, StorageDownloadResult, StorageObject, StorageProvider, StorageProviderDescriptor, StorageUploadInput } from '@photox/contracts';
export class LocalStorageProvider implements StorageProvider {
  readonly id='local'; readonly name='Local Storage';
  constructor(private readonly rootDir:string,private readonly accountId='local-default'){}
  descriptor():StorageProviderDescriptor{return{id:this.id,name:this.name,capabilities:['UPLOAD','DOWNLOAD','DELETE','RANGE_READ','LOCAL_NETWORK']};}
  async listAccounts():Promise<StorageAccount[]>{const stat=await fs.promises.statfs(this.rootDir).catch(()=>undefined); const free=stat?Number(stat.bavail)*Number(stat.bsize):undefined; return[{providerId:this.id,accountId:this.accountId,displayName:this.rootDir,status:'ready',freeBytes:free,totalBytes:stat?Number(stat.blocks)*Number(stat.bsize):undefined}];}
  async upload(input:StorageUploadInput):Promise<StorageObject>{if(!input.localUri)throw new Error('Local provider requires localUri'); await fs.promises.mkdir(this.rootDir,{recursive:true}); const target=path.join(this.rootDir,`${input.key}-${input.filename}`); await pipeline(fs.createReadStream(input.localUri),fs.createWriteStream(target)); return{providerId:this.id,accountId:input.accountId,remoteFileId:target,remotePath:target,sizeBytes:input.sizeBytes,checksum:input.sha256};}
  async download(input:StorageDownloadInput):Promise<StorageDownloadResult>{return{status:200,body:fs.createReadStream(input.remoteFileId)};}
  async delete(_accountId:string,remoteFileId:string):Promise<void>{await fs.promises.rm(remoteFileId,{force:true});}
}
