import type { EditOperation } from '../types';
export interface NormalizedPoint{x:number;y:number}
export interface BrushMask{points:NormalizedPoint[];radius:number;feather?:number}
export type FaceAdjustment='skinSmooth'|'skinTone'|'faceBrightness'|'teethWhitening'|'eyeBrightness'|'eyeDetail';
export class RetouchEngine {
 heal(mask:BrushMask):EditOperation{return {id:`heal:${Date.now()}`,type:'custom',pluginId:'photox.heal',payload:{mask}} as EditOperation}
 removeObject(mask:BrushMask):EditOperation{return {id:`remove:${Date.now()}`,type:'custom',pluginId:'photox.remove-object',payload:{mask}} as EditOperation}
 face(faceId:string,name:FaceAdjustment,value:number):EditOperation{return {id:`face:${faceId}:${name}`,type:'custom',pluginId:'photox.face-retouch',payload:{faceId,name,value:Math.max(-1,Math.min(1,value))}} as EditOperation}
}
