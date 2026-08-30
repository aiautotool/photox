import type { PairingCredentials } from '@photox/contracts';
export interface KeyValueStore { get(key:string):Promise<string|null>; set(key:string,value:string):Promise<void>; remove(key:string):Promise<void>; }
export class PairingStore {
  constructor(private readonly store:KeyValueStore,private readonly key='photox.pairing'){}
  async load():Promise<PairingCredentials|null>{const value=await this.store.get(this.key); if(!value)return null; try{return JSON.parse(value) as PairingCredentials;}catch{return null;}}
  save(value:PairingCredentials):Promise<void>{return this.store.set(this.key,JSON.stringify(value));}
  clear():Promise<void>{return this.store.remove(this.key);}
}
