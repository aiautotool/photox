import type { MediaAsset, PairingCredentials, StorageProviderDescriptor } from '@photox/contracts';
import type { Transport } from '@photox/transport';
export class DesktopClient {
  constructor(private readonly transport:Transport,private credentials?:PairingCredentials){}
  setPairing(credentials:PairingCredentials):void{this.credentials=credentials;}
  async status<T=unknown>():Promise<T>{return (await this.transport.request<T>({path:'/api/v1/status',headers:this.authHeaders()})).data;}
  async library():Promise<MediaAsset[]>{return (await this.transport.request<MediaAsset[]>({path:'/api/v1/library',headers:this.authHeaders()})).data;}
  async providers():Promise<StorageProviderDescriptor[]>{return (await this.transport.request<StorageProviderDescriptor[]>({path:'/api/v1/storage/providers',headers:this.authHeaders()})).data;}
  private authHeaders():Record<string,string>{return this.credentials?{'x-photosync-pair-code':this.credentials.pairCode}:{ };}
}
