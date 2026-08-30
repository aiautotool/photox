export interface PhotoXEventMap {
  'device:connected': { deviceId:string };
  'device:disconnected': { deviceId:string };
  'storage:full': { providerId:string; accountId:string };
  'replica:verified': { assetId:string; providerId:string; accountId:string };
  'update:available': { version:string; required:boolean };
}

export type PhotoXEventName = keyof PhotoXEventMap;
