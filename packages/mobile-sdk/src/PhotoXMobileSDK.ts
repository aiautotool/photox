import type { PairingCredentials } from '@photox/contracts';
import type { Transport } from '@photox/transport';
import { UpdateClient } from '@photox/update-core';
import { DesktopClient } from './DesktopClient';
import { PairingStore, type KeyValueStore } from './PairingStore';
export interface PhotoXMobileSDKOptions { transport:Transport; secureStore?:KeyValueStore; updateManifestUrl?:string; }
export class PhotoXMobileSDK {
  readonly desktop:DesktopClient; readonly pairing?:PairingStore; readonly updates?:UpdateClient;
  constructor(options:PhotoXMobileSDKOptions){this.desktop=new DesktopClient(options.transport); if(options.secureStore)this.pairing=new PairingStore(options.secureStore); if(options.updateManifestUrl)this.updates=new UpdateClient(options.updateManifestUrl);}
  async restorePairing():Promise<PairingCredentials|null>{const credentials=await this.pairing?.load()??null; if(credentials)this.desktop.setPairing(credentials); return credentials;}
  async pair(credentials:PairingCredentials):Promise<void>{this.desktop.setPairing(credentials); await this.pairing?.save(credentials);}
}
